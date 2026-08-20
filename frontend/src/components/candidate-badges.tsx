import { CheckCircle2, ShieldCheck, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { getStatusFlagClass, type BadgeSet, type SkillBadge, type StatusFlag } from "@/lib/badges";

export function CandidateStatusBadges({ flags }: { flags: StatusFlag[] }) {
  if (!flags || flags.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {flags.map((flag) => (
        <TooltipProvider key={flag.id}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="outline"
                className={`flex items-center gap-1 text-xs font-semibold py-0.5 px-2 cursor-help transition-colors ${getStatusFlagClass(
                  flag.tone,
                )}`}
              >
                <span>{flag.emoji}</span>
                <span>{flag.label}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs space-y-1">
              <p className="font-semibold text-foreground">{flag.label}</p>
              <p className="text-muted-foreground">{flag.reason}</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}

export function CandidateSkillBadges({ badges }: { badges: SkillBadge[] }) {
  if (!badges || badges.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1">
      {badges.slice(0, 8).map((b) => (
        <TooltipProvider key={b.name}>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge
                variant="secondary"
                className="flex items-center gap-1 text-xs font-medium py-0 px-2 bg-secondary/80 text-secondary-foreground hover:bg-secondary cursor-help"
              >
                <ShieldCheck className="h-3 w-3 text-success dark:text-success shrink-0" />
                <span>{b.name}</span>
              </Badge>
            </TooltipTrigger>
            <TooltipContent className="max-w-xs text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold">{b.name}</span>
                <span className="text-[11px] text-success font-semibold">
                  Verified ({Math.round(b.confidence * 100)}%)
                </span>
              </div>
              {b.evidence.map((ev, i) => (
                <p key={i} className="text-xs text-muted-foreground border-t pt-1">
                  <span className="font-medium text-foreground">{ev.label}:</span> "{ev.detail}"
                </p>
              ))}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ))}
    </div>
  );
}
