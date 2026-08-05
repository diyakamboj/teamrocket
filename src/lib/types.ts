/**
 * Shared types crossing the client/server boundary.
 * Safe to import from browser code — no Node built-ins here.
 */

export type UploadStage =
  | "queued"
  | "uploading"
  | "extracting"
  | "ocr"
  | "parsing"
  | "complete"
  | "failed"
  | "duplicate"
  | "skipped";

export const PROCESSING_STAGES: UploadStage[] = ["uploading", "extracting", "ocr", "parsing"];

/** How the raw text was pulled out of the document. */
export type TextSource = "azure-document-intelligence" | "embedded-pdf-text" | "plain-text";

/** Which engine produced the structured fields. */
export type ParseEngine = "azure-openai" | "heuristic";

export type SkillMention = {
  name: string;
  /** Where in the resume this skill is backed up, when the model found evidence. */
  evidence?: string | undefined;
  years?: number | undefined;
};

export type ExperienceEntry = {
  company: string;
  title: string;
  /** ISO-ish free text as written on the resume, e.g. "2021-03" or "March 2021". */
  startDate?: string | undefined;
  endDate?: string | undefined;
  current?: boolean | undefined;
  location?: string | undefined;
  highlights: string[];
  technologies: string[];
};

export type EducationEntry = {
  institution: string;
  degree: string;
  field?: string | undefined;
  graduationYear?: string | undefined;
  grade?: string | undefined;
};

export type CertificationEntry = {
  name: string;
  issuer?: string | undefined;
  issueDate?: string | undefined;
  expiryDate?: string | undefined;
};

export type ProjectEntry = {
  name: string;
  description?: string | undefined;
  technologies: string[];
  url?: string | undefined;
};

export type ParsedResume = {
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | undefined;
  location?: string | undefined;
  title?: string | undefined;
  summary?: string | undefined;
  totalYearsExperience?: number | undefined;
  links: string[];
  skills: SkillMention[];
  experience: ExperienceEntry[];
  education: EducationEntry[];
  certifications: CertificationEntry[];
  projects: ProjectEntry[];
};

export type ResumeRecord = {
  id: string;
  fileName: string;
  fileSize: number;
  stage: UploadStage;
  progress: number;
  error?: string | undefined;
  /** File name of the earlier upload this one duplicates. */
  duplicateOf?: string | undefined;
  uploadedAt: string;
  processedAt?: string | undefined;
  pageCount?: number | undefined;
  /** True when the document had no usable embedded text and had to go through OCR. */
  scanned?: boolean | undefined;
  textSource?: TextSource | undefined;
  parseEngine?: ParseEngine | undefined;
  textChars?: number | undefined;
  parsed?: ParsedResume | undefined;
};

export type RequirementCategory = "Skills" | "Experience" | "Education" | "Certifications";

export const REQUIREMENT_CATEGORIES: RequirementCategory[] = [
  "Skills",
  "Experience",
  "Education",
  "Certifications",
];

export type Requirement = {
  id: string;
  category: RequirementCategory;
  text: string;
  must: boolean;
  /** Terms used by the deterministic keyword pass — includes common aliases. */
  keywords: string[];
  /** Only meaningful for Experience requirements that state a duration. */
  minYears?: number | undefined;
};

export type JobRecord = {
  id: string;
  title: string;
  description: string;
  summary: string;
  requirements: Requirement[];
  /** Set once the requirements have been reviewed/edited by the recruiter. */
  reviewed: boolean;
  createdAt: string;
  updatedAt: string;
  analyzedBy: ParseEngine;
};

export type ScoreCategory =
  | "skills"
  | "experience"
  | "education"
  | "certifications"
  | "projects";

export type Weights = Record<ScoreCategory, number>;

export const DEFAULT_WEIGHTS: Weights = {
  skills: 40,
  experience: 25,
  education: 15,
  certifications: 10,
  projects: 10,
};

/** The three signals blended into every category score. */
export type SignalBreakdown = {
  keyword: number;
  semantic: number;
  ai: number | null;
};

export type RequirementVerdict = {
  requirementId: string;
  status: "met" | "partial" | "missing";
  score: number;
  evidence?: string | undefined;
};

export type EvidenceItem = {
  skill: string;
  detail: string;
  source: string;
};

export type MatchRecord = {
  resumeId: string;
  jobId: string;
  /** Category scores 0-100, before recruiter weighting. */
  categories: Record<ScoreCategory, number>;
  signals: Record<ScoreCategory, SignalBreakdown>;
  requirements: RequirementVerdict[];
  strengths: string[];
  gaps: string[];
  transferable: string[];
  evidence: EvidenceItem[];
  summary: string;
  /** True when this candidate got the full LLM analysis rather than the deterministic pass only. */
  aiAnalyzed: boolean;
  mustHavesMet: number;
  mustHavesTotal: number;
  scoredAt: string;
};

/** A resume + its match against the active job, shaped for the ranking UI. */
export type Candidate = {
  id: string;
  rank: number;
  score: number;
  name: string;
  initials: string;
  email: string;
  phone: string;
  title: string;
  location: string;
  years: number;
  level: "Junior" | "Mid" | "Senior" | "Lead";
  education: string;
  fileName: string;
  categories: Record<ScoreCategory, number>;
  signals: Record<ScoreCategory, SignalBreakdown>;
  skills: string[];
  strengths: string[];
  gaps: string[];
  transferable: string[];
  evidence: EvidenceItem[];
  requirements: RequirementVerdict[];
  summary: string;
  aiAnalyzed: boolean;
  mustHavesMet: number;
  mustHavesTotal: number;
};

export type ScreeningRun = {
  jobId: string;
  startedAt: string;
  finishedAt?: string | undefined;
  total: number;
  scored: number;
  aiAnalyzed: number;
  running: boolean;
  error?: string | undefined;
};

export type AzureCapabilities = {
  documentIntelligence: boolean;
  chat: boolean;
  embeddings: boolean;
};

export function levelFromYears(years: number): Candidate["level"] {
  if (years < 3) return "Junior";
  if (years < 7) return "Mid";
  if (years < 12) return "Senior";
  return "Lead";
}

export function scoreOf(categories: Record<ScoreCategory, number>, w: Weights) {
  const total = w.skills + w.experience + w.education + w.certifications + w.projects || 1;
  return Math.round(
    (categories.skills * w.skills +
      categories.experience * w.experience +
      categories.education * w.education +
      categories.certifications * w.certifications +
      categories.projects * w.projects) /
      total,
  );
}

export function rankCandidates(list: Candidate[], w: Weights): Candidate[] {
  return list
    .map((c) => ({ ...c, score: scoreOf(c.categories, w) }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

export function scoreBuckets(list: Candidate[]) {
  const edges = [0, 40, 55, 70, 85, 101];
  return ["0-40", "40-55", "55-70", "70-85", "85-100"].map((bucket, i) => ({
    bucket,
    count: list.filter((c) => c.score >= edges[i]! && c.score < edges[i + 1]!).length,
  }));
}
