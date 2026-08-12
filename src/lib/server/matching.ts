import { createHash } from "node:crypto";
import { capabilities, config } from "./config";
import { chatJson, cosineSimilarity, embed } from "./ai";
import { store } from "./store";
import {
  DEFAULT_WEIGHTS,
  scoreOf,
  type EvidenceItem,
  type JobRecord,
  type MatchRecord,
  type ParsedResume,
  type Requirement,
  type RequirementVerdict,
  type ResumeRecord,
  type ScoreCategory,
  type ScoreExplanation,
  type SignalBreakdown,
} from "@/lib/types";

const CATEGORY_OF_REQUIREMENT: Record<Requirement["category"], ScoreCategory> =
  {
    Skills: "skills",
    Experience: "experience",
    Education: "education",
    Certifications: "certifications",
  };

const ALL_CATEGORIES: ScoreCategory[] = [
  "skills",
  "experience",
  "education",
  "certifications",
  "projects",
];

/* ----------------------------- text projections --------------------------- */

/** Per-category text blobs — what each signal actually compares against. */
function projections(parsed: ParsedResume): Record<ScoreCategory, string> {
  const skills = parsed.skills
    .map((s) => [s.name, s.evidence].filter(Boolean).join(" — "))
    .join("\n");

  const experience = parsed.experience
    .map((e) =>
      [
        `${e.title} at ${e.company}`,
        [e.startDate, e.current ? "present" : e.endDate]
          .filter(Boolean)
          .join(" – "),
        e.technologies.join(", "),
        e.highlights.join(" "),
      ]
        .filter(Boolean)
        .join(" | "),
    )
    .join("\n");

  const education = parsed.education
    .map((e) =>
      [e.degree, e.field, e.institution, e.graduationYear]
        .filter(Boolean)
        .join(" "),
    )
    .join("\n");

  const certifications = parsed.certifications
    .map((c) => [c.name, c.issuer, c.issueDate].filter(Boolean).join(" "))
    .join("\n");

  const projects = parsed.projects
    .map((p) =>
      [p.name, p.description, p.technologies.join(", ")]
        .filter(Boolean)
        .join(" — "),
    )
    .join("\n");

  return { skills, experience, education, certifications, projects };
}

function fullText(parsed: ParsedResume, blobs: Record<ScoreCategory, string>) {
  return [parsed.title, parsed.summary, ...ALL_CATEGORIES.map((c) => blobs[c])]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

/* ------------------------------ keyword signal ---------------------------- */

function matchesKeyword(haystack: string, keyword: string) {
  const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // Guard the edges so "go" doesn't match "google", but allow +, #, . inside.
  return new RegExp(`(^|[^a-z0-9+#.])${escaped}([^a-z0-9+#.]|$)`, "i").test(
    haystack,
  );
}

type KeywordHit = { score: number; matched: string[]; missing: string[] };

/** Weight of a keyword found outside the requirement's own resume section. */
const OUT_OF_CATEGORY_WEIGHT = 0.5;

export function keywordSignal(
  requirement: Requirement,
  categoryText: string,
  allText: string,
): KeywordHit {
  const keywords = requirement.keywords.length
    ? requirement.keywords
    : [requirement.text];
  const matched: string[] = [];
  const missing: string[] = [];
  let weighted = 0;
  let best = 0;

  for (const keyword of keywords) {
    // An in-category hit counts fully; a mention anywhere else is weaker evidence
    // — "AWS" in a job bullet does not satisfy an AWS *certification* requirement.
    const weight = matchesKeyword(categoryText, keyword)
      ? 1
      : matchesKeyword(allText, keyword)
        ? OUT_OF_CATEGORY_WEIGHT
        : 0;

    if (weight > 0) matched.push(keyword);
    else missing.push(keyword);
    weighted += weight;
    best = Math.max(best, weight);
  }

  const coverage = keywords.length ? weighted / keywords.length : 0;
  // One strong keyword hit already means a lot; don't demand every alias.
  const score =
    best === 0 ? 0 : Math.min(100, Math.round(40 * best + coverage * 60));
  return { score, matched, missing };
}

/** Deterministic tenure check for "N+ years" requirements. */
export function yearsSignal(
  requirement: Requirement,
  years: number | undefined,
): number | undefined {
  if (!requirement.minYears) return undefined;
  if (years === undefined) return 40;
  const ratio = years / requirement.minYears;
  if (ratio >= 1)
    return Math.min(100, Math.round(85 + Math.min(ratio - 1, 1) * 15));
  return Math.max(0, Math.round(ratio * 80));
}

/* ----------------------------- semantic signal ---------------------------- */

const hashKey = (text: string) => createHash("sha1").update(text).digest("hex");

/** Embeds with a persisted cache so re-screening the same pool is nearly free. */
async function embedCached(texts: string[]): Promise<Map<string, number[]>> {
  const result = new Map<string, number[]>();
  const missing: string[] = [];

  for (const text of texts) {
    const key = hashKey(text);
    const cached = store.embedding(key);
    if (cached) result.set(text, cached);
    else if (!missing.includes(text)) missing.push(text);
  }

  if (missing.length) {
    const vectors = await embed(missing);
    missing.forEach((text, i) => {
      const vector = vectors[i]!;
      store.saveEmbedding(hashKey(text), vector);
      result.set(text, vector);
    });
  }

  return result;
}

/**
 * Maps raw cosine similarity onto a 0-100 scale. Unrelated technical prose sits
 * around 0.15 with Azure's embedding models and a solid match around 0.55.
 */
function normalizeSimilarity(cosine: number) {
  return Math.max(0, Math.min(100, Math.round(((cosine - 0.15) / 0.4) * 100)));
}

/* -------------------------------- AI signal ------------------------------- */

const ANALYSIS_SYSTEM = `You are a technical recruiter assessing one candidate against one role.
You will receive the role's requirements and a structured resume. Judge only on what the resume states.

Rules:
- For every requirement id, return a status: "met" (clear evidence), "partial" (adjacent or unclear evidence) or "missing" (no evidence), plus a 0-100 score and a one-line evidence note quoting the resume. Never claim evidence that is not there.
- categoryScores are 0-100 for skills, experience, education, certifications and projects, reflecting fit for THIS role, not general quality.
- strengths: up to 3 specific, evidence-backed reasons this candidate fits.
- gaps: up to 3 specific things the role asks for that the resume does not show.
- transferable: up to 3 adjacent experiences that partially cover a gap.
- evidence: up to 5 items of {skill, detail, source} where source names the role, project or certification it came from.
- summary: one sentence a recruiter could paste into a shortlist.
Return JSON only.`;

const ANALYSIS_SCHEMA = {
  type: "object",
  properties: {
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "string" },
          status: { type: "string", enum: ["met", "partial", "missing"] },
          score: { type: "number" },
          evidence: { type: "string" },
        },
        required: ["id", "status", "score"],
      },
    },
    categoryScores: {
      type: "object",
      properties: {
        skills: { type: "number" },
        experience: { type: "number" },
        education: { type: "number" },
        certifications: { type: "number" },
        projects: { type: "number" },
      },
      required: [
        "skills",
        "experience",
        "education",
        "certifications",
        "projects",
      ],
    },
    strengths: { type: "array", items: { type: "string" } },
    gaps: { type: "array", items: { type: "string" } },
    transferable: { type: "array", items: { type: "string" } },
    evidence: {
      type: "array",
      items: {
        type: "object",
        properties: {
          skill: { type: "string" },
          detail: { type: "string" },
          source: { type: "string" },
        },
        required: ["skill", "detail", "source"],
      },
    },
    summary: { type: "string" },
  },
  required: [
    "requirements",
    "categoryScores",
    "strengths",
    "gaps",
    "transferable",
    "summary",
  ],
} as const;

type LooseAnalysis = {
  [
    K in
      | "requirements"
      | "categoryScores"
      | "strengths"
      | "gaps"
      | "transferable"
      | "evidence"
      | "summary"
  ]?: unknown;
};
type LooseVerdict = { [K in "id" | "status" | "score" | "evidence"]?: unknown };
type LooseEvidence = { [K in "skill" | "detail" | "source"]?: unknown };

type AiAnalysis = {
  requirements: Map<
    string,
    {
      status: RequirementVerdict["status"];
      score: number;
      evidence?: string | undefined;
    }
  >;
  categoryScores: Partial<Record<ScoreCategory, number>>;
  strengths: string[];
  gaps: string[];
  transferable: string[];
  evidence: EvidenceItem[];
  summary: string;
};

function compactResume(parsed: ParsedResume) {
  return {
    title: parsed.title,
    totalYearsExperience: parsed.totalYearsExperience,
    skills: parsed.skills
      .slice(0, 60)
      .map((s) => (s.evidence ? `${s.name} (${s.evidence})` : s.name)),
    experience: parsed.experience.slice(0, 10).map((e) => ({
      title: e.title,
      company: e.company,
      period: [e.startDate, e.current ? "present" : e.endDate]
        .filter(Boolean)
        .join(" – "),
      technologies: e.technologies.slice(0, 15),
      highlights: e.highlights.slice(0, 6),
    })),
    education: parsed.education.slice(0, 5),
    certifications: parsed.certifications.slice(0, 10),
    projects: parsed.projects.slice(0, 6).map((p) => ({
      name: p.name,
      description: p.description?.slice(0, 300),
      technologies: p.technologies.slice(0, 10),
    })),
  };
}

async function analyzeCandidate(
  job: JobRecord,
  parsed: ParsedResume,
  candidateId: string,
): Promise<AiAnalysis> {
  const raw = (await chatJson({
    system: ANALYSIS_SYSTEM,
    user: `Role: ${job.title}

Requirements:
${job.requirements
  .map(
    (r) =>
      `- id=${r.id} [${r.category}${r.must ? ", MUST-HAVE" : ", nice-to-have"}] ${r.text}`,
  )
  .join("\n")}

Candidate resume (JSON):
${JSON.stringify(compactResume(parsed))}`,
    schema: {
      name: "candidate_analysis",
      schema: ANALYSIS_SCHEMA as unknown as Record<string, unknown>,
    },
    maxTokens: 2000,
  })) as LooseAnalysis;

  return coerceAiAnalysis(raw, candidateId);
}

/**
 * Coerce + validate the model's candidate analysis into domain types. Untrusted
 * model output (AI principles #1): every field is narrowed, clamped and sliced
 * here — nothing reaches the match record unchecked. `idPrefix` (the resume id)
 * keeps evidence item ids stable across a re-screening.
 */
export function coerceAiAnalysis(raw: unknown, idPrefix: string): AiAnalysis {
  const o = (
    typeof raw === "object" && raw !== null ? raw : {}
  ) as LooseAnalysis;

  const clamp = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 0;
  };
  const strings = (v: unknown, limit: number) =>
    (Array.isArray(v) ? v : [])
      .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
      .map((x) => x.trim())
      .slice(0, limit);

  const requirements = new Map<
    string,
    {
      status: RequirementVerdict["status"];
      score: number;
      evidence?: string | undefined;
    }
  >();
  for (const item of Array.isArray(o.requirements) ? o.requirements : []) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as LooseVerdict;
    if (typeof r.id !== "string") continue;
    const status: RequirementVerdict["status"] =
      r.status === "met" || r.status === "partial" || r.status === "missing"
        ? r.status
        : "missing";
    requirements.set(r.id, {
      status,
      score: clamp(r.score),
      evidence:
        typeof r.evidence === "string"
          ? r.evidence.trim() || undefined
          : undefined,
    });
  }

  const scoresRaw = (
    typeof o.categoryScores === "object" && o.categoryScores !== null
      ? o.categoryScores
      : {}
  ) as Record<string, unknown>;
  const categoryScores: Partial<Record<ScoreCategory, number>> = {};
  for (const category of ALL_CATEGORIES) {
    if (scoresRaw[category] !== undefined)
      categoryScores[category] = clamp(scoresRaw[category]);
  }

  // Model evidence becomes provenance-tagged items: claim = the skill, quote =
  // the verbatim backing, provenance "ai". Confidence is high because the prompt
  // forbids asserting evidence that is not in the resume.
  const evidence: EvidenceItem[] = (Array.isArray(o.evidence) ? o.evidence : [])
    .filter((x): x is LooseEvidence => typeof x === "object" && x !== null)
    .map((e, i) => ({
      id: `${idPrefix}-ev-${i + 1}`,
      claim: String(e.skill ?? "").trim(),
      quote: String(e.detail ?? "").trim(),
      source: String(e.source ?? "").trim(),
      provenance: "ai" as const,
      confidence: 0.9,
    }))
    .filter((e) => e.claim && e.quote)
    .slice(0, 5);

  return {
    requirements,
    categoryScores,
    strengths: strings(o.strengths, 3),
    gaps: strings(o.gaps, 3),
    transferable: strings(o.transferable, 3),
    evidence,
    summary: typeof o.summary === "string" ? o.summary.trim() : "",
  };
}

/* -------------------------------- blending -------------------------------- */

export function blend(signals: SignalBreakdown): number {
  const weights =
    signals.ai === null
      ? { keyword: 0.6, semantic: 0.4, ai: 0 }
      : { keyword: 0.3, semantic: 0.2, ai: 0.5 };
  const total = weights.keyword + weights.semantic + weights.ai;
  const sum =
    signals.keyword * weights.keyword +
    signals.semantic * weights.semantic +
    (signals.ai ?? 0) * weights.ai;
  return Math.max(0, Math.min(100, Math.round(sum / total)));
}

function average(values: number[], fallback = 0) {
  if (!values.length) return fallback;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/* --------------------------------- driver --------------------------------- */

export type ScreenProgress = (progress: {
  scored: number;
  aiAnalyzed: number;
}) => void;

export async function screen(
  job: JobRecord,
  resumes: ResumeRecord[],
  onProgress?: ScreenProgress,
): Promise<MatchRecord[]> {
  const usable = resumes.filter((r) => r.stage === "complete" && r.parsed);
  if (!usable.length) return [];

  const caps = capabilities();
  const blobsByResume = new Map<string, Record<ScoreCategory, string>>();
  const textByResume = new Map<string, string>();
  for (const resume of usable) {
    const blobs = projections(resume.parsed!);
    blobsByResume.set(resume.id, blobs);
    textByResume.set(resume.id, fullText(resume.parsed!, blobs));
  }

  // --- Signal 1 & 2: deterministic keyword + embedding similarity ---
  let semanticByResume = new Map<string, Record<ScoreCategory, number>>();
  if (caps.embeddings && job.requirements.length) {
    try {
      semanticByResume = await semanticScores(job, usable, blobsByResume);
    } catch (error) {
      console.error(
        "[matching] semantic pass failed, continuing without it:",
        error,
      );
    }
  }

  const prescored = usable.map((resume) => {
    const blobs = blobsByResume.get(resume.id)!;
    const allText = textByResume.get(resume.id)!;
    const semantic = semanticByResume.get(resume.id);
    const keyword = keywordScores(job, resume, blobs, allText);
    const prescore = average(
      ALL_CATEGORIES.map(
        (c) =>
          (keyword.byCategory[c] + (semantic?.[c] ?? keyword.byCategory[c])) /
          2,
      ),
    );
    return { resume, blobs, allText, keyword, semantic, prescore };
  });

  // --- Signal 3: LLM analysis, best-first within the configured budget ---
  const aiOrder = [...prescored].sort((a, b) => b.prescore - a.prescore);
  const aiTargets = new Set(
    caps.chat
      ? aiOrder.slice(0, config.scoring.aiAnalysisLimit).map((p) => p.resume.id)
      : [],
  );

  const analyses = new Map<string, AiAnalysis>();
  let scored = 0;
  let aiAnalyzed = 0;

  await runPool(
    aiOrder.filter((p) => aiTargets.has(p.resume.id)),
    config.scoring.concurrency,
    async (entry) => {
      try {
        analyses.set(
          entry.resume.id,
          await analyzeCandidate(job, entry.resume.parsed!, entry.resume.id),
        );
        aiAnalyzed += 1;
      } catch (error) {
        console.error(
          `[matching] AI analysis failed for ${entry.resume.fileName}:`,
          error,
        );
      }
      onProgress?.({ scored, aiAnalyzed });
    },
  );

  // --- Combine ---
  const matches: MatchRecord[] = [];
  for (const entry of prescored) {
    const analysis = analyses.get(entry.resume.id);
    const signals = {} as Record<ScoreCategory, SignalBreakdown>;
    const categories = {} as Record<ScoreCategory, number>;

    for (const category of ALL_CATEGORIES) {
      signals[category] = {
        keyword: entry.keyword.byCategory[category],
        semantic:
          entry.semantic?.[category] ?? entry.keyword.byCategory[category],
        ai: analysis?.categoryScores[category] ?? null,
      };
      categories[category] = blend(signals[category]);
    }

    const requirements: RequirementVerdict[] = job.requirements.map(
      (requirement) => {
        const fromAi = analysis?.requirements.get(requirement.id);
        const deterministic = entry.keyword.byRequirement.get(requirement.id);
        const claim = requirement.text;
        if (fromAi) {
          // The AI verdict cites the model's own evidence sentence when present,
          // otherwise it degrades to the deterministic keyword hit (same provenance).
          const evidence =
            fromAi.evidence ?? deterministicEvidence(deterministic);
          return {
            requirementId: requirement.id,
            status: fromAi.status,
            score: fromAi.score,
            evidence,
            evidenceItems: [
              {
                id: `${entry.resume.id}-vr-${requirement.id}`,
                claim,
                quote:
                  evidence ??
                  "No explicit evidence sentence returned by the model.",
                source: fromAi.evidence ? "candidate analysis" : "keyword pass",
                provenance: fromAi.evidence
                  ? ("ai" as const)
                  : ("keyword" as const),
                confidence: fromAi.status === "met" ? 0.9 : 0.6,
              },
            ],
          };
        }
        const score = deterministic?.score ?? 0;
        const status: RequirementVerdict["status"] =
          score >= 70 ? "met" : score >= 35 ? "partial" : "missing";
        const evidence = deterministicEvidence(deterministic);
        return {
          requirementId: requirement.id,
          status,
          score,
          evidence,
          evidenceItems: evidence
            ? [
                {
                  id: `${entry.resume.id}-vr-${requirement.id}`,
                  claim,
                  quote: evidence,
                  source: "keyword pass",
                  provenance: "keyword" as const,
                  confidence: score / 100,
                },
              ]
            : [],
        };
      },
    );

    const mustHaves = job.requirements.filter((r) => r.must);
    const mustMet = mustHaves.filter(
      (r) =>
        requirements.find((v) => v.requirementId === r.id)?.status === "met",
    ).length;

    matches.push({
      resumeId: entry.resume.id,
      jobId: job.id,
      // The score explanation snapshots the raw categories + signals so the
      // client can re-weight instantly without re-running the pipeline.
      score: {
        overall: scoreOf(categories, DEFAULT_WEIGHTS),
        weights: DEFAULT_WEIGHTS,
        categories: ALL_CATEGORIES.map((category) => ({
          category,
          value: categories[category],
          signals: signals[category],
        })),
        aiAnalyzed: Boolean(analysis),
      },
      categories,
      signals,
      requirements,
      evidence: analysis?.evidence.length
        ? analysis.evidence
        : deterministicEvidenceItems(entry.resume),
      mustHaves: { met: mustMet, total: mustHaves.length },
      strengths: analysis?.strengths.length
        ? analysis.strengths
        : deterministicStrengths(job, entry.keyword, entry.resume),
      gaps: analysis?.gaps.length
        ? analysis.gaps
        : deterministicGaps(job, entry.keyword),
      transferable: analysis?.transferable ?? [],
      summary: analysis?.summary ?? "",
      aiAnalyzed: Boolean(analysis),
      scoredAt: new Date().toISOString(),
    });

    scored += 1;
    onProgress?.({ scored, aiAnalyzed });
  }

  return matches;
}

type KeywordResult = {
  byCategory: Record<ScoreCategory, number>;
  byRequirement: Map<string, KeywordHit & { score: number }>;
};

function keywordScores(
  job: JobRecord,
  resume: ResumeRecord,
  blobs: Record<ScoreCategory, string>,
  allText: string,
): KeywordResult {
  const byRequirement = new Map<string, KeywordHit & { score: number }>();
  const perCategory: Record<
    ScoreCategory,
    { score: number; weight: number }[]
  > = {
    skills: [],
    experience: [],
    education: [],
    certifications: [],
    projects: [],
  };

  for (const requirement of job.requirements) {
    const category = CATEGORY_OF_REQUIREMENT[requirement.category];
    const hit = keywordSignal(requirement, blobs[category], allText);
    const tenure = yearsSignal(
      requirement,
      resume.parsed?.totalYearsExperience,
    );
    const score =
      tenure === undefined
        ? hit.score
        : Math.round(hit.score * 0.4 + tenure * 0.6);

    byRequirement.set(requirement.id, { ...hit, score });
    perCategory[category].push({ score, weight: requirement.must ? 1 : 0.6 });

    // Project work is scored against the same role keywords, in the projects text.
    const projectHit = keywordSignal(
      requirement,
      blobs.projects,
      blobs.projects,
    );
    if (projectHit.matched.length) {
      perCategory.projects.push({
        score: projectHit.score,
        weight: requirement.must ? 1 : 0.6,
      });
    }
  }

  const byCategory = {} as Record<ScoreCategory, number>;
  for (const category of ALL_CATEGORIES) {
    const entries = perCategory[category];
    if (!entries.length) {
      // No requirement touches this category — fall back to "is there anything here at all".
      byCategory[category] = blobs[category].trim() ? 55 : 20;
      continue;
    }
    const weight = entries.reduce((sum, e) => sum + e.weight, 0);
    byCategory[category] = Math.round(
      entries.reduce((sum, e) => sum + e.score * e.weight, 0) / (weight || 1),
    );
  }

  return { byCategory, byRequirement };
}

async function semanticScores(
  job: JobRecord,
  resumes: ResumeRecord[],
  blobsByResume: Map<string, Record<ScoreCategory, string>>,
): Promise<Map<string, Record<ScoreCategory, number>>> {
  const requirementTexts = job.requirements.map(
    (r) => `${r.category}: ${r.text}`,
  );
  const blobTexts: string[] = [];
  for (const resume of resumes) {
    const blobs = blobsByResume.get(resume.id)!;
    for (const category of ALL_CATEGORIES) {
      const text = blobs[category].trim();
      if (text) blobTexts.push(text.slice(0, 6000));
    }
  }

  const vectors = await embedCached([
    ...new Set([...requirementTexts, ...blobTexts]),
  ]);
  const result = new Map<string, Record<ScoreCategory, number>>();

  for (const resume of resumes) {
    const blobs = blobsByResume.get(resume.id)!;
    const scores = {} as Record<ScoreCategory, number>;

    for (const category of ALL_CATEGORIES) {
      const text = blobs[category].trim().slice(0, 6000);
      const blobVector = text ? vectors.get(text) : undefined;
      if (!blobVector) {
        scores[category] = 0;
        continue;
      }

      const relevant = job.requirements.filter(
        (r) => CATEGORY_OF_REQUIREMENT[r.category] === category,
      );
      // Projects have no requirements of their own — measure them against the whole role.
      const compareAgainst = relevant.length ? relevant : job.requirements;
      const similarities = compareAgainst
        .map((r) => vectors.get(`${r.category}: ${r.text}`))
        .filter((v): v is number[] => Boolean(v))
        .map((v) => normalizeSimilarity(cosineSimilarity(v, blobVector)));

      scores[category] = similarities.length
        ? Math.round(average(similarities))
        : 0;
    }

    result.set(resume.id, scores);
  }

  return result;
}

function deterministicEvidence(hit?: KeywordHit) {
  if (!hit?.matched.length) return undefined;
  return `Keyword match: ${hit.matched.slice(0, 5).join(", ")}`;
}

function deterministicStrengths(
  job: JobRecord,
  keyword: KeywordResult,
  resume: ResumeRecord,
) {
  const strong = job.requirements
    .filter((r) => (keyword.byRequirement.get(r.id)?.score ?? 0) >= 70)
    .slice(0, 3)
    .map((r) => `Evidence found for “${r.text}”`);
  const years = resume.parsed?.totalYearsExperience;
  if (years) strong.unshift(`${years} years of stated professional experience`);
  return strong.slice(0, 3);
}

function deterministicGaps(job: JobRecord, keyword: KeywordResult) {
  return job.requirements
    .filter((r) => (keyword.byRequirement.get(r.id)?.score ?? 0) < 35)
    .slice(0, 3)
    .map((r) => `No evidence for “${r.text}”${r.must ? " (must-have)" : ""}`);
}

function deterministicEvidenceItems(resume: ResumeRecord): EvidenceItem[] {
  const parsed = resume.parsed;
  if (!parsed) return [];
  // Keyword provenance: claim = the skill, quote = the verbatim evidence the
  // parser anchored on, source = where on the resume it lives.
  return parsed.skills
    .filter((s) => s.evidence)
    .slice(0, 4)
    .map((s, i) => ({
      id: `${resume.id}-ev-${i + 1}`,
      claim: `Skill: ${s.name}`,
      quote: s.evidence!,
      source: parsed.experience[0]?.company ?? resume.fileName,
      provenance: "keyword" as const,
      confidence: 0.9,
    }));
}

/** Runs an async task over items with a fixed number of workers. */
async function runPool<T>(
  items: T[],
  size: number,
  task: (item: T) => Promise<void>,
) {
  const queue = [...items];
  const workers = Array.from(
    { length: Math.max(1, Math.min(size, queue.length)) },
    async () => {
      while (queue.length) {
        const item = queue.shift();
        if (item === undefined) return;
        await task(item);
      }
    },
  );
  await Promise.all(workers);
}
