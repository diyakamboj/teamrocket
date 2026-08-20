import { Check, Circle, Search, UserRound, X } from "lucide-react";
import { useMemo, useState } from "react";
import { columnKeyFor, columnsForJob, type RoundLike } from "@/lib/pipeline";
import type { PipelineCandidate, PipelineStage } from "@/lib/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type Placement = {
  stage: PipelineStage;
  round_id?: string | null;
};

type StepState = "passed" | "current" | "upcoming";

/**
 * Where a candidate sits in this job's loop, with every finished round
 * checked off.
 *
 * Advancing past a round is what marks it passed — there is no separate
 * pass/fail toggle. Rejected is a side exit, so it is shown as a badge
 * rather than a step on the path.
 */
export function currentStageLabel(
  rounds: readonly RoundLike[] | undefined | null,
  placement?: Placement | null,
): string {
  if (placement?.stage === "rejected") return "Rejected";
  const steps = columnsForJob(rounds);
  const key = columnKeyFor(placement ?? { stage: "screened" }, steps);
  return steps.find((step) => step.key === key)?.label ?? "Reviewed";
}

type Mover = {
  moved_by?: string | null;
  moved_by_name?: string | null;
  moved_by_role?: string | null;
};

export function movedByText(placement?: Mover | null): string | null {
  if (!placement) return null;
  const name = (placement.moved_by_name || placement.moved_by || "").trim();
  if (!name) return null;
  return placement.moved_by_role ? `${name} · ${placement.moved_by_role}` : name;
}

/** Who last moved this candidate, so others can see who acted in the loop. */
export function MovedByTag({ placement }: { placement?: Mover | null }) {
  const text = movedByText(placement);
  if (!text) return null;
  return (
    <p
      className="mt-1.5 flex items-center gap-1 truncate text-[11px] text-muted-foreground"
      title={placement?.moved_by || undefined}
    >
      <UserRound className="h-3 w-3 shrink-0" />
      <span className="truncate">Moved by {text}</span>
    </p>
  );
}

export function PipelineProgress({
  rounds,
  placement,
}: {
  rounds: readonly RoundLike[] | undefined | null;
  placement?: Placement | null;
}) {
  const steps = columnsForJob(rounds).filter((column) => column.stage !== "rejected");
  const rejected = placement?.stage === "rejected";
  const hired = placement?.stage === "hired";
  const currentKey = columnKeyFor(placement ?? { stage: "screened" }, steps);
  const currentIndex = Math.max(
    0,
    steps.findIndex((step) => step.key === currentKey),
  );

  return (
    <div className="w-full">
      <ol className="flex items-start">
        {steps.map((step, index) => {
          const state: StepState = hired || index < currentIndex
            ? "passed"
            : !rejected && index === currentIndex
              ? "current"
              : "upcoming";
          const last = index === steps.length - 1;
          return (
            <li key={step.key} className="flex min-w-0 flex-1 items-start">
              <div className="flex min-w-0 flex-col items-center gap-1">
                <span
                  title={
                    state === "passed"
                      ? `${step.label} — passed`
                      : state === "current"
                        ? `${step.label} — current`
                        : step.label
                  }
                  className={cn(
                    "grid h-5 w-5 shrink-0 place-items-center rounded-full border text-[11px]",
                    state === "passed" && "border-success/30 bg-success text-white",
                    state === "current" && "border-primary bg-primary text-primary-foreground",
                    state === "upcoming" && "border-border bg-white text-muted-foreground",
                  )}
                >
                  {state === "passed" ? (
                    <Check className="h-3 w-3" strokeWidth={3} />
                  ) : state === "current" ? (
                    <Circle className="h-2 w-2 fill-current" />
                  ) : (
                    <Circle className="h-2 w-2" />
                  )}
                </span>
                <span
                  className={cn(
                    "max-w-[4.5rem] truncate text-center text-[9px] font-medium leading-tight",
                    state === "passed" && "text-success",
                    state === "current" && "text-primary",
                    state === "upcoming" && "text-muted-foreground",
                  )}
                >
                  {step.label}
                </span>
              </div>
              {!last && (
                <span
                  aria-hidden
                  className={cn(
                    "mt-2.5 h-px min-w-[8px] flex-1",
                    (hired || index < currentIndex) ? "bg-success/10" : "bg-secondary",
                  )}
                />
              )}
            </li>
          );
        })}
      </ol>
      {rejected && (
        <p className="mt-1.5 inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
          <X className="h-3 w-3" /> Rejected
        </p>
      )}
    </div>
  );
}

type StatusCandidate = {
  id: string;
  name: string;
  score: number;
  skills: string[];
  isBench?: boolean;
};

/** Dedicated workspace tab: one card per candidate, current stage plus the
 *  round-by-round path with passed steps checked off. */
export function CandidateStatusTab({
  rounds,
  candidates,
  placements,
  blindMode,
  onOpen,
}: {
  rounds: readonly RoundLike[] | undefined | null;
  candidates: StatusCandidate[];
  placements: Record<string, PipelineCandidate>;
  blindMode: boolean;
  onOpen: (id: string) => void;
}) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return candidates.filter((candidate) => {
      if (!needle) return true;
      const nameHit = candidate.name.toLowerCase().includes(needle);
      const skillHit = candidate.skills.some((skill) => skill.toLowerCase().includes(needle));
      return nameHit || skillHit;
    });
  }, [candidates, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold">Candidate status</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Where each person is in this role. A check means that round is already done.
          </p>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name or skill..."
            className="rounded-lg border-border bg-white pl-9 text-xs"
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-10 text-center text-xs text-muted-foreground">
          No candidates to show yet.
        </p>
      ) : (
        <ul className="space-y-3">
          {rows.map((candidate, index) => {
            const placement = placements[candidate.id];
            const stage = currentStageLabel(rounds, placement);
            return (
              <li
                key={candidate.id}
                className="rounded-2xl border bg-card p-5 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={() => onOpen(candidate.id)}
                        className="truncate text-sm font-bold hover:text-primary"
                      >
                        {blindMode ? `Candidate #${index + 1}` : candidate.name}
                      </button>
                      {candidate.isBench && (
                        <Badge className="bg-primary/10 text-[11px] font-bold text-primary border-primary/30">
                          Bench
                        </Badge>
                      )}
                      <Badge variant="outline" className="text-[11px] font-semibold">
                        {stage}
                      </Badge>
                    </div>
                    <MovedByTag placement={placement ?? null} />
                    <p className="mt-1 text-xs text-muted-foreground">
                      ATS {candidate.score}
                      {candidate.skills.slice(0, 3).length > 0
                        ? ` · ${candidate.skills.slice(0, 3).join(" · ")}`
                        : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="rounded-lg text-xs"
                    onClick={() => onOpen(candidate.id)}
                  >
                    View profile
                  </Button>
                </div>
                <div className="mt-4 rounded-xl border bg-secondary/30 px-3 py-4">
                  <PipelineProgress rounds={rounds} placement={placement ?? null} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

