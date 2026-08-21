import { BoardGuide } from "@/components/board-guide";
import { RoundQuestions } from "@/components/round-questions";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  UserRound,
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
  moveCandidateInPipeline,
  submitCandidateDecision,
  updateJobRounds,
  type CandidateDecisionKind,
  type DashboardInsights,
  type InterviewRound,
  type JDOptimizationResponse,
  type JobResponse,
  type PipelineCandidate,
  type PipelineStage,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  columnKeyFor,
  columnsForJob,
  nextColumn,
  STAGES,
  type PipelineColumn,
} from "@/lib/pipeline";
import { cn } from "@/lib/utils";
import { MovedByTag } from "@/components/pipeline-progress";

/**
 * Which stages have a candidate-facing email behind them.
 *
 * Moving someone is a pipeline change, not a message: the email is offered
 * as an explicit follow-up on the toast rather than sent automatically, so
 * dragging a card can never mail a candidate by accident.
 */
const DECISION_FOR: Partial<Record<PipelineStage, CandidateDecisionKind>> = {
  interviewing: "advanced",
  selected: "approved",
  hired: "hired",
  rejected: "rejected",
};

/**
 * Blind review hides identity so scores are read before names are.
 *
 * These boards used to render `candidate.name` unconditionally, so turning
 * blind review on masked the ranking table and left every name on show one
 * tab across -- the toggle looked respected while the protection had already
 * lapsed. Ordering is by the candidate list, so a person keeps the same
 * number wherever they appear.
 */
export function blindLabel(
  candidate: { id: string; name: string },
  order: Map<string, number>,
  blindMode: boolean,
): string {
  if (!blindMode) return candidate.name;
  const position = order.get(candidate.id);
  return position === undefined ? "Candidate" : `Candidate #${position + 1}`;
}

export function candidateOrder(candidates: { id: string }[]): Map<string, number> {
  return new Map(candidates.map((c, index) => [c.id, index]));
}

export type BoardCandidate = {
  id: string;
  name: string;
  email: string;
  title?: string | null;
  score: number;
};

/**
 * Moving a candidate, shared by the board and the pipeline overview.
 *
 * The move persists first and the caller re-reads the pipeline; the board
 * renders stored placements rather than an optimistic guess, so a rejected
 * write can never leave a card in the wrong column.
 */
function useCandidateMover({
  jobId,
  jobTitle,
  onMoved,
}: {
  jobId: string;
  jobTitle: string;
  onMoved: () => void;
}) {
  const [moving, setMoving] = useState<string | null>(null);

  const move = useCallback(
    async (candidate: BoardCandidate, column: PipelineColumn) => {
      // The job can still be loading; without an id the move would POST to a
      // malformed URL and fail in a way that reads like a server problem.
      if (!jobId) {
        toast.error("Still loading this role — try again in a moment.");
        return;
      }
      setMoving(candidate.id);
      try {
        await moveCandidateInPipeline(jobId, candidate.id, {
          stage: column.stage,
          round_id: column.roundId ?? null,
          candidate_name: candidate.name,
        });
        onMoved();

        const decision = DECISION_FOR[column.stage];
        toast.success(
          `${candidate.name} → ${column.label}`,
          decision
            ? {
                action: {
                  label: "Email them",
                  onClick: () => {
                    void submitCandidateDecision({
                      candidate_id: candidate.id,
                      name: candidate.name,
                      email: candidate.email,
                      decision,
                      job_title: jobTitle,
                    })
                      .then(() => toast.success(`Emailed ${candidate.name}`))
                      .catch((err) =>
                        toast.error(err instanceof Error ? err.message : "Email not sent"),
                      );
                  },
                },
              }
            : undefined,
        );
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not move the candidate");
      } finally {
        setMoving(null);
      }
    },
    [jobId, jobTitle, onMoved],
  );

  return { moving, move };
}

/** The stages a candidate can be sent to from a card, as a compact menu. */
function MoveMenu({
  columns,
  currentKey,
  disabled,
  onMove,
}: {
  columns: PipelineColumn[];
  currentKey: string;
  disabled: boolean;
  onMove: (column: PipelineColumn) => void;
}) {
  return (
    <select
      aria-label="Move to"
      disabled={disabled}
      value=""
      onChange={(e) => {
        const next = columns.find((c) => c.key === e.target.value);
        if (next) onMove(next);
        e.currentTarget.value = "";
      }}
      className="w-full rounded-md border bg-background px-1.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 disabled:opacity-40"
    >
      <option value="">{disabled ? "Moving…" : "Move to…"}</option>
      {columns
        .filter((c) => c.key !== currentKey)
        .map((column) => (
          <option key={column.key} value={column.key}>
            {column.label}
          </option>
        ))}
    </select>
  );
}

/**
 * Who runs a round, on the column that represents it.
 *
 * A hiring manager opening the board wants one question answered — what is
 * waiting on me — and previously had to open every candidate to find out
 * which rounds were theirs.
 */
function InterviewerTag({ column }: { column: PipelineColumn }) {
  if (!column.roundId) return null;
  const name = column.interviewerName?.trim();
  return (
    <span
      className={cn(
        "mt-1 flex items-center gap-1 text-[11px]",
        name ? "text-muted-foreground" : "text-muted-foreground/60 italic",
      )}
      title={column.interviewerEmail || undefined}
    >
      <UserRound className="h-3 w-3 shrink-0" />
      <span className="truncate">{name || "No interviewer assigned"}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pipeline overview: the job's interview loop
// ---------------------------------------------------------------------------

export function PipelineOverviewTab({
  job,
  placements,
  candidates,
  onJobUpdated,
  onMoved,
  blindMode,
  roundsOnly = false,
}: {
  job: JobResponse | null;
  placements: Record<string, PipelineCandidate>;
  candidates: BoardCandidate[];
  onJobUpdated: (job: JobResponse) => void;
  onMoved: () => void;
  blindMode: boolean;
  /** Render only the interview-loop editor. The standalone overview tab was
   *  removed, but editing the rounds still has to live somewhere — it is now
   *  a panel on the board itself. */
  roundsOnly?: boolean;
}) {
  const [rounds, setRounds] = useState<InterviewRound[]>(job?.rounds ?? []);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRounds(job?.rounds ?? []);
  }, [job]);

  const columns = useMemo(() => columnsForJob(job?.rounds), [job?.rounds]);
  const order = useMemo(() => candidateOrder(candidates), [candidates]);
  const { moving, move } = useCandidateMover({
    jobId: job?.id ?? "",
    jobTitle: job?.title ?? "this role",
    onMoved,
  });

  /** Candidates grouped by the column they are in, so each round can show
   * who is actually sitting in it. */
  const byColumn = useMemo(() => {
    const grouped: Record<string, BoardCandidate[]> = {};
    columns.forEach((c) => (grouped[c.key] = []));
    candidates.forEach((candidate) => {
      const row = placements[candidate.id];
      const key = row ? columnKeyFor(row, columns) : "screened";
      (grouped[key] ??= []).push(candidate);
    });
    return grouped;
  }, [candidates, placements, columns]);

  const counts = useMemo(() => {
    const tally: Record<string, number> = {};
    Object.values(placements).forEach((row) => {
      tally[row.stage] = (tally[row.stage] ?? 0) + 1;
    });
    return tally;
  }, [placements]);

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

  // Board panel: the loop editor on its own.
  if (roundsOnly) {
    return (
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
                      {/* Assigning the round here is what makes the board
                          answer "what is waiting on me" for a hiring manager. */}
                      <div className="flex gap-2">
                        <Input
                          value={round.interviewer_name ?? ""}
                          onChange={(e) =>
                            setRounds((prev) =>
                              prev.map((r, i) =>
                                i === index ? { ...r, interviewer_name: e.target.value } : r,
                              ),
                            )
                          }
                          className="h-8 rounded-lg text-xs"
                          placeholder="Interviewer name"
                        />
                        <Input
                          value={round.interviewer_email ?? ""}
                          onChange={(e) =>
                            setRounds((prev) =>
                              prev.map((r, i) =>
                                i === index ? { ...r, interviewer_email: e.target.value } : r,
                              ),
                            )
                          }
                          className="h-8 rounded-lg text-xs"
                          placeholder="Interviewer email"
                        />
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                          {index + 1}
                        </span>
                        <p className="text-sm font-semibold">{round.name}</p>
                        <span className="ml-auto text-xs text-muted-foreground">
                          {round.duration_minutes}m
                        </span>
                      </div>
                      {round.focus && (
                        <p className="mt-2 pl-8 text-xs leading-relaxed text-muted-foreground">
                          {round.focus}
                        </p>
                      )}
                      <p
                        className={cn(
                          "mt-1 flex items-center gap-1 pl-8 text-xs",
                          round.interviewer_name
                            ? "text-muted-foreground"
                            : "text-muted-foreground/60 italic",
                        )}
                        title={round.interviewer_email || undefined}
                      >
                        <UserRound className="h-3 w-3 shrink-0" />
                        {round.interviewer_name || "No interviewer assigned"}
                      </p>

                      {/* The question bank belongs with the round it is for.
                          It was built end to end on the backend and had no
                          screen at all, so none of it was reachable. */}
                      <details className="mt-3 pl-8">
                        <summary className="cursor-pointer text-xs font-semibold text-primary">
                          Interview questions
                        </summary>
                        <div className="mt-3">
                          <RoundQuestions
                            jobId={String(job?.id ?? "")}
                            roundId={round.id}
                            roundName={round.name}
                          />
                        </div>
                      </details>
  
                      <RoundRoster
                        order={order}
                        blindMode={blindMode}
                        occupants={byColumn[`interviewing:${round.id}`] ?? []}
                        columns={columns}
                        currentKey={`interviewing:${round.id}`}
                        moving={moving}
                        onMove={move}
                        placements={placements}
                      />
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
    );
  }

  return (
    <div className="flow">
      <BoardGuide columns={columns} variant="overview" />

      {/* Everyone not currently in a round, so the overview can move a
          candidate all the way from screened to hired without the board. */}
      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <h3 className="text-sm font-semibold">Before and after the loop</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Candidates waiting to start, and those the loop is done with.
        </p>
        <div className="stagger mt-4 grid gap-3 md:grid-cols-2">
          {columns
            .filter((column) => !column.roundId)
            .map((column) => (
              <div key={column.key} className="lift rounded-xl border p-4">
                <div className="flex items-center gap-2">
                  <h4 className={cn("text-xs font-bold uppercase tracking-wide", column.tone)}>
                    {column.label}
                  </h4>
                  <span className="metric ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold">
                    {(byColumn[column.key] ?? []).length}
                  </span>
                </div>
                <RoundRoster
                  order={order}
                  blindMode={blindMode}
                  occupants={byColumn[column.key] ?? []}
                  columns={columns}
                  currentKey={column.key}
                  moving={moving}
                  onMove={move}
                  placements={placements}
                />
              </div>
            ))}
        </div>
      </section>

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
                    {/* Assigning the round here is what makes the board
                        answer "what is waiting on me" for a hiring manager. */}
                    <div className="flex gap-2">
                      <Input
                        value={round.interviewer_name ?? ""}
                        onChange={(e) =>
                          setRounds((prev) =>
                            prev.map((r, i) =>
                              i === index ? { ...r, interviewer_name: e.target.value } : r,
                            ),
                          )
                        }
                        className="h-8 rounded-lg text-xs"
                        placeholder="Interviewer name"
                      />
                      <Input
                        value={round.interviewer_email ?? ""}
                        onChange={(e) =>
                          setRounds((prev) =>
                            prev.map((r, i) =>
                              i === index ? { ...r, interviewer_email: e.target.value } : r,
                            ),
                          )
                        }
                        className="h-8 rounded-lg text-xs"
                        placeholder="Interviewer email"
                      />
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-bold text-primary">
                        {index + 1}
                      </span>
                      <p className="text-sm font-semibold">{round.name}</p>
                      <span className="ml-auto text-xs text-muted-foreground">
                        {round.duration_minutes}m
                      </span>
                    </div>
                    {round.focus && (
                      <p className="mt-2 pl-8 text-xs leading-relaxed text-muted-foreground">
                        {round.focus}
                      </p>
                    )}
                    <p
                      className={cn(
                        "mt-1 flex items-center gap-1 pl-8 text-xs",
                        round.interviewer_name
                          ? "text-muted-foreground"
                          : "text-muted-foreground/60 italic",
                      )}
                      title={round.interviewer_email || undefined}
                    >
                      <UserRound className="h-3 w-3 shrink-0" />
                      {round.interviewer_name || "No interviewer assigned"}
                    </p>

                    <RoundRoster
                      order={order}
                      blindMode={blindMode}
                      occupants={byColumn[`interviewing:${round.id}`] ?? []}
                      columns={columns}
                      currentKey={`interviewing:${round.id}`}
                      moving={moving}
                      onMove={move}
                      placements={placements}
                    />
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
              <p className="mt-1 text-xs font-medium text-muted-foreground">{stage.label}</p>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/**
 * Who is sitting in one column, with a control to send each of them
 * somewhere else. Used for both a round and the stages either side of the
 * loop, so every position is movable from the overview.
 */
function RoundRoster({
  occupants,
  columns,
  currentKey,
  moving,
  onMove,
  order,
  blindMode,
  placements,
}: {
  occupants: BoardCandidate[];
  columns: PipelineColumn[];
  currentKey: string;
  moving: string | null;
  onMove: (candidate: BoardCandidate, column: PipelineColumn) => void;
  order: Map<string, number>;
  blindMode: boolean;
  placements: Record<string, PipelineCandidate>;
}) {
  if (occupants.length === 0) {
    return (
      <p className="mt-3 rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
        Nobody here yet
      </p>
    );
  }

  const advanceTo = nextColumn(currentKey, columns);

  return (
    <ul className="mt-3 space-y-1.5">
      {occupants.map((candidate) => (
        <li
          key={candidate.id}
          className="flex flex-wrap items-center gap-2 rounded-lg border bg-background px-2.5 py-2"
        >
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-semibold">
              {blindLabel(candidate, order, blindMode)}
            </p>
            <p className="truncate text-xs text-muted-foreground">{candidate.title || "—"}</p>
            <MovedByTag placement={placements[candidate.id] ?? null} />
          </div>
          <span className="metric shrink-0 text-xs font-bold text-primary">{candidate.score}</span>

          {/* Advancing is the common case, so it should not need a menu. */}
          {advanceTo && (
            <Button
              size="sm"
              variant="outline"
              disabled={moving === candidate.id}
              className="h-7 shrink-0 rounded-lg text-xs"
              title={`Advance to ${advanceTo.label}`}
              onClick={() => onMove(candidate, advanceTo)}
            >
              {moving === candidate.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <>
                  <ArrowRight className="mr-1 h-3 w-3" /> Advance
                </>
              )}
            </Button>
          )}

          <div className="w-32 shrink-0">
            <MoveMenu
              columns={columns}
              currentKey={currentKey}
              disabled={moving === candidate.id}
              onMove={(column) => onMove(candidate, column)}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------
// Stage board
// ---------------------------------------------------------------------------

export function StageBoardTab({
  job,
  jobId,
  candidates,
  placements,
  onMoved,
  blindMode,
}: {
  job: JobResponse | null;
  jobId: string;
  candidates: BoardCandidate[];
  placements: Record<string, PipelineCandidate>;
  onMoved: () => void;
  blindMode: boolean;
}) {
  const columns = useMemo(() => columnsForJob(job?.rounds), [job?.rounds]);
  const order = useMemo(() => candidateOrder(candidates), [candidates]);
  const { moving, move } = useCandidateMover({
    jobId,
    jobTitle: job?.title ?? "this role",
    onMoved,
  });

  //: The column a card is being dragged over, so the drop target is visible.
  const [dragOver, setDragOver] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);

  const grouped = useMemo(() => {
    const byColumn: Record<string, BoardCandidate[]> = {};
    columns.forEach((c) => (byColumn[c.key] = []));
    candidates.forEach((candidate) => {
      const row = placements[candidate.id];
      const key = row ? columnKeyFor(row, columns) : "screened";
      (byColumn[key] ??= []).push(candidate);
    });
    return byColumn;
  }, [candidates, placements, columns]);

  function handleDrop(column: PipelineColumn) {
    setDragOver(null);
    const candidate = candidates.find((c) => c.id === dragging);
    setDragging(null);
    if (!candidate) return;
    // Dropping a card back where it started is not a move.
    const row = placements[candidate.id];
    const currentKey = row ? columnKeyFor(row, columns) : "screened";
    if (currentKey === column.key) return;
    void move(candidate, column);
  }

  if (candidates.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed px-4 py-16 text-center text-sm text-muted-foreground">
        No candidates for this role yet. Upload résumés to populate the board.
      </p>
    );
  }

  return (
    <div className="flow-tight">
      <BoardGuide columns={columns} variant="board" />

      <p className="px-1 text-xs text-muted-foreground">
        Drag a candidate between columns, or use the menu on a card. Moving someone never emails
        them on its own — the toast offers that separately.
      </p>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {columns.map((column) => (
          <section
            key={column.key}
            onDragOver={(e) => {
              // Without this the browser refuses the drop entirely.
              e.preventDefault();
              setDragOver(column.key);
            }}
            onDragLeave={() => setDragOver((k) => (k === column.key ? null : k))}
            onDrop={(e) => {
              e.preventDefault();
              handleDrop(column);
            }}
            className={cn(
              "w-[220px] shrink-0 rounded-2xl border bg-card/60 p-3 transition-colors",
              dragOver === column.key && "border-primary bg-primary/5",
            )}
          >
            <header className="flex items-center justify-between gap-2 px-1 pb-2">
              <h3
                className={cn(
                  "truncate text-xs font-bold uppercase tracking-wide",
                  column.tone,
                )}
                title={column.label}
              >
                {column.label}
              </h3>
              <span className="metric shrink-0 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold">
                {grouped[column.key]?.length ?? 0}
              </span>
            </header>
            <div className="px-1 pb-2">
              <InterviewerTag column={column} />
            </div>

            <ul className="flow-tight">
              {(grouped[column.key] ?? []).map((candidate) => (
                <li
                  key={candidate.id}
                  draggable={moving !== candidate.id}
                  onDragStart={() => setDragging(candidate.id)}
                  onDragEnd={() => {
                    setDragging(null);
                    setDragOver(null);
                  }}
                  className={cn(
                    "lift cursor-grab rounded-xl border bg-background p-3 active:cursor-grabbing",
                    dragging === candidate.id && "opacity-50",
                    moving === candidate.id && "pointer-events-none opacity-60",
                  )}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">
                        {blindLabel(candidate, order, blindMode)}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {candidate.title || "—"}
                      </p>
                      <MovedByTag placement={placements[candidate.id] ?? null} />
                    </div>
                    <span className="metric shrink-0 text-xs font-bold text-primary">
                      {candidate.score}
                    </span>
                  </div>

                  <div className="mt-2.5">
                    <MoveMenu
                      columns={columns}
                      currentKey={column.key}
                      disabled={moving === candidate.id}
                      onMove={(target) => void move(candidate, target)}
                    />
                  </div>
                </li>
              ))}
              {(grouped[column.key] ?? []).length === 0 && (
                <li className="rounded-xl border border-dashed px-2 py-6 text-center text-xs text-muted-foreground">
                  {dragOver === column.key ? "Drop here" : "Empty"}
                </li>
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Job description insights: how the pool matches each requirement
// ---------------------------------------------------------------------------

/**
 * Plain-English names for the optimiser's classifications.
 *
 * The raw keys were rendered with the underscores swapped for spaces, so the
 * page showed "low signal" and "under filtered" — internal vocabulary that
 * says nothing to the recruiter who has to act on it.
 */
const REQUIREMENT_VERDICT: Record<string, { label: string; meaning: string }> = {
  too_strict: {
    label: "Ruling people out",
    meaning: "Very few candidates meet this, so it is shrinking your pool sharply.",
  },
  low_signal: {
    label: "Not telling you much",
    meaning: "Almost everyone meets this, so it does not separate strong candidates from weak ones.",
  },
  under_filtered: {
    label: "Too broad",
    meaning: "Nearly every candidate matches, so this is not doing any filtering.",
  },
  balanced: {
    label: "Working well",
    meaning: "This splits the pool usefully — no change needed.",
  },
  insufficient_data: {
    label: "Not enough data yet",
    meaning: "Too few candidates have been scored to judge this requirement.",
  },
};

function verdictFor(classification: string) {
  return (
    REQUIREMENT_VERDICT[classification] ?? {
      label: classification.replace(/_/g, " "),
      meaning: "",
    }
  );
}

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
   * Ordered by how lopsided each requirement is. One almost everyone meets
   * tells you little; one almost nobody meets is either the real bar or an
   * unrealistic ask — both worth surfacing, and both sit far from 50%.
   */
  const mostLopsided = [...coverage]
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
            <p className="mt-1 text-xs font-medium text-muted-foreground">{tile.label}</p>
          </div>
        ))}
      </section>

      <section className="rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <TrendingUp className="h-4 w-4" /> Requirement match rates
        </div>
        <h3 className="mt-1 text-lg font-semibold tracking-tight">
          How many of your candidates meet each requirement
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          A requirement nearly everyone meets is not narrowing the field. One almost nobody meets
          is either your real bar or an ask that is costing you good candidates.
        </p>

        {mostLopsided.length === 0 ? (
          <p className="mt-5 rounded-xl border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
            No coverage data yet — score some candidates against this role first.
          </p>
        ) : (
          <ul className="stagger mt-5 space-y-3">
            {mostLopsided.map((row) => {
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
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold",
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
          <Sparkles className="h-4 w-4" /> Suggested edits
        </div>
        <h3 className="mt-1 text-lg font-semibold tracking-tight">What to change in the job description</h3>
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
                      <span
                        className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground"
                        title={verdictFor(rec.classification).meaning}
                      >
                        {verdictFor(rec.classification).label}
                      </span>
                      {rec.is_must_have && (
                        <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
                          Must have
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                      {verdictFor(rec.classification).meaning}
                    </p>
                    <p className="mt-1 text-xs font-medium leading-relaxed">
                      {rec.suggested_modification}
                    </p>
                    <p className="metric mt-1.5 text-xs text-muted-foreground/80">
                      {rec.candidates_matching} of {rec.total_candidates} candidates meet this (
                      {Math.round(rec.coverage_pct)}%)
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
          <h3 className="text-sm font-semibold">Skills your candidates are missing most</h3>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">
            {insights.qualification_gaps_summary}
          </p>
          <div className="mt-4 flex flex-wrap gap-1.5">
            {(insights.common_missing_skills ?? []).slice(0, 10).map((gap) => (
              <span
                key={gap.skill}
                className="rounded-full bg-destructive/10 px-2.5 py-0.5 text-xs font-medium text-destructive"
              >
                {gap.skill} <span className="metric opacity-70">×{gap.count}</span>
              </span>
            ))}
          </div>
        </section>
      )}

      <p className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground">
        <ArrowRight className="h-3 w-3" /> These figures come from candidates already scored
        against this role, so they get more reliable as you screen more people.
      </p>
    </div>
  );
}
