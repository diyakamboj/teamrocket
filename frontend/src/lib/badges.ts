/**
 * Standardized candidate status flags and evidence-backed skill badges.
 *
 * Mirrors backend/app/services/badge_service.py so the ranking page shows the
 * same labels the API returns; the thresholds below are the ones to keep in
 * sync. Every badge carries the evidence that justifies it, and nothing is
 * emitted on evidence weaker than the thresholds — an unverifiable claim gets
 * no badge rather than a badge with a shrug attached.
 */
import type { Candidate } from "@/lib/mock-data";

export const TOP_MATCH_MIN_SCORE = 85;
export const TOP_MATCH_MIN_SKILL_SCORE = 75;
export const BENCH_MIN_SCORE = 60;

export type BadgeTone = "positive" | "neutral" | "warning";
export type EvidenceOrigin = "resume" | "external_profile" | "screening";

export type BadgeEvidence = {
  label: string;
  detail: string;
  origin: EvidenceOrigin;
  url?: string;
};

export type StatusFlagId =
  "top_match" | "bench_candidate" | "immediate_joiner" | "incomplete_profile";

export type StatusFlag = {
  id: StatusFlagId;
  label: string;
  emoji: string;
  tone: BadgeTone;
  reason: string;
  evidence: BadgeEvidence[];
};

export type SkillBadge = {
  name: string;
  kind: "skill" | "certification";
  /** "corroborated" = backed by more than one independent source. */
  level: "verified" | "corroborated";
  evidence: BadgeEvidence[];
};

/** Notice periods short enough to count as starting now. */
const IMMEDIATE_AVAILABILITY: Candidate["availability"][] = ["Immediate", "15 days"];

/** Profile sections a recruiter needs that this candidate has none of. */
export function missingSections(c: Candidate): string[] {
  const missing: string[] = [];
  if (c.skills.length === 0) missing.push("skills");
  if (!c.education) missing.push("education");
  if (!c.email || !c.phone) missing.push("contact details");
  if (c.evidence.length === 0) missing.push("parsed resume text");
  return missing;
}

export function statusFlagsFor(c: Candidate): StatusFlag[] {
  const flags: StatusFlag[] = [];
  const missing = missingSections(c);

  if (missing.length > 0) {
    flags.push({
      id: "incomplete_profile",
      label: "Incomplete Profile",
      emoji: "⚠️",
      tone: "warning",
      reason: `Screening ran on partial data — missing ${missing.join(
        ", ",
      )}. Ask the candidate to complete the profile before relying on the match score.`,
      evidence: [
        {
          label: "Profile completeness",
          detail: `No data parsed for: ${missing.join(", ")}`,
          origin: "screening",
        },
      ],
    });
  }

  const scoreEvidence: BadgeEvidence = {
    label: "Match score",
    detail: `Overall ${c.score}/100 · skills ${c.categories.skills}/100 · experience ${c.categories.experience}/100`,
    origin: "screening",
  };

  // A top-match label on a half-parsed profile would overstate what was
  // actually verified, so completeness gates it.
  if (
    missing.length === 0 &&
    c.score >= TOP_MATCH_MIN_SCORE &&
    c.categories.skills >= TOP_MATCH_MIN_SKILL_SCORE
  ) {
    flags.push({
      id: "top_match",
      label: "Top Match",
      emoji: "🟢",
      tone: "positive",
      reason: `Scores ${c.score}/100 against this role with a ${c.categories.skills}/100 skills match — shortlist candidate.`,
      evidence: [scoreEvidence],
    });
  } else if (c.score >= BENCH_MIN_SCORE) {
    flags.push({
      id: "bench_candidate",
      label: "Bench Candidate",
      emoji: "👥",
      tone: "neutral",
      reason: `Solid but not front-running at ${c.score}/100${
        c.gaps[0] ? ` — ${c.gaps[0].toLowerCase()}` : ""
      }. Worth keeping in the talent pool for related roles.`,
      evidence: [scoreEvidence],
    });
  }

  if (IMMEDIATE_AVAILABILITY.includes(c.availability)) {
    flags.push({
      id: "immediate_joiner",
      label: "Immediate Joiner",
      emoji: "🚀",
      tone: "positive",
      reason: "States availability to start immediately or on short notice.",
      evidence: [{ label: "Resume · availability", detail: c.availabilityNote, origin: "resume" }],
    });
  }

  return flags;
}

export type BadgeOptions = {
  /** Blind review: source links are dropped — a profile URL names the person. */
  blind?: boolean;
};

/**
 * Skill and certification badges, each linked to what backs it: a resume
 * evidence item, a public credential record, or a linked public profile.
 * Claims with none of those are left unbadged.
 */
export function skillBadgesFor(c: Candidate, options: BadgeOptions = {}): SkillBadge[] {
  const profile = c.externalProfile;
  const corroborated = new Set((profile?.skills ?? []).map((s) => s.toLowerCase()));

  const badges: SkillBadge[] = [];

  for (const cert of c.certifications) {
    if (!cert.credentialUrl) continue; // claim without a verifiable record
    badges.push({
      name: cert.name,
      kind: "certification",
      level: "verified",
      evidence: [
        {
          label: `Credential record · ${cert.issuer}`,
          detail: `${cert.name} issued by ${cert.issuer}`,
          origin: "external_profile",
          ...(options.blind ? {} : { url: cert.credentialUrl }),
        },
      ],
    });
  }

  for (const item of c.evidence) {
    const evidence: BadgeEvidence[] = [
      {
        label: `Resume · ${item.source}`,
        detail: item.detail,
        origin: "resume",
      },
    ];
    if (profile && corroborated.has(item.skill.toLowerCase())) {
      evidence.push({
        label: profile.label,
        detail: `${item.skill} evidenced by public work on the candidate's ${profile.label.toLowerCase()}`,
        origin: "external_profile",
        ...(options.blind ? {} : { url: profile.url }),
      });
    }
    badges.push({
      name: item.skill,
      kind: "skill",
      level: evidence.length > 1 ? "corroborated" : "verified",
      evidence,
    });
  }

  return badges;
}

export type CandidateBadges = {
  statusFlags: StatusFlag[];
  skillBadges: SkillBadge[];
};

export function badgesFor(c: Candidate, options: BadgeOptions = {}): CandidateBadges {
  return { statusFlags: statusFlagsFor(c), skillBadges: skillBadgesFor(c, options) };
}

export const STATUS_FLAG_ORDER: StatusFlagId[] = [
  "top_match",
  "bench_candidate",
  "immediate_joiner",
  "incomplete_profile",
];

export const STATUS_FLAG_META: Record<
  StatusFlagId,
  { label: string; emoji: string; tone: BadgeTone }
> = {
  top_match: { label: "Top Match", emoji: "🟢", tone: "positive" },
  bench_candidate: { label: "Bench Candidate", emoji: "👥", tone: "neutral" },
  immediate_joiner: { label: "Immediate Joiner", emoji: "🚀", tone: "positive" },
  incomplete_profile: { label: "Incomplete Profile", emoji: "⚠️", tone: "warning" },
};

/** How many candidates in a list carry each flag. */
export function statusFlagCounts(list: Candidate[]): Record<StatusFlagId, number> {
  const counts: Record<StatusFlagId, number> = {
    top_match: 0,
    bench_candidate: 0,
    immediate_joiner: 0,
    incomplete_profile: 0,
  };
  for (const candidate of list) {
    for (const flag of statusFlagsFor(candidate)) counts[flag.id] += 1;
  }
  return counts;
}

export function hasStatusFlag(c: Candidate, id: StatusFlagId): boolean {
  return statusFlagsFor(c).some((f) => f.id === id);
}
