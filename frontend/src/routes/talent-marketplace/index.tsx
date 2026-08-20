import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Search, Send, Users2 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { ScoreRing } from "@/components/score-ring";
import { EvaluationSummary } from "@/components/copilot/structured/evaluation-summary";
import { useAppState } from "@/lib/app-state";
import {
  createHandoff,
  getInternalMatches,
  listJobPipelines,
  type AgentEvaluationSummary,
  type JobPipelineSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/talent-marketplace/")({
  head: () => ({
    meta: [
      { title: "Internal Talent Marketplace — ResumeIQ" },
      {
        name: "description",
        content:
          "Match bench and internal employees against open roles, with bench-priority ordering and one-click move to pipeline.",
      },
      { property: "og:title", content: "Internal Talent Marketplace — ResumeIQ" },
      {
        property: "og:description",
        content: "Automatic internal/bench candidate matching against open jobs.",
      },
    ],
  }),
  component: TalentMarketplacePage,
});

type SortMode = "recommended" | "score";

function memberKey(member: AgentEvaluationSummary, index: number): string {
  return member.candidate.candidate_id ?? `${member.candidate.label}-${index}`;
}

function BenchBadge({ member }: { member: AgentEvaluationSummary }) {
  const { source, employment_status, current_assignment } = member.candidate;
  if (source !== "internal") return null;
  if (employment_status === "bench") {
    return (
      <Badge className="border-transparent bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning">
        On bench
      </Badge>
    );
  }
  return (
    <Badge className="border-transparent bg-secondary text-secondary-foreground">
      {current_assignment || "Assigned"}
    </Badge>
  );
}

function TalentMarketplacePage() {
  const { setViewingJobId, setViewingCandidateId } = useAppState();

  const [jobs, setJobs] = useState<JobPipelineSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [members, setMembers] = useState<AgentEvaluationSummary[]>([]);
  const [loadingMembers, setLoadingMembers] = useState(false);

  const [query, setQuery] = useState("");
  const [benchOnly, setBenchOnly] = useState(false);
  const [minScore, setMinScore] = useState(0);
  const [sortMode, setSortMode] = useState<SortMode>("recommended");

  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const [handoffTarget, setHandoffTarget] = useState<AgentEvaluationSummary | null>(null);
  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    listJobPipelines()
      .then((rows) => {
        setJobs(rows);
        setSelectedJobId((current) => current ?? rows[0]?.job_id ?? null);
      })
      .catch(() => setJobs([]))
      .finally(() => setLoadingJobs(false));
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    setLoadingMembers(true);
    setExpandedKey(null);
    // bench_priority=true is always sent — the server applies bench-priority ordering
    // as the "recommended" order; sort mode "score" re-sorts this same fetched array
    // client-side, it never re-fetches.
    getInternalMatches(selectedJobId, true)
      .then(setMembers)
      .catch(() => setMembers([]))
      .finally(() => setLoadingMembers(false));
  }, [selectedJobId]);

  useEffect(() => {
    setViewingJobId(selectedJobId);
  }, [selectedJobId, setViewingJobId]);

  useEffect(() => {
    setViewingCandidateId(expandedKey);
  }, [expandedKey, setViewingCandidateId]);

  const filtered = useMemo(() => {
    let rows = members;
    if (benchOnly) {
      rows = rows.filter((m) => m.candidate.employment_status === "bench");
    }
    if (minScore > 0) {
      rows = rows.filter((m) => (m.candidate.score ?? 0) >= minScore);
    }
    if (query.trim() !== "") {
      const q = query.trim().toLowerCase();
      rows = rows.filter(
        (m) =>
          m.candidate.label.toLowerCase().includes(q) ||
          m.candidate.skills.some((s) => s.toLowerCase().includes(q)),
      );
    }
    if (sortMode === "score") {
      rows = [...rows].sort((a, b) => (b.candidate.score ?? 0) - (a.candidate.score ?? 0));
    }
    return rows;
  }, [members, benchOnly, minScore, query, sortMode]);

  const selectedJob = jobs.find((j) => j.job_id === selectedJobId);

  function openHandoffDialog(member: AgentEvaluationSummary) {
    setHandoffTarget(member);
    setInterviewerName("");
    setInterviewerEmail("");
  }

  async function handleMoveToPipeline() {
    if (!handoffTarget) return;
    const card = handoffTarget.candidate;
    if (!card.candidate_id) {
      toast.error("This candidate has no linked record to hand off");
      return;
    }
    if (!interviewerName.trim() || !interviewerEmail.trim()) {
      toast.error("Interviewer name and email are required");
      return;
    }
    setSubmitting(true);
    try {
      const handoff = await createHandoff({
        candidate_id: card.candidate_id,
        candidate_name: card.label,
        job_id: selectedJobId,
        job_title: selectedJob?.title ?? null,
        interviewer_name: interviewerName.trim(),
        interviewer_email: interviewerEmail.trim(),
        scorecard: {
          overall_score: card.score ?? null,
          skill_score: card.categories["skills"] ?? null,
          experience_score: card.categories["experience"] ?? null,
          education_score: card.categories["education"] ?? null,
          certification_score: card.categories["certifications"] ?? null,
          project_score: card.categories["projects"] ?? null,
        },
        matched_skills: card.skills,
        missing_skills: card.gaps,
        strengths: card.strengths.join("; "),
        weaknesses: card.gaps.join("; "),
      });
      toast.success(
        `${card.label} moved to pipeline — briefing sent to ${handoff.interviewer_name}${
          handoff.email_source === "mock" ? " (email logged — SMTP not configured)" : ""
        }`,
      );
      setHandoffTarget(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not move candidate to pipeline");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold sm:text-3xl">Internal Talent Marketplace</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Automatic matching against internal and bench employees, prioritized without overriding
          qualification requirements.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="card-surface h-fit space-y-1 p-4 lg:sticky lg:top-24">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Job
          </p>
          {loadingJobs ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
            </div>
          ) : jobs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No jobs yet.</p>
          ) : (
            <div className="max-h-[560px] space-y-1 overflow-y-auto pr-1">
              {jobs.map((job) => (
                <button
                  key={job.job_id}
                  onClick={() => setSelectedJobId(job.job_id)}
                  className={cn(
                    "w-full rounded-xl px-3 py-2 text-left text-sm transition-colors",
                    job.job_id === selectedJobId
                      ? "bg-primary-soft text-primary-soft-foreground"
                      : "hover:bg-secondary",
                  )}
                >
                  <p className="truncate font-semibold">{job.title}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {job.internal_candidates} internal · {job.total_candidates} total
                  </p>
                </button>
              ))}
            </div>
          )}
        </aside>

        <div className="min-w-0 space-y-4">
          {!selectedJobId ? (
            <div className="card-surface p-10 text-center text-sm text-muted-foreground">
              Pick a job to see matching internal candidates.
            </div>
          ) : (
            <>
              <div className="card-surface grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
                <div className="relative min-w-0">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search name or skill"
                    className="rounded-xl pl-9"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 px-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold">Bench only</p>
                    <p className="truncate text-xs text-muted-foreground">
                      Only show candidates on the bench
                    </p>
                  </div>
                  <Switch checked={benchOnly} onCheckedChange={setBenchOnly} />
                </div>

                <div className="min-w-0">
                  <p className="mb-1 text-xs text-muted-foreground">Min score: {minScore}</p>
                  <Slider
                    value={[minScore]}
                    max={100}
                    step={5}
                    onValueChange={(v) => setMinScore(v[0] ?? 0)}
                  />
                </div>

                <select
                  value={sortMode}
                  onChange={(e) => setSortMode(e.target.value as SortMode)}
                  className="h-9 min-w-0 rounded-xl border bg-background px-3 text-sm"
                >
                  <option value="recommended">Sort: recommended (bench-priority)</option>
                  <option value="score">Sort: true score</option>
                </select>
              </div>

              {loadingMembers ? (
                <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading matches…
                </div>
              ) : filtered.length === 0 ? (
                <div className="card-surface p-10 text-center">
                  <Users2 className="mx-auto h-8 w-8 text-muted-foreground" />
                  <h2 className="mt-3 text-lg font-bold">No matches</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {members.length === 0
                      ? "No internal candidates have been scored against this job yet."
                      : "No candidates match the current filters."}
                  </p>
                </div>
              ) : (
                <div className="card-surface divide-y overflow-hidden">
                  {filtered.map((member, index) => {
                    const key = memberKey(member, index);
                    const isOpen = expandedKey === key;
                    const card = member.candidate;
                    return (
                      <div key={key} className="transition-colors hover:bg-secondary/40">
                        <div className="flex flex-wrap items-center gap-4 px-5 py-4">
                          {typeof card.score === "number" && (
                            <ScoreRing value={Math.round(card.score)} size={44} />
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-bold">{card.label}</p>
                              <BenchBadge member={member} />
                            </div>
                            <p className="truncate text-xs text-muted-foreground">
                              {[card.years != null ? `${card.years} yrs` : null, card.level]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                            {card.skills.length > 0 && (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {card.skills.slice(0, 5).map((s) => (
                                  <span
                                    key={s}
                                    className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-soft-foreground"
                                  >
                                    {s}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              className="rounded-xl"
                              onClick={() => openHandoffDialog(member)}
                            >
                              <Send className="mr-1.5 h-3.5 w-3.5" /> Move to pipeline
                            </Button>
                            <button
                              onClick={() => setExpandedKey(isOpen ? null : key)}
                              aria-label="Toggle match explanation"
                              className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary"
                            >
                              <ChevronDown
                                className={cn(
                                  "h-4 w-4 transition-transform",
                                  isOpen && "rotate-180",
                                )}
                              />
                            </button>
                          </div>
                        </div>

                        {isOpen && (
                          <div className="border-t bg-secondary/30 px-5 py-5">
                            <EvaluationSummary data={member} />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <Dialog open={handoffTarget != null} onOpenChange={(open) => !open && setHandoffTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move to pipeline</DialogTitle>
            <DialogDescription>
              {handoffTarget
                ? `Hand off ${handoffTarget.candidate.label} to a technical interviewer.`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                Interviewer name
              </label>
              <Input
                value={interviewerName}
                onChange={(e) => setInterviewerName(e.target.value)}
                placeholder="Jordan Lee"
                className="rounded-xl"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                Interviewer email
              </label>
              <Input
                type="email"
                value={interviewerEmail}
                onChange={(e) => setInterviewerEmail(e.target.value)}
                placeholder="jordan.lee@company.com"
                className="rounded-xl"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              onClick={() => void handleMoveToPipeline()}
              disabled={submitting}
              className="rounded-xl"
            >
              {submitting ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Send className="mr-2 h-4 w-4" />
              )}
              Send briefing
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
