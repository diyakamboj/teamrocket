import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A vertical, self-advancing stepper for the hiring pages.
 *
 * Both pages used to be a tab dashboard: stat tiles, a grid of roles, and
 * three tabs, which shows a recruiter everything at once and never says
 * what to do next. Hiring is a sequence, so this renders it as one — each
 * step states its job in a sentence and carries the one control that moves
 * it forward.
 *
 * Steps are not gated. Completion is *derived* from real data rather than
 * from clicking through, so a recruiter returning to a half-finished role
 * lands on the step they actually stopped at, and someone who wants step
 * four on day one can simply open it. That keeps every feature reachable
 * while still reading as a guided flow.
 */

export type FlowStep = {
  id: string;
  title: string;
  /** One sentence, plain language: what this step is for. */
  blurb: string;
  /** True once the underlying data says the step is satisfied. */
  done: boolean;
  /** Shown on the right of the header when there is something to report. */
  summary?: string | undefined;
  body: ReactNode;
};

export function HiringFlow({ steps }: { steps: FlowStep[] }) {
  // The first unfinished step is where the work is, so it opens by default.
  const firstOpen = useMemo(() => {
    const next = steps.find((s) => !s.done);
    return next?.id ?? steps[steps.length - 1]?.id ?? null;
  }, [steps]);

  const [openId, setOpenId] = useState<string | null>(firstOpen);
  const [touched, setTouched] = useState(false);

  // Follow the data until the recruiter expresses a preference by clicking;
  // after that, stop moving the panel under them.
  useEffect(() => {
    if (!touched) setOpenId(firstOpen);
  }, [firstOpen, touched]);

  const doneCount = steps.filter((s) => s.done).length;
  const pct = steps.length === 0 ? 0 : Math.round((doneCount / steps.length) * 100);

  return (
    <div className="space-y-4">
      <div className="rounded-xl border bg-card p-4">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-medium">
            {doneCount === steps.length ? "All set" : `Step ${doneCount + 1} of ${steps.length}`}
          </p>
          <p className="text-xs text-muted-foreground">{pct}% complete</p>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full grad-track transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
            style={{ width: `${pct}%` }}
          />
        </div>
      </div>

      <ol className="relative space-y-3">
        {steps.map((step, index) => {
          const isOpen = openId === step.id;
          const isLast = index === steps.length - 1;
          return (
            <li key={step.id} className="relative">
              {/* The rail that makes the sequence read as one flow. */}
              {!isLast && (
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-[1.4rem] top-12 -bottom-3 w-px transition-colors duration-500",
                    step.done ? "bg-primary/40" : "bg-border",
                  )}
                />
              )}

              <div
                className={cn(
                  "overflow-hidden rounded-xl border bg-card transition-all duration-300",
                  isOpen ? "border-primary/40 shadow-[0_1px_2px_rgba(0,0,0,0.04)]" : "border-border",
                )}
              >
                <button
                  type="button"
                  onClick={() => {
                    setTouched(true);
                    setOpenId(isOpen ? null : step.id);
                  }}
                  aria-expanded={isOpen}
                  className="flex w-full items-center gap-3 p-4 text-left transition-colors hover:bg-secondary/40"
                >
                  <span
                    className={cn(
                      "relative z-10 grid h-9 w-9 shrink-0 place-items-center rounded-full border-2 text-sm font-semibold transition-all duration-300",
                      step.done
                        ? "border-primary bg-primary text-primary-foreground"
                        : isOpen
                          ? "border-primary bg-card text-primary"
                          : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {step.done ? <Check className="h-4 w-4" /> : index + 1}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{step.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{step.blurb}</span>
                  </span>

                  {step.summary && (
                    <span className="hidden shrink-0 text-xs text-muted-foreground sm:block">
                      {step.summary}
                    </span>
                  )}

                  <ChevronDown
                    className={cn(
                      "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300",
                      isOpen && "rotate-180",
                    )}
                  />
                </button>

                {isOpen && (
                  <div className="animate-rise border-t px-4 py-4">{step.body}</div>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The single action that moves a step forward, plus optional secondary links. */
export function StepActions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>;
}
