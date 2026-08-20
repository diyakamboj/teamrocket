/**
 * Candidate domain model + the client-side re-weighting helpers.
 *
 * The candidate pool itself is NOT defined here — it comes from the backend
 * store (Azure Blob via the `Store` facade) through `fetchCandidatePool()`.
 * The only computation kept on the client is score re-weighting, because the
 * recruiter drags the category weight sliders and expects the ranking to
 * update without a server round-trip per keystroke. The per-category scores
 * being weighted are all produced by the backend scoring pipeline.
 */

import {
  fetchCandidatesFromBackend,
  rankCandidatesApi,
  type BackendCandidate,
  type RankedCandidate,
} from "@/lib/api";

export type CandidateEvidence = {
  skill: string;
  detail: string;
  source: string;
};

export type Candidate = {
  id: string;
  rank: number;
  name: string;
  initials: string;
  email: string;
  phone: string;
  title: string;
  location: string;
  years: number;
  level: "Junior" | "Mid" | "Senior" | "Lead";
  education: string;
  score: number;
  categories: {
    skills: number;
    experience: number;
    education: number;
    certifications: number;
    projects: number;
  };
  skills: string[];
  strengths: string[];
  gaps: string[];
  transferable: string[];
  evidence: CandidateEvidence[];
  /** "internal" (existing employee) vs "external" (outside applicant). */
  origin: "internal" | "external";
  employmentStatus?: string | null;
  currentAssignment?: string | null;
  /** The role they are assigned to, or null for the general pool. */
  jobId?: string | null;
  evaluationId?: string | null;
};

export type Weights = {
  skills: number;
  experience: number;
  education: number;
  certifications: number;
  projects: number;
};

export const DEFAULT_WEIGHTS: Weights = {
  skills: 40,
  experience: 25,
  education: 15,
  certifications: 10,
  projects: 10,
};

export function scoreOf(c: Candidate, w: Weights) {
  const total = w.skills + w.experience + w.education + w.certifications + w.projects || 1;
  return Math.round(
    (c.categories.skills * w.skills +
      c.categories.experience * w.experience +
      c.categories.education * w.education +
      c.categories.certifications * w.certifications +
      c.categories.projects * w.projects) /
      total,
  );
}

export function rankCandidates(list: Candidate[], w: Weights): Candidate[] {
  return list
    .map((c) => ({ ...c, score: scoreOf(c, w) }))
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

export function scoreBuckets(list: Candidate[]) {
  const buckets = ["0-40", "40-55", "55-70", "70-85", "85-100"];
  return buckets.map((b, i) => {
    const lo = [0, 40, 55, 70, 85][i]!;
    const hi = [40, 55, 70, 85, 101][i]!;
    return { bucket: b, count: list.filter((c) => c.score >= lo && c.score < hi).length };
  });
}

/** Distinct skills across a pool, sorted — drives the skill filter dropdown. */
export function allSkills(pool: Candidate[]): string[] {
  return Array.from(new Set(pool.flatMap((c) => c.skills))).sort();
}

export function skillDistribution(pool: Candidate[]) {
  return allSkills(pool)
    .map((skill) => ({ skill, count: pool.filter((c) => c.skills.includes(skill)).length }))
    .sort((a, b) => b.count - a.count);
}

export function experienceBreakdown(pool: Candidate[]) {
  return (["Junior", "Mid", "Senior", "Lead"] as const).map((level) => ({
    level,
    count: pool.filter((c) => c.level === level).length,
  }));
}

// ---------- Backend -> UI mapping ----------

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = parts[0]![0] ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]![0] ?? "") : "";
  return (first + last).toUpperCase();
}

function levelFor(years: number): Candidate["level"] {
  if (years < 2) return "Junior";
  if (years < 5) return "Mid";
  if (years < 9) return "Senior";
  return "Lead";
}

function yearsOf(profile: BackendCandidate | undefined): number {
  if (!profile) return 0;
  let total = 0;
  for (const item of profile.experience ?? []) {
    const value = Number((item as { years?: unknown })?.years);
    if (Number.isFinite(value)) total += value;
  }
  if (total > 0) return Math.round(total * 10) / 10;
  return profile.experience?.length ?? 0;
}

function textOf(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    const parts = [record["degree"], record["field"], record["school"]]
      .filter((p): p is string => typeof p === "string" && p.length > 0)
      .join(", ");
    if (parts) return parts;
  }
  return String(value);
}

/** Splits the backend's single narrative string into displayable bullets. */
function toBullets(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/(?:\.\s+|\n|;\s*)/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => s.length > 2)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1));
}

function skillName(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const name = record["skill"] ?? record["name"];
    if (typeof name === "string") return name;
  }
  return String(entry ?? "");
}

/**
 * Joins one backend evaluation (scores + evidence) with the candidate's stored
 * profile (contact details, skills, experience) into the shape the UI renders.
 */
export function mapRankedCandidate(
  ranked: RankedCandidate,
  profile: BackendCandidate | undefined,
): Candidate {
  const years = yearsOf(profile);
  // The `overall_fit` dimension repeats the evidence of the other dimensions,
  // so snippets are de-duplicated by (skill, snippet) to avoid showing each
  // quote twice.
  const evidence: CandidateEvidence[] = [];
  const seenEvidence = new Set<string>();
  for (const dimension of Object.values(ranked.dimensions ?? {})) {
    for (const item of dimension?.evidence ?? []) {
      if (!item?.resume_text_snippet) continue;
      const key = `${item.skill_name}|${item.resume_text_snippet}`;
      if (seenEvidence.has(key)) continue;
      seenEvidence.add(key);
      evidence.push({
        skill: item.skill_name || "Evidence",
        detail: item.resume_text_snippet,
        source: item.source_section || "Resume",
      });
    }
  }

  return {
    id: ranked.candidate_id,
    rank: ranked.rank,
    name: ranked.name,
    initials: initialsOf(ranked.name),
    email: ranked.email ?? profile?.email ?? "",
    phone: profile?.phone ?? "",
    title: profile?.title || textOf(profile?.experience?.[0]) || "Candidate",
    location: profile?.location ?? "",
    years,
    level: levelFor(years),
    education: (profile?.education ?? []).map(textOf).filter(Boolean).join(" · "),
    score: Math.round(ranked.overall_score ?? 0),
    categories: {
      skills: Math.round(ranked.skill_score ?? 0),
      experience: Math.round(ranked.experience_score ?? 0),
      education: Math.round(ranked.education_score ?? 0),
      certifications: Math.round(ranked.certification_score ?? 0),
      projects: Math.round(ranked.project_score ?? 0),
    },

    skills: (profile?.skills ?? []).map(skillName).filter(Boolean),
    strengths: toBullets(ranked.strengths),
    gaps: [
      ...(ranked.missing_skills ?? []).map(skillName).filter(Boolean).map((s) => `Missing ${s}`),
      ...toBullets(ranked.weaknesses),
    ],
    transferable: toBullets(ranked.transferable_skills),
    evidence,
    origin: ranked.source === "internal" ? "internal" : "external",
    employmentStatus: ranked.employment_status ?? profile?.employment_status ?? null,
    // Which opening they sit on, so the role picker can show it.
    jobId: profile?.job_id ?? null,
    currentAssignment: ranked.current_assignment ?? null,
    evaluationId: ranked.evaluation_id ?? null,
  };
}

/**
 * The real candidate pool: every candidate stored in the backend, scored
 * against `jobId` by the backend's own matching pipeline.
 */
export async function fetchCandidatePool(
  jobId: string,
  options?: { blindMode?: boolean; weights?: Record<string, number> },
): Promise<Candidate[]> {
  const [ranked, profiles] = await Promise.all([
    rankCandidatesApi(jobId, options),
    fetchCandidatesFromBackend(),
  ]);

  const byId = new Map(profiles.map((p) => [p.id, p]));
  return ranked.map((r) => mapRankedCandidate(r, byId.get(r.candidate_id)));
}
