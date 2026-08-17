import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { MiniBar } from "@/components/score-ring";
import { cn } from "@/lib/utils";
import type { Candidate, DimensionKey } from "@/lib/mock-data";

const DIMENSION_ORDER: DimensionKey[] = [
  "overall_fit",
  "technical_skills",
  "communication",
  "role_alignment",
];

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  overall_fit: "Overall Fit",
  technical_skills: "Technical Skills",
  communication: "Communication",
  role_alignment: "Role Alignment",
};

type DimensionBreakdownProps = {
  candidate: Candidate;
  className?: string;
};

export function DimensionBreakdown({ candidate, className }: DimensionBreakdownProps) {
  const [open, setOpen] = useState<DimensionKey>("overall_fit");

  return (
    <div className={cn("space-y-3", className)}>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2">
        {DIMENSION_ORDER.map((dimension) => {
          const active = open === dimension;
          return (
            <button
              key={dimension}
              type="button"
              onClick={() => setOpen(dimension)}
              className={cn(
                "rounded-xl p-2 text-left transition-colors hover:bg-secondary/50",
                active && "bg-secondary/70",
              )}
            >
              <MiniBar label={DIMENSION_LABELS[dimension]} value={candidate.dimensions[dimension].score} />
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border bg-secondary/60 p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              {DIMENSION_LABELS[open]}
            </p>
            <p className="mt-1 text-sm font-semibold">{candidate.dimensions[open].score}/100</p>
          </div>
          <button
            type="button"
            onClick={() =>
              setOpen((current) => {
                const index = DIMENSION_ORDER.indexOf(current);
                return DIMENSION_ORDER[(index + 1) % DIMENSION_ORDER.length]!;
              })
            }
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-background"
            aria-label="Toggle dimension focus"
          >
            <ChevronDown className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">{candidate.dimensions[open].explanation}</p>
        <div className="mt-3 space-y-2">
          {candidate.dimensions[open].evidence.slice(0, 3).map((item) => (
            <div key={`${item.skill}-${item.source}`} className="rounded-lg bg-background px-3 py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{item.skill}</span>
                <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                  {item.source}
                </span>
              </div>
              <p className="mt-1 text-muted-foreground">{item.detail}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}