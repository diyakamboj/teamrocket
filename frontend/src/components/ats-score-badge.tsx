import { ScoreRing } from "@/components/score-ring";
import { Badge } from "@/components/ui/badge";
import { atsTierLabel, atsToneClass, atsVerdictLabel } from "@/lib/ats-score";
import { cn } from "@/lib/utils";

export function AtsScoreBadge({
  score,
  size = 56,
  compact = false,
  className,
}: {
  score: number;
  size?: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      <ScoreRing value={Math.round(score)} size={size} />
      <div className="min-w-0 leading-tight">
        <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">ATS score</p>
        {!compact && (
          <div className="mt-0.5 flex flex-wrap items-center gap-1">
            <Badge className={cn("text-[11px] font-bold capitalize", atsToneClass(score))}>
              {atsTierLabel(score)}
            </Badge>
            <Badge variant="outline" className="text-[11px] font-bold">
              {atsVerdictLabel(score)}
            </Badge>
          </div>
        )}
      </div>
    </div>
  );
}
