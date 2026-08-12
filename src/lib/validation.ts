/**
 * validation.ts — the frozen cross-boundary contracts.
 *
 * Single source of truth for what crosses the web/server boundary. Every
 * producer (parsing, JD analysis, scoring, copilot) and consumer (routes, API
 * functions, the store) must agree on these shapes, and untrusted model output
 * is validated against them before it touches the domain.
 *
 * STATUS: every producer is migrated (Steps C–F) — `ParsedResume`, `ResumeRecord`,
 * `Requirement`, `JobRecord`, `MatchRecord`, and `Candidate` are derived from
 * these schemas in `types.ts`; `resume-parser.ts` / `jd-analyzer.ts` validate LLM
 * output through `parsedResumeSchema` / `jobRecordSchema`, and `matching.ts` emits
 * provenance-tagged evidence and score explanations through `matchRecordSchema`.
 * `candidateSchema` is what the ranking/compare UI consumes; `explainResponseSchema`
 * is the per-candidate evidence trace served by the explain endpoint. The copilot
 * request/response contract (`copilotRequestSchema` / `copilotResponseSchema`)
 * is consumed by `src/lib/server/copilot.ts` and the `copilotAsk` endpoint.
 *
 * Client-safe: no Node built-ins. zod is a plain dependency.
 */

import { z } from "zod";

/* ------------------------------------------------------------------ */
/* Upload & parse metadata                                            */
/* ------------------------------------------------------------------ */

export const uploadStageSchema = z.enum([
  "queued",
  "uploading",
  "extracting",
  "ocr",
  "parsing",
  "complete",
  "failed",
  "duplicate",
  "skipped",
]);

/** How the raw text was pulled out of the document. */
export const textSourceSchema = z.enum([
  "azure-document-intelligence",
  "embedded-pdf-text",
  "plain-text",
]);

/** Which engine produced the structured fields. */
export const parseEngineSchema = z.enum(["azure-openai", "heuristic"]);

/* ------------------------------------------------------------------ */
/* Parsed resume                                                       */
/* ------------------------------------------------------------------ */

export const skillMentionSchema = z.object({
  name: z.string(),
  /** Where in the resume this skill is backed up, when the model found evidence. */
  evidence: z.string().optional(),
  years: z.number().optional(),
});

export const experienceEntrySchema = z.object({
  company: z.string(),
  title: z.string(),
  /** ISO-ish free text as written on the resume, e.g. "2021-03" or "March 2021". */
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  current: z.boolean().optional(),
  location: z.string().optional(),
  highlights: z.array(z.string()),
  technologies: z.array(z.string()),
});

export const educationEntrySchema = z.object({
  institution: z.string(),
  degree: z.string(),
  field: z.string().optional(),
  graduationYear: z.string().optional(),
  grade: z.string().optional(),
});

export const certificationEntrySchema = z.object({
  name: z.string(),
  issuer: z.string().optional(),
  issueDate: z.string().optional(),
  expiryDate: z.string().optional(),
});

export const projectEntrySchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  technologies: z.array(z.string()),
  url: z.string().optional(),
});

export const parsedResumeSchema = z.object({
  name: z.string().optional(),
  email: z.string().optional(),
  phone: z.string().optional(),
  location: z.string().optional(),
  title: z.string().optional(),
  summary: z.string().optional(),
  totalYearsExperience: z.number().optional(),
  links: z.array(z.string()),
  skills: z.array(skillMentionSchema),
  experience: z.array(experienceEntrySchema),
  education: z.array(educationEntrySchema),
  certifications: z.array(certificationEntrySchema),
  projects: z.array(projectEntrySchema),
});

/**
 * The resume projection sent to the LLM during screening.
 * In blind mode, PII (name/email/phone/location/links) is stripped from this
 * projection BEFORE the AI pass — the model never sees contact details.
 */
export const blindProjectionSchema = parsedResumeSchema.omit({
  name: true,
  email: true,
  phone: true,
  location: true,
  links: true,
});

/* ------------------------------------------------------------------ */
/* Job requirements & JD analysis                                      */
/* ------------------------------------------------------------------ */

export const requirementCategorySchema = z.enum([
  "Skills",
  "Experience",
  "Education",
  "Certifications",
]);

export const requirementSchema = z.object({
  id: z.string(),
  category: requirementCategorySchema,
  text: z.string(),
  must: z.boolean(),
  /** Terms used by the deterministic keyword pass — includes common aliases. */
  keywords: z.array(z.string()),
  /** Only meaningful for Experience requirements that state a duration. */
  minYears: z.number().optional(),
});

export const jobRecordSchema = z.object({
  id: z.string(),
  title: z.string(),
  description: z.string(),
  summary: z.string(),
  requirements: z.array(requirementSchema),
  /** Set once the requirements have been reviewed/edited by the recruiter. */
  reviewed: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
  analyzedBy: parseEngineSchema,
});

/* ------------------------------------------------------------------ */
/* Scoring & evidence                                                  */
/* ------------------------------------------------------------------ */

export const scoreCategorySchema = z.enum([
  "skills",
  "experience",
  "education",
  "certifications",
  "projects",
]);

export const weightsSchema = z.object({
  skills: z.number(),
  experience: z.number(),
  education: z.number(),
  certifications: z.number(),
  projects: z.number(),
});

/** The three signals blended into every category score. */
export const signalBreakdownSchema = z.object({
  keyword: z.number(),
  semantic: z.number(),
  ai: z.number().nullable(),
});

/** Where an evidence item came from — the provenance guarantee (P5). */
export const evidenceProvenanceSchema = z.enum(["keyword", "semantic", "ai"]);

/**
 * An evidence item with provenance and confidence.
 * `quote` is verbatim text from the resume; `provenance` says which signal
 * produced it; `confidence` is that signal's 0–1 confidence in the claim.
 */
export const evidenceItemSchema = z.object({
  id: z.string(),
  claim: z.string(),
  quote: z.string(),
  source: z.string(),
  provenance: evidenceProvenanceSchema,
  confidence: z.number(),
});

export const requirementVerdictSchema = z.object({
  requirementId: z.string(),
  status: z.enum(["met", "partial", "missing"]),
  score: z.number(),
  /** One-line, recruiter-readable justification (keyword or LLM evidence). */
  evidence: z.string().optional(),
  /** Granular, citable evidence items backing this verdict. */
  evidenceItems: z.array(evidenceItemSchema),
});

/** One category's 0–100 fit score, with the signal breakdown that produced it. */
export const categoryScoreSchema = z.object({
  category: scoreCategorySchema,
  value: z.number(),
  signals: signalBreakdownSchema,
});

/** Full explanation of a candidate's score against a job. */
export const scoreExplanationSchema = z.object({
  overall: z.number(),
  weights: weightsSchema,
  categories: z.array(categoryScoreSchema),
  /** Blended so far (0–100) and whether AI contributed. */
  aiAnalyzed: z.boolean(),
});

/* ------------------------------------------------------------------ */
/* Candidate (ranking/compare view)                                    */
/* ------------------------------------------------------------------ */

export const levelSchema = z.enum(["Junior", "Mid", "Senior", "Lead"]);

/** How many of the job's must-have requirements this candidate met. */
export const mustHavesSchema = z.object({
  met: z.number(),
  total: z.number(),
});

/**
 * Recruiter-facing contact block. Always populated by the producer
 * (`candidatesFor`); blind mode in the UI hides it client-side. The *AI pass*
 * never sees it — `blindProjectionSchema` strips PII before the LLM.
 */
export const contactSchema = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string(),
  location: z.string(),
  links: z.array(z.string()),
});

/**
 * The persisted scoring record for one resume against one job. This is the
 * explainable-scoring contract: raw category scores (re-weightable client-side),
 * the per-category signal breakdown, citable evidence, and the score explanation.
 */
export const matchRecordSchema = z.object({
  resumeId: z.string(),
  jobId: z.string(),
  score: scoreExplanationSchema,
  /**
   * Raw category scores 0-100, BEFORE recruiter weighting (weights apply
   * client-side). Always all five categories — the screening loop scores every
   * category, so an explicit object (not `z.record`) enforces that invariant.
   */
  categories: z.object({
    skills: z.number(),
    experience: z.number(),
    education: z.number(),
    certifications: z.number(),
    projects: z.number(),
  }),
  signals: z.object({
    skills: signalBreakdownSchema,
    experience: signalBreakdownSchema,
    education: signalBreakdownSchema,
    certifications: signalBreakdownSchema,
    projects: signalBreakdownSchema,
  }),
  requirements: z.array(requirementVerdictSchema),
  evidence: z.array(evidenceItemSchema),
  mustHaves: mustHavesSchema,
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  transferable: z.array(z.string()),
  summary: z.string(),
  /** True when this candidate got the full LLM analysis rather than the deterministic pass only. */
  aiAnalyzed: z.boolean(),
  scoredAt: z.string(),
});

/** The ranked candidate as the UI consumes it: the match plus display fields. */
export const candidateSchema = matchRecordSchema
  .omit({ resumeId: true, jobId: true, scoredAt: true })
  .extend({
    id: z.string(),
    rank: z.number(),
    contact: contactSchema,
    /** UI convenience fields derived at screening time from the parsed resume. */
    initials: z.string(),
    title: z.string(),
    years: z.number(),
    level: levelSchema,
    education: z.string(),
    fileName: z.string(),
    skills: z.array(z.string()),
  });

/* ------------------------------------------------------------------ */
/* Explain endpoint (per-candidate evidence trace)                     */
/* ------------------------------------------------------------------ */

export const explainRequestSchema = z.object({
  candidateId: z.string(),
  jobId: z.string(),
});

/** What the explain endpoint returns for one candidate against one job. */
export const explainResponseSchema = z.object({
  candidateId: z.string(),
  jobId: z.string(),
  score: scoreExplanationSchema,
  requirements: z.array(requirementVerdictSchema),
  evidence: z.array(evidenceItemSchema),
  strengths: z.array(z.string()),
  gaps: z.array(z.string()),
  transferable: z.array(z.string()),
  summary: z.string(),
});

/* ------------------------------------------------------------------ */
/* Copilot                                                             */
/* ------------------------------------------------------------------ */

/** Which engine produced a copilot answer — the graceful-degradation label. */
export const copilotEngineSchema = z.enum(["agent", "deterministic"]);

/** A tool call the copilot may issue. */
export const copilotToolSchema = z.enum([
  "search_candidates",
  "get_verdicts",
  "compare",
  "gap_summary",
  "must_have_report",
]);

export const copilotRequestSchema = z.object({
  jobId: z.string(),
  question: z.string(),
  blind: z.boolean().optional(),
  /**
   * The recruiter's current category weights, so the agent ranks the pool the
   * same way the ranking UI does. Defaults to DEFAULT_WEIGHTS when omitted.
   */
  weights: weightsSchema.optional(),
});

export const copilotResponseSchema = z.object({
  answer: z.string(),
  /** Citations back into stored verdicts/evidence — the copilot cannot assert without these. */
  citations: z.array(evidenceItemSchema),
  tools: z.array(copilotToolSchema),
  /** `agent` = LLM tool-using pass; `deterministic` = offline rule-based fallback. */
  engine: copilotEngineSchema,
});

/* ------------------------------------------------------------------ */
/* Store / run metadata                                                */
/* ------------------------------------------------------------------ */

export const resumeRecordSchema = z.object({
  id: z.string(),
  fileName: z.string(),
  fileSize: z.number(),
  stage: uploadStageSchema,
  progress: z.number(),
  error: z.string().optional(),
  /** File name of the earlier upload this one duplicates. */
  duplicateOf: z.string().optional(),
  uploadedAt: z.string(),
  processedAt: z.string().optional(),
  pageCount: z.number().optional(),
  /** True when the document had no usable embedded text and had to go through OCR. */
  scanned: z.boolean().optional(),
  textSource: textSourceSchema.optional(),
  parseEngine: parseEngineSchema.optional(),
  textChars: z.number().optional(),
  parsed: parsedResumeSchema.optional(),
});

export const screeningRunSchema = z.object({
  jobId: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().optional(),
  total: z.number(),
  scored: z.number(),
  aiAnalyzed: z.number(),
  running: z.boolean(),
  error: z.string().optional(),
});
