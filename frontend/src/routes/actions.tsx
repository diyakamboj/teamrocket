import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Loader2,
  Sparkles,
  Users,
  Zap,
} from "lucide-react";
import { toast } from "sonner";
import {
  decideJdRecommendation,
  getInternalMatches,
  getJdOptimization,
  listJobPipelines,
  type AgentEvaluationSummary,
  type JDRecommendation,
  type JobPipelineSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/actions")({
  head: () => ({
    meta: [
      { title: "Actions Center — ResumeIQ" },
      {
        name: "description",
        content:
          "Review AI recommendations across every open job: bench matches, JD calibration warnings, and candidates ready for assessment.",
      },
    ],
  }),
  component: ActionsPage,
});

type ActionType = "bench_match" | "jd_optimization" | "readiness_assessment";

type ActionItem = {
  id: string;
  type: ActionType;
  title: string;
  description: string;
  jobId: string;
  jobTitle: string;
  candidateName?: string;
  urgency: "high" | "medium" | "low";
  targetUrl: string;
  actionLabel: string;
  /** Present only when acting on the item writes back to the backend. */
  recommendationId?: string;
};

const FILTERS = [
  { id: "all", label: "All Actions" },
  { id: "bench_match", label: "Bench Matches" },
  { id: "jd_optimization", label: "JD Skew Warnings" },
  { id: "readiness_assessment", label: "Readiness Prompts" },
] as const;

type FilterId = (typeof FILTERS)[number]["id"];

const TYPE_ICON: Record<ActionType, typeof Users> = {
  bench_match: Users,
  jd_optimization: AlertTriangle,
  readiness_assessment: Bot,
};

const TYPE_TONE: Record<ActionType, string> = {
  bench_match: "bg-success/10 border-success/30 text-success",
  jd_optimization: "bg-warning/15 border-warning/40 text-warning-foreground dark:text-warning",
  readiness_assessment: "bg-primary-soft border-primary/30 text-primary-soft-foreground",
};

/** JD recommendations worth surfacing — the calibration flags, not "balanced". */
const ACTIONABLE_JD = new Set(["too_strict", "low_signal", "under_filtered"]);

function jdUrgency(rec: JDRecommendation): ActionItem["urgency"] {
  if (rec.classification === "too_strict") return "high";
  if (rec.classification === "low_signal") return "medium";
  return "low";
}

async function buildActions(jobs: JobPipelineSummary[]): Promise<ActionItem[]> {
  const perJob = await Promise.all(
    jobs.map(async (job) => {
      const items: ActionItem[] = [];

      const [optimization, matches] = await Promise.all([
        getJdOptimization(job.job_id).catch(() => null),
        getInternalMatches(job.job_id, true).catch(() => [] as AgentEvaluationSummary[]),
      ]);

      for (const rec of optimization?.recommendations ?? []) {
        if (rec.status !== "pending" || !ACTIONABLE_JD.has(rec.classification)) continue;
        items.push({
          id: `jd-${job.job_id}-${rec.id}`,
          type: "jd_optimization",
          title: `JD calibration: ${rec.skill}`,
          description: `${rec.suggested_modification} Only ${rec.candidates_matching} of ${rec.total_candidates} candidates (${Math.round(rec.coverage_pct)}%) match this ${rec.is_must_have ? "must-have" : "nice-to-have"} requirement.`,
          jobId: job.job_id,
          jobTitle: job.title,
          urgency: jdUrgency(rec),
          targetUrl: "/insights",
          actionLabel: "Accept recommendation",
          recommendationId: rec.id,
        });
      }

      for (const match of matches.slice(0, 3)) {
        const candidate = match.candidate;
        if (candidate.employment_status !== "bench") continue;
        items.push({
          id: `bench-${job.job_id}-${candidate.candidate_id ?? candidate.label}`,
          type: "bench_match",
          title: "Internal bench candidate match",
          description: `${candidate.label} is on the bench and scores ${Math.round(candidate.score ?? 0)} against this role's requirements.`,
          jobId: job.job_id,
          jobTitle: job.title,
          candidateName: candidate.label,
          urgency: (candidate.score ?? 0) >= 75 ? "high" : "medium",
          targetUrl: "/talent-marketplace",
          actionLabel: "Review & place employee",
        });
      }

      const screened = job.stage_counts?.screened ?? 0;
      if (screened > 0) {
        items.push({
          id: `readiness-${job.job_id}`,
          type: "readiness_assessment",
          title: `${screened} candidate${screened === 1 ? "" : "s"} ready for assessment`,
          description: `${screened} screened candidate${screened === 1 ? " has" : "s have"} not yet moved to interview. Run a readiness assessment to validate competency gaps first.`,
          jobId: job.job_id,
          jobTitle: job.title,
          urgency: screened >= 5 ? "medium" : "low",
          targetUrl: "/candidates",
          actionLabel: "Send readiness assessments",
        });
      }

      return items;
    }),
  );

  const urgencyRank = { high: 0, medium: 1, low: 2 };
  return perJob.flat().sort((a, b) => urgencyRank[a.urgency] - urgencyRank[b.urgency]);
}

function ActionsPage() {
  const [actions, setActions] = useState<ActionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterId>("all");
  const [resolved, setResolved] = useState<Record<string, "approved" | "dismissed">>({});
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listJobPipelines()
      .then(buildActions)
      .then((items) => {
        if (!cancelled) {
          setActions(items);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load recommendations");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(
    () =>
      actions.filter(
        (a) => resolved[a.id] !== "dismissed" && (filter === "all" || a.type === filter),
      ),
    [actions, filter, resolved],
  );

  const pendingCount = actions.filter((a) => !resolved[a.id]).length;

  async function handleExecute(item: ActionItem) {
    // Only JD recommendations have a backend decision endpoint; the others
    // are navigational, so acting on them just marks them handled locally.
    if (!item.recommendationId) {
      setResolved((prev) => ({ ...prev, [item.id]: "approved" }));
      return;
    }

    setPendingId(item.id);
    try {
      await decideJdRecommendation(item.jobId, item.recommendationId, { status: "accepted" });
      setResolved((prev) => ({ ...prev, [item.id]: "approved" }));
      toast.success(`Recommendation accepted for ${item.jobTitle}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save that decision");
    } finally {
      setPendingId(null);
    }
  }

  async function handleDismiss(item: ActionItem) {
    if (item.recommendationId) {
      try {
        await decideJdRecommendation(item.jobId, item.recommendationId, { status: "rejected" });
      } catch {
        // Falls through to a local dismiss — the recruiter still wanted it gone.
      }
    }
    setResolved((prev) => ({ ...prev, [item.id]: "dismissed" }));
    toast.info("Action item dismissed.");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Zap className="h-4 w-4" /> Recruiter Copilot Decision Queue
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">Actions Center</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            AI recommendations generated from your live pipelines — JD calibration, bench matches,
            and readiness prompts.
          </p>
        </div>
        <Badge className="border-warning/40 bg-warning/15 text-xs font-semibold text-warning-foreground dark:text-warning">
          ⚡ {pendingCount} pending action{pendingCount === 1 ? "" : "s"}
        </Badge>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        {FILTERS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setFilter(tab.id)}
            className={cn(
              "rounded-lg px-3 py-1.5 text-xs font-medium transition-colors",
              filter === tab.id
                ? "bg-primary text-primary-foreground"
                : "bg-secondary text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <div className="space-y-4">
        {loading ? (
          <Card className="card-surface p-12 text-center">
            <Loader2 className="mx-auto mb-3 h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              Analysing open jobs for recommendations…
            </p>
          </Card>
        ) : error ? (
          <Card className="card-surface p-12 text-center">
            <AlertTriangle className="mx-auto mb-3 h-10 w-10 text-destructive" />
            <h3 className="text-lg font-bold">Could not load recommendations</h3>
            <p className="mt-1 text-sm text-muted-foreground">{error}</p>
          </Card>
        ) : filtered.length === 0 ? (
          <Card className="card-surface p-12 text-center">
            <CheckCircle2 className="mx-auto mb-3 h-12 w-12 text-success" />
            <h3 className="text-lg font-bold">Queue clear</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              No outstanding Copilot recommendations for your open jobs.
            </p>
          </Card>
        ) : (
          filtered.map((item) => {
            const Icon = TYPE_ICON[item.type];
            const status = resolved[item.id];
            return (
              <Card
                key={item.id}
                className={cn("card-surface transition-all", status && "opacity-60")}
              >
                <CardContent className="p-6">
                  <div className="flex flex-wrap items-start justify-between gap-6">
                    <div className="flex min-w-0 items-start gap-4">
                      <div
                        className={cn(
                          "mt-0.5 rounded-xl border p-2.5",
                          TYPE_TONE[item.type],
                        )}
                      >
                        <Icon className="h-5 w-5" />
                      </div>

                      <div className="min-w-0 space-y-1">
                        <div className="flex flex-wrap items-center gap-3">
                          <h3 className="text-base font-bold">{item.title}</h3>
                          {item.urgency === "high" && (
                            <Badge className="border-destructive/30 bg-destructive/15 text-[10px] uppercase text-destructive">
                              High priority
                            </Badge>
                          )}
                        </div>
                        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                          {item.description}
                        </p>
                        <div className="flex items-center gap-2 pt-2">
                          <span className="text-xs text-muted-foreground">Target role:</span>
                          <Badge variant="outline" className="text-xs">
                            {item.jobTitle}
                          </Badge>
                        </div>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      {status === "approved" ? (
                        <Badge className="border-success/30 bg-success/15 text-xs text-success">
                          ✓ Action completed
                        </Badge>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            className="rounded-xl text-xs"
                            disabled={pendingId === item.id}
                            onClick={() => void handleExecute(item)}
                          >
                            {pendingId === item.id && (
                              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            )}
                            {item.actionLabel}
                          </Button>
                          <Link to={item.targetUrl}>
                            <Button size="sm" variant="outline" className="rounded-xl text-xs">
                              Open
                            </Button>
                          </Link>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="rounded-xl text-xs text-muted-foreground"
                            onClick={() => void handleDismiss(item)}
                          >
                            Dismiss
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>

      {!loading && !error && filtered.length > 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" /> Recommendations refresh from your live pipelines on
          each visit.
        </p>
      )}
    </div>
  );
}
