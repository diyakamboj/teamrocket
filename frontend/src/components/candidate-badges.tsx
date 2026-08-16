import { BadgeCheck, ExternalLink, FileText, Gauge, Globe } from "lucide-react";
import { type BadgeEvidence, type BadgeTone, type SkillBadge, type StatusFlag } from "@/lib/badges";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const TONE_CLASS: Record<BadgeTone, string> = {
  positive:
    "bg-emerald-100 text-emerald-800 hover:bg-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-300 dark:hover:bg-emerald-500/25",
  neutral:
    "bg-secondary text-secondary-foreground hover:bg-secondary/70 dark:bg-secondary dark:text-secondary-foreground",
  warning:
    "bg-amber-100 text-amber-800 hover:bg-amber-200 dark:bg-amber-500/15 dark:text-amber-300 dark:hover:bg-amber-500/25",
};

const ORIGIN_ICON = {
  resume: FileText,
  external_profile: Globe,
  screening: Gauge,
} as const;

const ORIGIN_LABEL = {
  resume: "Resume evidence",
  external_profile: "External profile",
  screening: "Screening result",
} as const;

function EvidenceList({ items }: { items: BadgeEvidence[] }) {
  return (
    <ul className="space-y-2.5">
      {items.map((e, i) => {
        const Icon = ORIGIN_ICON[e.origin];
        return (
          <li key={`${e.label}-${i}`} className="flex gap-2">
            <Icon
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
              aria-hidden="true"
            />
            <div className="min-w-0">
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                <span className="sr-only">{ORIGIN_LABEL[e.origin]} — </span>
                {e.label}
              </p>
              <p className="mt-0.5 text-xs leading-relaxed">{e.detail}</p>
              {e.url && (
                <a
                  href={e.url}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  View source <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Pill that opens its supporting evidence on click. */
function BadgePill({
  className,
  children,
  title,
  reason,
  evidence,
}: {
  className: string;
  children: React.ReactNode;
  title: string;
  reason?: string;
  evidence: BadgeEvidence[];
}) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold transition-colors",
          className,
        )}
      >
        {children}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-bold">{title}</p>
          {reason && <p className="mt-1 text-xs text-muted-foreground">{reason}</p>}
        </div>
        <div>
          <p className="mb-2 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Evidence
          </p>
          <EvidenceList items={evidence} />
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function StatusFlags({ flags, className }: { flags: StatusFlag[]; className?: string }) {
  if (flags.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {flags.map((flag) => (
        <BadgePill
          key={flag.id}
          className={TONE_CLASS[flag.tone]}
          title={`${flag.emoji} ${flag.label}`}
          reason={flag.reason}
          evidence={flag.evidence}
        >
          <span aria-hidden="true">{flag.emoji}</span>
          {flag.label}
        </BadgePill>
      ))}
    </div>
  );
}

/**
 * Verified skill and certification badges. `limit` keeps dense views readable
 * — the remainder is summarized rather than dropped silently.
 */
export function SkillBadges({
  badges,
  limit,
  className,
}: {
  badges: SkillBadge[];
  limit?: number;
  className?: string;
}) {
  if (badges.length === 0) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        No claim on this profile has evidence strong enough to badge yet.
      </p>
    );
  }

  const shown = limit ? badges.slice(0, limit) : badges;
  const hidden = badges.length - shown.length;

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {shown.map((badge, i) => (
        <BadgePill
          key={`${badge.kind}-${badge.name}-${i}`}
          className={cn(
            badge.kind === "certification"
              ? "bg-indigo-100 text-indigo-800 hover:bg-indigo-200 dark:bg-indigo-500/15 dark:text-indigo-300 dark:hover:bg-indigo-500/25"
              : "bg-primary-soft text-primary-soft-foreground hover:bg-primary-soft/70",
            // Multi-source badges are outlined so they read as the stronger claim.
            badge.level === "corroborated" && "ring-1 ring-current/40",
          )}
          title={badge.name}
          reason={
            badge.level === "corroborated"
              ? "Corroborated by more than one independent source."
              : badge.kind === "certification"
                ? "Backed by a public credential record."
                : "Backed by evidence found in the resume."
          }
          evidence={badge.evidence}
        >
          <BadgeCheck className="h-3 w-3" aria-hidden="true" />
          {badge.name}
          <span className="sr-only">
            {badge.level === "corroborated" ? "corroborated " : "verified "}
            {badge.kind === "certification" ? "certification" : "skill"}
          </span>
        </BadgePill>
      ))}
      {hidden > 0 && (
        <span className="text-[11px] font-medium text-muted-foreground">+{hidden} more</span>
      )}
    </div>
  );
}
