import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  GripVertical,
  Layers,
  Loader2,
  Plus,
  Sparkles,
  Trash2,
  TrendingUp,
} from "lucide-react";
import { toast } from "sonner";
import {
  getDashboardInsights,
  getJdOptimization,
  submitCandidateDecision,
  updateJobRounds,
  type CandidateDecisionKind,
  type DashboardInsights,
  type InterviewRound,
  type JDOptimizationResponse,
  type JobResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** The board's columns, in the order a candidate moves through them. */
const STAGES = [
  { id: "screened", label: "Screened", tone: "stage-screened" },
  { id: "interviewing", label: "Interviewing", tone: "stage-interviewing" },
  { id: "interviewed", label: "Interviewed", tone: "stage-interviewed" },
  { id: "selected", label: "Selected", tone: "stage-selected" },
  { id: "hired", label: "Hired", tone: "stage-hired" },
  { id: "rejected", label: "Rejected", tone: "stage-rejected" },
] as const;

/** Which decision moves a candidate into a given stage. */
const MOVE_TO: Partial<Record<string, CandidateDecisionKind>> = {
  interviewing: "advanced",
  selected: "approved",
  hired: "hired",
  rejected: "rejected",
};

export type BoardCandidate = {
  id: string;
  name: string;
  email: string;
  title?: string | null;
  score: number;
};

// ---------------------------------------------------------------------------
// Pipeline overview: the job's interview loop
// ---------------------------------------------------------------------------

export function PipelineOverviewTab({
  job,
  stages,
  onJobUpdated,
}: {
  job: JobResponse | null;
  stages: Record<string, string>;
  onJobUpdated: (job: JobResponse) => void;
}) {
  const [rounds, setRounds] = useState<InterviewRound[]>(job?.rounds ?? []);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRounds(job?.rounds ?? []);
  }, [job]);

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    Object.values(stages).forEach((stage) => {
      tally[stage] = (tally[stage] ?? 0) + 1;
    });
    return tally;
  }, [stages]);

  async function save() {
    if (!job) return;
    setSaving(true);
    try {
      const updated = await updateJobRounds(
        job.id,
        rounds.map((r, i) => ({ ...r, sequence: i + 1 })),
      );
      onJobUpdated(updated);
      setEditing(false);
      toast.success("Interview loop saved");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save the loop");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flow">
      <section className="edge-accent rounded-2xl border bg-card p-6 shadow-sm">
        <header className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
              <Layers className="h-4 w-4" /> Interview loop
            </div>
            <h3 className="mt-1 text-lg font-semibold tracking-tight">
              Rounds for this role
            </h3>
            <p className="mt-1 text-xs text-muted-foreground">
              The stages a candidate moves through. These drive the board and what the
              interviewer sees on a handoff.
            </p>
          </div>
          {editing ? (
            <div className="flex gap-2">
              <Button size="sm" className="rounded-lg" disabled={saving} onClick={() => void save()}>
                {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Save loop
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="rounded-lg"
                onClick={() => {
                  setRounds(job?.rounds ?? []);
                  setEditing(false);
                }}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="outline" className="rounded-lg" onClick={() => setEditing(true)}>
              Edit loop
            </Button>
          )}
        </header>

        {rounds.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            No rounds defined yet. Edit the loop to add them.
          </p>
        ) : (
          <ol className="stagger mt-5 grid gap-3 md:grid-cols-2">
            {rounds.map((round, index) => (
              <li key={round.id ?? index} className="lift rounded-xl border p-4">
                {editing ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <GripVertical className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <Input
                        value={round.name}
                        onChange={(e) =>
                          setRounds((prev) =>
                            prev.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)),
                          )
                        }
                        className="h-8 rounded-lg text-xs"
                        placeholder="Round name"
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        aria-label={`Remove ${round.name}`}
                        className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                        onClick={() => setRounds((prev) => prev.filter((_, i) => i !== index))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <Input
                      value={round.focus ?? ""}
                      onChange={(e) =>
                        setRounds((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, focus: e.target.value } : r)),
                        )
                      }
                      className="h-8 rounded-lg text-xs"
                      placeholder="What this round is for"
                    />
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-[11px] font-bold text-primary">
                        {index + 1}
                      </span>
                      <p className="text-sm font-semibold">{round.name}</p>
                      <span className="ml-auto text-[11px] text-muted-foreground">
                        {round.duration_minutes}m
                      </span>
                    </div>
                    {round.focus && (
                      <p className="mt-2 pl-8 text-xs leading-relaxed text-muted-foreground">
                        {round.focus}
                      </p>
                    )}
                  </>
                )}
              </li>
            ))}
          </ol>
        )}

        {editing && (
          <Button
            size="sm"
            variant="outline"
            className="mt-4 rounded-lg"
            onClick={() =>
              setRounds((prev) => [
                ...prev,
                {
                  id: `new-${prev.length + 1}`,
                  name: "New round",
                  sequence: prev.length + 1,
                  focus: "",
                  interview_type: "Technical Interview",
                  duration_minutes: 45,
                },
              ])
            }
          >
            <Plus className="mr-1.5 h-3.5 w-3.5" /> Add round
          </Button>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h3 className="text-sm font-semibold">Where candidates are right now</h3>
        <div className="stagger mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {STAGES.map((stage) => (
            <div key={stage.id} className="lift rounded-xl border p-4 text-center">
              <p className={cn("metric text-2xl font-bold", stage.tone)}>
                {counts[stage.id] ?? 0}
              </p>
              <p className="mt-1 text-[11px] font-medium text-muted-foreground">{stage.label}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stage board
// ---------------------------------------------------------------------------

export function StageBoardTab({
  candidates,
  stages,
  jobTitle,
  onMoved,
}: {
  candidates: BoardCandidate[];
  stages: Record<string, string>;
  jobTitle: string;
  onMoved: () => void;
}) {
  const [moving, setMoving] = useState<string | null>(null);

  const columns = useMemo(() => {
    const grouped: Record<string, BoardCandidate[]> = {};
    STAGES.forEach((s) => (grouped[s.id] = []));
    candidates.forEach((candidate) => {
      const stage = stages[candidate.id] ?? "screened";
      (grouped[stage] ??= []).push(candidate);
    });
    return grouped;
  }, [candidates, stages]);

  async function move(candidate: BoardCandidate, target: string) {
    const decision = MOVE_TO[target];
    if (!decision) return;
    setMoving(candidate.id);
    try {
      await submitCandidateDecision({
        candidate_id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        decision,
        job_title: jobTitle,
      });
      toast.success(`${candidate.name} moved to ${target}`);
      onMoved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not move the candidate");
    } finally {
      setMoving(null);
    }
  }

  if (candidates.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-16 text-center text-sm text-muted-foreground">
        No candidates for this role yet. Upload résumés to populate the board.
      </p>
    );
  }

  return (
    <div className="grid gap-3 overflow-x-auto pb-2 lg:grid-cols-6">
      {STAGES.map((stage) => (
        <section key={stage.id} className="min-w-[220px] rounded-2xl border bg-card/60 p-3">
          <header className="flex items-center justify-between px-1 pb-2">
            <h3 className={cn("text-xs font-bold uppercase tracking-wide", stage.tone)}>
              {stage.label}
            </h3>
            <span className="metric rounded-full bg-secondary px-2 py-0.5 text-[10px] font-bold">
              {columns[stage.id]?.length ?? 0}
            </span>
          </header>

          <ul className="flow-tight">
            {(columns[stage.id] ?? []).map((candidate) => (
              <li key={candidate.id} className="lift rounded-xl border bg-background p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-xs font-semibold">{candidate.name}</p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {candidate.title || "—"}
                    </p>
                  </div>
                  <span className="metric shrink-0 text-xs font-bold text-primary">
                    {candidate.score}
                  </span>
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1">
                  {STAGES.filter((s) => s.id !== stage.id && MOVE_TO[s.id]).map((target) => (
                    <button
                      key={target.id}
                      disabled={moving === candidate.id}
                      onClick={() => void move(candidate, target.id)}
                      className="rounded-md border px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-40"
                    >
                      {moving === candidate.id ? "…" : `→ ${target.label}`}
                    </button>
                  ))}
                </div>
              </li>
            ))}
            {(columns[stage.id] ?? []).length === 0 && (
              <li className="rounded-xl border border-dashed px-2 py-6 text-center text-[11px] text-muted-foreground">
                Empty
              </li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// JD insights & skew analysis
// ---------------------------------------------------------------------------

export function JdInsightsTab({ jobId }: { jobId: string }) {
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [optimization, setOptimization] = useState<JDOptimizationResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.allSettled([getDashboardInsights(jobId), getJdOptimization(jobId)])
      .then(([i, o]) => {
        if (cancelled) return;
        if (i.status === "fulfilled") setInsights(i.value);
        if (o.status === "fulfilled") setOptimization(o.value);
        if (i.status === "rejected" && o.status === "rejected") {
          setError("Could not load insights for this role");
        }
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  if (loading) {
    return (
      <p className="flex items-center gap-2 px-1 py-10 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Analysing this role against the pool…
      </p>
    );
  }
  if (error) {
    return <p className="rounded-xl bg-destructive/10 px-4 py-3 text-xs text-destructive">{error}</p>;
  }

  const coverage = insights?.skill_coverage ?? [];
  /**
   * Skew: how lopsided the pool is against each requirement. A requirement
   * almost everyone meets tells you little; one almost nobody meets is either
   * the real bar or an unrealistic ask — both worth surfacing.
   */
  const skew = [...coverage]
    .map((row) => ({ ...row, distance: Math.abs(50 - (row.coverage_pct ?? 0)) }))
    .sort((a, b) => b.distance - a.distance)
    .slice(0, 8);

  return (
    <div className="flow">
      <section className="grid gap-3 sm:grid-cols-3">
        {[
          { label: "Candidates evaluated", value: insights?.evaluated_candidates ?? 0 },
          { label: "Average match", value: `${Math.round(insights?.average_score ?? 0)}` },
          { label: "Average experience", value: `${(insights?.average_experience_years ?? 0).toFixed(1)}y` },
        ].map((tile) => (
          <div key={tile.label} className="lift edge-accent rounded-2xl border bg-card p-5">
            <p className="metric text-2xl font-bold">{tile.value}</p>
            <p className="mt-1 text-[11px] font-medium text-muted-foreground">{tile.label}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <TrendingUp className="h-4 w-4" /> Requirement skew
        </div>
        <h3 className="mt-1 text-lg font-semibold tracking-tight">
          How the pool lines up against each requirement
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Requirements almost everyone meets are not filtering; ones almost nobody meets may be
          costing you candidates.
        </p>

        {skew.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            No coverage data yet — score some candidates against this role first.
          </p>
        ) : (
          <ul className="stagger mt-5 space-y-3">
            {skew.map((row) => {
              const pct = Math.round(row.coverage_pct ?? 0);
              const tone = pct >= 80 ? "bg-chart-3" : pct <= 20 ? "bg-destructive" : "bg-primary";
              return (
                <li key={row.skill} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center justify-between text-xs">
                      <span className="truncate font-medium">{row.skill}</span>
                      <span className="metric ml-2 text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-secondary">
                      <div
                        className={cn("h-full rounded-full transition-[width] duration-700", tone)}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  <span
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      pct >= 80
                        ? "bg-secondary text-muted-foreground"
                        : pct <= 20
                          ? "bg-destructive/10 text-destructive"
                          : "bg-primary/10 text-primary",
                    )}
                  >
                    {pct >= 80 ? "Not filtering" : pct <= 20 ? "Very few qualify" : "Discriminating"}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="h-4 w-4" /> JD recommendations
        </div>
        <h3 className="mt-1 text-lg font-semibold tracking-tight">What to change in the posting</h3>
        {optimization?.summary && (
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{optimization.summary}</p>
        )}

        {(optimization?.recommendations ?? []).length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            {optimization?.empty_reason ?? "No recommendations for this role yet."}
          </p>
        ) : (
          <ul className="stagger mt-5 space-y-2.5">
            {(optimization?.recommendations ?? []).map((rec) => (
              <li key={rec.id} className="lift rounded-xl border p-4">
                <div className="flex items-start gap-2.5">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    {rec.classification === "balanced" ? (
                      <CheckCircle2 className="h-3.5 w-3.5" />
                    ) : (
                      <AlertTriangle className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-sm font-semibold">{rec.skill}</p>
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                        {rec.classification.replace(/_/g, " ")}
                      </span>
                      {rec.is_must_have && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                          Must have
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {rec.suggested_modification}
                    </p>
                    <p className="metric mt-1.5 text-[11px] text-muted-foreground/80">
                      {rec.candidates_matching}/{rec.total_candidates} candidates match ·{" "}
                      {Math.round(rec.coverage_pct)}% coverage
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {insights?.qualification_gaps_summary && (
        <section className="rounded-2xl border bg-card p-6 shadow-sm">
          <h3 className="text-sm font-semibold">Qualification gaps</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {insights.qualification_gaps_summary}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(insights.common_missing_skills ?? []).slice(0, 10).map((gap) => (
              <span
                key={gap.skill}
                className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-[11px] font-medium text-destructive"
              >
                {gap.skill} <span className="metric opacity-70">×{gap.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="flex items-center gap-1.5 px-1 text-[11px] text-muted-foreground">
        <ArrowRight className="h-3 w-3" /> Coverage and skew are computed from candidates scored
        against this role, so they sharpen as you screen more people.
      </p>
    </div>
  );
}
