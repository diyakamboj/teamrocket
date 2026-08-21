import { createFileRoute, Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertTriangle,
  Bell,
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
  getJobPipeline,
  type PipelineCandidate,
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
  /** Who this action is actually about. A count alone made it impossible to
   *  tell whether two cards meant the same person on two different jobs. */
  people: { id: string | null; name: string }[];
  /** The concrete next step, in the imperative. */
  whatToDo: string;
  urgency: "high" | "medium" | "low";
  targetUrl: string;
  actionLabel: string;
  /** Present only when acting on the item writes back to the backend. */
  recommendationId?: string;
};

//: Named for what the notification is about, not the mechanism behind it.
//: "JD Skew Warnings" and "Readiness Prompts" are internal vocabulary.
const FILTERS = [
  { id: "all", label: "Everything" },
  { id: "bench_match", label: "Someone on the bench fits" },
  { id: "jd_optimization", label: "A job ad needs a tweak" },
  { id: "readiness_assessment", label: "Candidates waiting on you" },
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

      const [optimization, matches, pipeline] = await Promise.all([
        getJdOptimization(job.job_id).catch(() => null),
        getInternalMatches(job.job_id, true).catch(() => [] as AgentEvaluationSummary[]),
        getJobPipeline(job.job_id, "all").catch(() => [] as PipelineCandidate[]),
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
          people: [],
          whatToDo: rec.is_must_have
            ? `Drop “${rec.skill}” from the must-haves, or accept a smaller pool.`
            : `Reword or remove “${rec.skill}” — few candidates match it.`,
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
          people: [{ id: candidate.candidate_id ?? null, name: candidate.label }],
          whatToDo: `Decide whether to put ${candidate.label} forward for this role.`,
        });
      }

      // Name the candidates rather than only counting them. The count came
      // from stage_counts, so the same person sitting on two boards produced
      // two cards that each just said "1 candidate" with no way to tell they
      // were the same human.
      const awaiting = pipeline.filter((c) => c.stage === "screened");
      if (awaiting.length > 0) {
        items.push({
          id: `readiness-${job.job_id}`,
          type: "readiness_assessment",
          title:
            awaiting.length === 1
              ? `${awaiting[0]!.candidate_name} is reviewed but not yet in interview`
              : `${awaiting.length} reviewed candidates are not yet in interview`,
          description:
            "A readiness assessment checks the competency gaps before you commit interview time.",
          jobId: job.job_id,
          jobTitle: job.title,
          urgency: awaiting.length >= 5 ? "medium" : "low",
          targetUrl: `/jobs/${job.job_id}`,
          // No send button here. Assessments are per candidate and the
          // Hiring steps checklist knows each one's state — sending in bulk
          // from a notification could not tell who had already been skipped.
          actionLabel: "Open the hiring steps",
          people: awaiting.map((c) => ({
            id: c.candidate_id ?? null,
            name: c.candidate_name ?? "Unknown candidate",
          })),
          whatToDo: "Send each of them a readiness assessment, or move them straight to interview.",
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

  const [lastChecked, setLastChecked] = useState<Date | null>(null);

  const load = useCallback(
    (showSpinner: boolean) => {
      let cancelled = false;
      if (showSpinner) setLoading(true);
      setError(null);

      listJobPipelines()
        .then(buildActions)
        .then((items) => {
          if (cancelled) return;
          setActions(items);
          setLastChecked(new Date());
          setLoading(false);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof Error ? err.message : "Could not load notifications");
          setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    },
    [],
  );

  useEffect(() => {
    const stop = load(true);

    // A notification centre that only reads once is stale the moment you act
    // anywhere else in the app. Re-read on an interval, and immediately when
    // the tab regains focus — which is when someone actually looks at it.
    const timer = window.setInterval(() => load(false), 60_000);
    const onFocus = () => load(false);
    window.addEventListener("focus", onFocus);

    return () => {
      stop();
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [load]);

  const filtered = useMemo(
    () =>
      actions.filter(
        (a) => resolved[a.id] !== "dismissed" && (filter === "all" || a.type === filter),
      ),
    [actions, filter, resolved],
  );

  const pending = useMemo(
    () => actions.filter((a) => !resolved[a.id]),
    [actions, resolved],
  );
  const pendingCount = pending.length;

  // How many *people* are waiting on you, counted once each. Summing the
  // per-card figures counted anyone sitting on two boards twice, which is
  // why this number never matched the candidate list.
  const peopleWaiting = useMemo(() => {
    const seen = new Set<string>();
    for (const action of pending) {
      for (const person of action.people) seen.add(person.id ?? person.name);
    }
    return seen.size;
  }, [pending]);

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
            <Bell className="h-4 w-4" /> Notifications
          </div>
          <h1 className="font-display text-2xl font-extrabold tracking-tight sm:text-3xl">
            What needs you
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Things that came up across your roles while you were away. Read them, act on the ones
            that matter, and clear the rest — nothing here happens on its own.
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-2 rounded-xl px-3 py-1.5 text-xs font-semibold",
            pendingCount === 0
              ? "bg-success/15 text-success"
              : "bg-primary-soft text-primary-soft-foreground",
          )}
        >
          {pendingCount === 0 ? (
            <>
              <CheckCircle2 className="h-3.5 w-3.5" /> Nothing waiting
            </>
          ) : (
            <>
              <Bell className="h-3.5 w-3.5" />
              {pendingCount} unread
              {peopleWaiting > 0 && ` · about ${peopleWaiting} ${peopleWaiting === 1 ? "person" : "people"}`}
            </>
          )}
        </span>
      </header>

      {lastChecked && (
        <p className="-mt-2 text-[11px] text-muted-foreground">
          Checked {lastChecked.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })} ·
          updates on its own every minute and whenever you come back to this tab.
        </p>
      )}

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
            <h3 className="font-display text-lg font-bold">You are all caught up</h3>
            <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
              Nothing needs your attention across your roles right now. New notifications appear
              here as candidates move and your job ads get more applicants.
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
                            <Badge className="border-destructive/30 bg-destructive/15 text-[11px] uppercase text-destructive">
                              High priority
                            </Badge>
                          )}
                        </div>
                        <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">
                          {item.description}
                        </p>

                        {/* The imperative, separated from the explanation --
                            the old card left you to infer the next step from
                            a paragraph of context. */}
                        <p className="max-w-3xl pt-1 text-sm font-semibold text-foreground">
                          → {item.whatToDo}
                        </p>

                        {item.people.length > 0 && (
                          <div className="flex flex-wrap items-center gap-1.5 pt-2">
                            <span className="text-xs text-muted-foreground">
                              {item.people.length === 1 ? "Candidate:" : "Candidates:"}
                            </span>
                            {item.people.map((person) =>
                              person.id ? (
                                <Link
                                  key={person.id}
                                  to="/candidates"
                                  search={{ focus: person.id }}
                                  className="rounded-full border border-border px-2 py-0.5 text-xs font-medium transition-colors hover:border-primary hover:bg-primary/10 hover:text-primary"
                                >
                                  {person.name}
                                </Link>
                              ) : (
                                <span
                                  key={person.name}
                                  className="rounded-full border border-border px-2 py-0.5 text-xs font-medium text-muted-foreground"
                                >
                                  {person.name}
                                </span>
                              ),
                            )}
                          </div>
                        )}

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
                          {/* Only recommendations with a real backend
                              decision get an act-here button. Everything
                              else is a notification: it tells you something
                              happened and takes you to where you deal with
                              it, rather than pretending to resolve it. */}
                          {item.recommendationId ? (
                            <>
                              <Button
                                size="sm"
                                className="press rounded-xl text-xs"
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
                            </>
                          ) : (
                            <Link to={item.targetUrl}>
                              <Button size="sm" className="press rounded-xl text-xs">
                                {item.actionLabel}
                              </Button>
                            </Link>
                          )}
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
