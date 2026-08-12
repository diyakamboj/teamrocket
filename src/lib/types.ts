/**
 * Shared types crossing the client/server boundary.
 * Safe to import from browser code — no Node built-ins here.
 *
 * Every domain type is derived from the frozen schemas in `validation.ts` (the
 * single source of truth). Scoring helpers (`scoreOf`, `rankCandidates`) live
 * here so client and server agree on re-weighting.
 */
import type { z } from "zod";
import {
  candidateSchema,
  certificationEntrySchema,
  contactSchema,
  copilotEngineSchema,
  copilotRequestSchema,
  copilotResponseSchema,
  copilotToolSchema,
  educationEntrySchema,
  evidenceItemSchema,
  explainResponseSchema,
  experienceEntrySchema,
  jobRecordSchema,
  levelSchema,
  matchRecordSchema,
  mustHavesSchema,
  parsedResumeSchema,
  parseEngineSchema,
  projectEntrySchema,
  requirementCategorySchema,
  requirementSchema,
  requirementVerdictSchema,
  resumeRecordSchema,
  scoreCategorySchema,
  scoreExplanationSchema,
  signalBreakdownSchema,
  skillMentionSchema,
  textSourceSchema,
  uploadStageSchema,
  weightsSchema,
} from "@/lib/validation";

export type UploadStage = z.infer<typeof uploadStageSchema>;
export type TextSource = z.infer<typeof textSourceSchema>;
export type ParseEngine = z.infer<typeof parseEngineSchema>;
export type SkillMention = z.infer<typeof skillMentionSchema>;
export type ExperienceEntry = z.infer<typeof experienceEntrySchema>;
export type EducationEntry = z.infer<typeof educationEntrySchema>;
export type CertificationEntry = z.infer<typeof certificationEntrySchema>;
export type ProjectEntry = z.infer<typeof projectEntrySchema>;
export type ParsedResume = z.infer<typeof parsedResumeSchema>;
export type ResumeRecord = z.infer<typeof resumeRecordSchema>;

export const PROCESSING_STAGES: UploadStage[] = [
  "uploading",
  "extracting",
  "ocr",
  "parsing",
];

export type RequirementCategory = z.infer<typeof requirementCategorySchema>;
export type Requirement = z.infer<typeof requirementSchema>;
export type JobRecord = z.infer<typeof jobRecordSchema>;

export const REQUIREMENT_CATEGORIES: RequirementCategory[] = [
  "Skills",
  "Experience",
  "Education",
  "Certifications",
];

export type ScoreCategory = z.infer<typeof scoreCategorySchema>;
export type Weights = z.infer<typeof weightsSchema>;
export type SignalBreakdown = z.infer<typeof signalBreakdownSchema>;
export type RequirementVerdict = z.infer<typeof requirementVerdictSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;
export type Contact = z.infer<typeof contactSchema>;
export type MustHaves = z.infer<typeof mustHavesSchema>;
export type MatchRecord = z.infer<typeof matchRecordSchema>;
export type Candidate = z.infer<typeof candidateSchema>;
export type ScoreExplanation = z.infer<typeof scoreExplanationSchema>;
export type CandidateLevel = z.infer<typeof levelSchema>;
export type ExplainResponse = z.infer<typeof explainResponseSchema>;
export type CopilotTool = z.infer<typeof copilotToolSchema>;
export type CopilotEngine = z.infer<typeof copilotEngineSchema>;
export type CopilotRequest = z.infer<typeof copilotRequestSchema>;
export type CopilotResponse = z.infer<typeof copilotResponseSchema>;

export const DEFAULT_WEIGHTS: Weights = {
  skills: 40,
  experience: 25,
  education: 15,
  certifications: 10,
  projects: 10,
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
  const total =
    w.skills + w.experience + w.education + w.certifications + w.projects || 1;
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
  // Re-weighting only recomputes `overall` and records the weights — the raw
  // category scores and signal breakdowns are stored server-side and untouched.
  return list
    .map((c) => ({
      ...c,
      score: { ...c.score, overall: scoreOf(c.categories, w), weights: w },
    }))
    .sort(
      (a, b) =>
        b.score.overall - a.score.overall ||
        a.contact.name.localeCompare(b.contact.name),
    )
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

export function scoreBuckets(list: Candidate[]) {
  const edges = [0, 40, 55, 70, 85, 101];
  return ["0-40", "40-55", "55-70", "70-85", "85-100"].map((bucket, i) => ({
    bucket,
    count: list.filter(
      (c) => c.score.overall >= edges[i]! && c.score.overall < edges[i + 1]!,
    ).length,
  }));
}
