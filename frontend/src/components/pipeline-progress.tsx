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
