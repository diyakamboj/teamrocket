import { ListFilter, Loader2, Rows3, Scale, ScrollText, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

const TOOL_META: Record<string, { label: string; icon: typeof Sparkles }> = {
  search_candidates: { label: "Searching candidates", icon: ListFilter },
  get_verdicts: { label: "Checking requirements", icon: ScrollText },
  compare: { label: "Comparing candidates", icon: Scale },
  gap_summary: { label: "Checking for gaps", icon: Rows3 },
  must_have_report: { label: "Checking must-haves", icon: ScrollText },
};

/**
 * Shown while a request is in flight (label is a client-side heuristic guess —
 * see copilot-state.tsx's guessToolInFlight) or, once a response lands, to
 * permanently label which real backend tool(s) it used.
 */
export function ToolIndicator({
  label,
  tools,
  pending = false,
  className,
}: {
  label?: string | undefined;
  tools?: string[] | undefined;
  pending?: boolean;
  className?: string;
}) {
  if (pending) {
    return (
      <div className={cn("flex items-center gap-2 text-xs text-muted-foreground", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {label ?? "Thinking…"}
      </div>
    );
  }

  if (!tools || tools.length === 0) return null;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {tools.map((tool) => {
        const meta = TOOL_META[tool] ?? { label: tool, icon: Sparkles };
        const Icon = meta.icon;
        return (
          <span
            key={tool}
            className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
          >
            <Icon className="h-3 w-3" />
            {meta.label}
          </span>
        );
      })}
    </div>
  );
}
