export type BadgeEvidence = {
  label: string;
  detail: string;
  origin: "resume" | "external_profile" | "screening";
  confidence?: number;
  url?: string | null;
};

export type StatusFlag = {
  id: "top_match" | "bench_candidate" | "immediate_joiner" | "incomplete_profile";
  label: string;
  emoji: string;
  tone: "positive" | "warning" | "neutral";
  reason: string;
  evidence: BadgeEvidence[];
};

export type SkillBadge = {
  name: string;
  kind: "skill" | "certification";
  level: "verified" | "corroborated";
  confidence: number;
  evidence: BadgeEvidence[];
};

export type BadgeSet = {
  status_flags: StatusFlag[];
  skill_badges: SkillBadge[];
};

export function getStatusFlagClass(tone: StatusFlag["tone"]): string {
  switch (tone) {
    case "positive":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "warning":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
    case "neutral":
    default:
      return "bg-secondary text-secondary-foreground border-border";
  }
}
