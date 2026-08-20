import { ArrowRight, Mail } from "lucide-react";

import { type PipelineColumn } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

/**
 * What this board is and how to move someone through it.
 *
 * The two board tabs were visually near-identical and neither said what it
 * was for, so the only way to learn the difference was to click both and
 * compare. Each now states its own job, and the columns are shown as the
 * route a candidate takes rather than as unlabelled buckets.
 */
export function BoardGuide({
  columns,
  variant,
}: {
  columns: PipelineColumn[];
  variant: "overview" | "board";
}) {
  const copy =
    variant === "board"
      ? {
          title: "Move people between rounds here",
          body: "Drag a card into the next column, or use the button on the card. Whatever you do here is what the rest of the site reads — the checklist on Hiring steps updates from it.",
        }
      : {
          title: "See where everyone stands",
          body: "A read-only summary of how many people sit at each round. To actually move someone, use the Stage Kanban Board.",
        };

  return (
    <section className="surface-lift edge-glow p-5">
      <h2 className="font-display text-base font-bold">{copy.title}</h2>
      <p className="mt-1 max-w-3xl text-sm text-muted-foreground">{copy.body}</p>

      {variant === "board" && (
        <p className="mt-2 inline-flex items-start gap-1.5 text-[11px] font-medium text-warning-foreground dark:text-warning">
          <Mail className="mt-0.5 h-3 w-3 shrink-0" />
          Moving someone into a decision column offers to email them, and taking that offer sends
          a real message to the candidate.
        </p>
      )}

      {/* The route itself, in order. */}
      <ol className="mt-4 flex flex-wrap items-center gap-1.5">
        {columns.map((column, index) => (
          <li key={column.key} className="flex items-center gap-1.5">
            <span
              className={cn(
                "rounded-lg px-2.5 py-1 text-[11px] font-semibold",
                column.terminal
                  ? "bg-secondary text-muted-foreground"
                  : "bg-primary-soft text-primary-soft-foreground",
              )}
            >
              {column.label}
            </span>
            {index < columns.length - 1 && (
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
