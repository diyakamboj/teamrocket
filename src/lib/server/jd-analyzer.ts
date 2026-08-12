import { capabilities } from "./config";
import { chatJson } from "./ai";
import { jobRecordSchema, requirementSchema } from "@/lib/validation";
import {
  REQUIREMENT_CATEGORIES,
  type JobRecord,
  type ParseEngine,
  type Requirement,
  type RequirementCategory,
} from "@/lib/types";

const SYSTEM_PROMPT = `You extract screening requirements from job descriptions for a recruiting platform.

Produce one requirement per distinct, checkable hiring criterion. Rules:
- category must be exactly one of: Skills, Experience, Education, Certifications.
- text is a short recruiter-readable criterion (max 12 words), e.g. "5+ years backend engineering" or "Kubernetes in production".
- must = true only when the job description states it as required/essential/minimum. Anything described as preferred, nice-to-have, bonus or plus is must = false.
- keywords are the literal terms a keyword search should look for, including common aliases and abbreviations (e.g. "Kubernetes" -> ["kubernetes","k8s","eks","aks"]). 3-8 per requirement, lowercase.
- minYears only on Experience requirements that state a duration, as a number.
- Do not invent requirements that the description does not state. Do not duplicate the same criterion across categories.
- title is the role title. summary is 2-3 sentences describing what this role is really screening for.

Return JSON only.`;

const JOB_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    requirements: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: REQUIREMENT_CATEGORIES },
          text: { type: "string" },
          must: { type: "boolean" },
          keywords: { type: "array", items: { type: "string" } },
          minYears: { type: "number" },
        },
        required: ["category", "text", "must", "keywords"],
      },
    },
  },
  required: ["title", "summary", "requirements"],
} as const;

export async function analyzeJobDescription(
  description: string,
  id: string,
): Promise<JobRecord> {
  let title = "";
  let summary = "";
  let requirements: Requirement[] = [];
  let analyzedBy: ParseEngine = "heuristic";

  if (capabilities().chat) {
    const raw = await chatJson({
      system: SYSTEM_PROMPT,
      user: `Job description:\n"""\n${description.slice(0, 30_000)}\n"""`,
      schema: {
        name: "job_requirements",
        schema: JOB_SCHEMA as unknown as Record<string, unknown>,
      },
      maxTokens: 2500,
    });
    const parsed = coerceJobAnalysis(raw, id);
    if (parsed.requirements.length) {
      title = parsed.title;
      summary = parsed.summary;
      requirements = parsed.requirements;
      analyzedBy = "azure-openai";
    }
  }

  if (!requirements.length) {
    const fallback = heuristicRequirements(description, id);
    title = fallback.title;
    summary = fallback.summary;
    requirements = fallback.requirements;
  }

  const now = new Date().toISOString();
  const record: JobRecord = {
    id,
    title: title || "Untitled role",
    description,
    summary,
    requirements,
    reviewed: false,
    createdAt: now,
    updatedAt: now,
    analyzedBy,
  };
  // Contract gate before the record crosses into the store. The pieces above are
  // already contract-clean by construction, so this is drift insurance: return
  // the schema-validated form (which strips unknown keys) when it passes.
  const validated = jobRecordSchema.safeParse(record);
  return validated.success ? validated.data : record;
}

type LooseJob = { [K in "title" | "summary" | "requirements"]?: unknown };
type LooseRequirement = {
  [K in "category" | "text" | "must" | "keywords" | "minYears"]?: unknown;
};

function coerceShape(raw: unknown, jobId: string) {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as LooseJob;
  const list = Array.isArray(o.requirements) ? o.requirements : [];
  const seen = new Set<string>();

  const requirements: Requirement[] = [];
  for (const [index, item] of list.entries()) {
    if (typeof item !== "object" || item === null) continue;
    const r = item as LooseRequirement;
    const text = typeof r.text === "string" ? r.text.trim() : "";
    if (!text) continue;

    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const category = REQUIREMENT_CATEGORIES.includes(
      r.category as RequirementCategory,
    )
      ? (r.category as RequirementCategory)
      : "Skills";
    const keywords = Array.isArray(r.keywords)
      ? r.keywords
          .filter((k): k is string => typeof k === "string")
          .map((k) => k.trim().toLowerCase())
          .filter(Boolean)
      : [];
    const minYears = Number(r.minYears);

    requirements.push({
      id: `${jobId}-req-${index + 1}`,
      category,
      text,
      must: r.must === true,
      keywords: keywords.length ? [...new Set(keywords)] : deriveKeywords(text),
      minYears:
        category === "Experience" && Number.isFinite(minYears) && minYears > 0
          ? minYears
          : undefined,
    });
  }

  return {
    title: typeof o.title === "string" ? o.title.trim() : "",
    summary: typeof o.summary === "string" ? o.summary.trim() : "",
    requirements,
  };
}

/**
 * Coerce + validate untrusted model output against the frozen contract
 * (`validation.ts`). `coerceShape` normalises the shape; only requirements that
 * then satisfy `requirementSchema` enter the domain — malformed ones are dropped
 * rather than risking a bad record in the store.
 */
export function coerceJobAnalysis(
  raw: unknown,
  jobId: string,
): {
  title: string;
  summary: string;
  requirements: Requirement[];
} {
  const coerced = coerceShape(raw, jobId);
  const requirements = coerced.requirements.flatMap((r) => {
    const result = requirementSchema.safeParse(r);
    return result.success ? [result.data] : [];
  });
  return { ...coerced, requirements };
}

/* ------------------------------- fallback -------------------------------- */

const MUST_MARKERS =
  /\b(required|must have|must|essential|minimum|at least|proven|strong)\b/i;
const NICE_MARKERS =
  /\b(nice to have|preferred|plus|bonus|desirable|advantage|ideally)\b/i;

const CATEGORY_MARKERS: [RequirementCategory, RegExp][] = [
  [
    "Certifications",
    /\b(certified|certification|certificate|licence|license|pmp|cissp|cka|ckad)\b/i,
  ],
  [
    "Education",
    /\b(degree|bachelor|master|b\.?sc|m\.?sc|phd|diploma|university|graduate)\b/i,
  ],
  [
    "Experience",
    /\b(\d+\+?\s*years?|experience|track record|background in|worked on|led|owned|mentor)\b/i,
  ],
];

/** Bullet/line based extraction, used when Azure OpenAI is not configured. */
export function heuristicRequirements(description: string, jobId: string) {
  const title =
    description
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.length > 3 && l.length < 80) ?? "Untitled role";

  const seen = new Set<string>();
  const requirements: Requirement[] = [];

  for (const rawLine of description.split(/\n|(?<=[.;])\s+(?=[A-Z])/)) {
    const line = rawLine.replace(/^[-*•●\s]+/, "").trim();
    if (line.length < 8 || line.length > 200) continue;
    if (!/[a-z]/.test(line)) continue;
    // Skip prose that is describing the company rather than the candidate.
    if (/^(we are|we're|about us|our team|the company|join us)/i.test(line))
      continue;
    if (
      !MUST_MARKERS.test(line) &&
      !NICE_MARKERS.test(line) &&
      !/\b(knowledge|proficien|familiar|skills?|expertise|ability)\b/i.test(
        line,
      )
    ) {
      continue;
    }

    const text = line.replace(/\s+/g, " ").slice(0, 90);
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);

    const category =
      CATEGORY_MARKERS.find(([, pattern]) => pattern.test(line))?.[0] ??
      "Skills";
    const years = Number(line.match(/(\d{1,2})\+?\s*years?/i)?.[1]);

    requirements.push({
      id: `${jobId}-req-${requirements.length + 1}`,
      category,
      text,
      must: MUST_MARKERS.test(line) && !NICE_MARKERS.test(line),
      keywords: deriveKeywords(line),
      minYears:
        category === "Experience" && Number.isFinite(years) ? years : undefined,
    });

    if (requirements.length >= 30) break;
  }

  const mustCount = requirements.filter((r) => r.must).length;
  return {
    title,
    summary: `Extracted ${requirements.length} requirements (${mustCount} must-have) with the offline keyword parser. Configure Azure OpenAI for a semantic breakdown.`,
    requirements,
  };
}

const STOP_WORDS = new Set([
  "and",
  "the",
  "with",
  "for",
  "you",
  "your",
  "our",
  "are",
  "have",
  "has",
  "will",
  "this",
  "that",
  "from",
  "into",
  "using",
  "use",
  "used",
  "must",
  "should",
  "strong",
  "proven",
  "experience",
  "years",
  "year",
  "plus",
  "nice",
  "good",
  "excellent",
  "ability",
  "able",
  "work",
  "working",
  "knowledge",
  "understanding",
  "familiarity",
  "familiar",
  "proficiency",
  "proficient",
  "required",
  "preferred",
  "essential",
  "minimum",
  "least",
  "skills",
  "skill",
  "including",
  "such",
  "etc",
  "across",
  "within",
  "other",
  "more",
  "than",
  "who",
  "can",
  "new",
  "all",
  "any",
]);

/** Content words from a requirement line, used as the keyword-match terms. */
export function deriveKeywords(text: string): string[] {
  const tokens =
    text
      .toLowerCase()
      .match(/[a-z][a-z0-9+#./-]{1,}/g)
      ?.filter((token) => token.length > 2 && !STOP_WORDS.has(token)) ?? [];
  return [...new Set(tokens)].slice(0, 8);
}
