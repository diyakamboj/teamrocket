import { MiniBar, ScoreRing } from "@/components/score-ring";
import type { AgentCandidateCard } from "@/lib/api";
import { cn } from "@/lib/utils";

const CATEGORY_LABELS: Record<string, string> = {
  skills: "Skills",
  experience: "Experience",
  education: "Education",
  certifications: "Certifications",
  projects: "Projects",
};

export function CandidateCard({
  card,
  className,
}: {
  card: AgentCandidateCard;
  className?: string;
}) {
  const categoryEntries = Object.entries(card.categories ?? {});

  return (
    <div className={cn("card-surface space-y-4 p-4", className)}>
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-3">
        {typeof card.score === "number" && <ScoreRing value={Math.round(card.score)} size={48} />}
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">
            {card.rank ? `#${card.rank} ` : ""}
            {card.label}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {[card.years != null ? `${card.years} yrs` : null, card.level]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
      </div>

      {categoryEntries.length > 0 && (
        <div className="grid grid-cols-2 gap-x-4 gap-y-2">
          {categoryEntries.map(([key, value]) => (
            <MiniBar key={key} label={CATEGORY_LABELS[key] ?? key} value={value} />
          ))}
        </div>
      )}

      {card.skills?.length > 0 && (
        <div>
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Skills
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {card.skills.map((s) => (
              <span
                key={s}
                className="rounded-full bg-primary-soft px-2 py-0.5 text-[11px] font-medium text-primary-soft-foreground"
              >
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {(card.strengths?.length > 0 || card.gaps?.length > 0) && (
        <div className="grid gap-3 sm:grid-cols-2">
          {card.strengths?.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Strengths
              </p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {card.strengths.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
            </div>
          )}
          {card.gaps?.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Gaps
              </p>
              <ul className="mt-1 space-y-1 text-xs text-muted-foreground">
                {card.gaps.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {card.summary && <p className="text-xs text-muted-foreground">{card.summary}</p>}
    </div>
  );
}
