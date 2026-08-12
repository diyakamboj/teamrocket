/**
 * copilot.ts — the recruiter copilot agent.
 *
 * A bounded two-step tool-using agent grounded in screening data:
 *   1. The model picks ONE tool (search_candidates / get_verdicts / compare /
 *      gap_summary / must_have_report) against the scored pool.
 *   2. The tool runs against the STORE — the model never re-runs the scoring
 *      engine — then the model writes the answer from the tool's output.
 *
 * No agentic loop: exactly two LLM calls per question, each with a token cap
 * (the docs' "bounded by tool-call token budget").
 *
 * Citations are the no-fabrication guarantee (AI principles #1, #3): the model
 * references evidence by id, and `resolveCitations` maps those ids back onto the
 * evidence actually passed in the tool output. The agent cannot cite anything it
 * wasn't shown, and nothing that isn't a stored verdict/evidence item.
 *
 * Graceful degradation is a product feature: with chat unavailable (or on any
 * model/tool error) `deterministicAnswer` answers from the same pool and still
 * cites stored evidence — the response labels which engine produced it.
 *
 * Blind mode strips PII: pool labels become "Candidate #N" and no name, file
 * name or contact detail reaches the model — the same standard as the scoring
 * blind projection (`compactResume` omits contact fields).
 */

import { z } from "zod";
import { capabilities } from "./config";
import { chatJson } from "./ai";
import { store } from "./store";
import { copilotToolSchema } from "@/lib/validation";
import {
  DEFAULT_WEIGHTS,
  levelFromYears,
  scoreOf,
  type CandidateLevel,
  type CopilotRequest,
  type CopilotResponse,
  type CopilotTool,
  type EvidenceItem,
  type MatchRecord,
  type Requirement,
  type RequirementVerdict,
  type ResumeRecord,
  type Weights,
} from "@/lib/types";

/* ------------------------- agent-internal schemas ------------------------- */

/** Validates the model's tool-selection call. Internal to the agent — does not cross the web boundary. */
const copilotToolCallSchema = z.object({
  tool: copilotToolSchema,
  args: z.object({
    query: z.string().optional(),
    skill: z.string().optional(),
    minYears: z.number().optional(),
    level: z.string().optional(),
    candidateId: z.string().optional(),
    candidateIds: z.array(z.string()).optional(),
  }),
});

/** Validates the synthesis call: an answer plus evidence ids (resolved server-side). */
const copilotAnswerSchema = z.object({
  answer: z.string(),
  evidenceIds: z.array(z.string()),
});

/** A tool-argument problem (e.g. an unknown candidate label) — degrades to deterministic. */
export class CopilotToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CopilotToolError";
  }
}

/* --------------------------------- pool ----------------------------------- */

export type PoolCandidate = {
  id: string;
  /** Real name, or "Candidate #N" in blind mode. */
  label: string;
  rank: number;
  score: number;
  years: number;
  level: CandidateLevel;
  categories: MatchRecord["categories"];
  mustHaves: MatchRecord["mustHaves"];
  skills: string[];
  strengths: string[];
  gaps: string[];
  summary: string;
  verdicts: RequirementVerdict[];
  evidence: EvidenceItem[];
};

/**
 * Build the scored pool the tools operate on, ranked under the recruiter's
 * current weights so the agent agrees with what the recruiter sees in the UI.
 * Blind mode replaces names with rank-based labels before anything reaches a
 * model — the pool is the single anonymization point.
 */
export function buildPool(
  matches: Record<string, MatchRecord>,
  resumes: ResumeRecord[],
  weights: Weights,
  blind: boolean,
): PoolCandidate[] {
  const list: PoolCandidate[] = [];
  for (const resume of resumes) {
    if (resume.stage !== "complete" || !resume.parsed) continue;
    const match = matches[resume.id];
    if (!match) continue;
    const parsed = resume.parsed;
    const years = parsed.totalYearsExperience ?? 0;
    const name = parsed.name?.trim() || resume.fileName.replace(/\.[^.]+$/, "");
    list.push({
      id: resume.id,
      label: name,
      rank: 0,
      score: scoreOf(match.categories, weights),
      years,
      level: levelFromYears(years),
      categories: match.categories,
      mustHaves: match.mustHaves,
      skills: parsed.skills.map((s) => s.name),
      strengths: match.strengths,
      gaps: match.gaps,
      summary: match.summary,
      verdicts: match.requirements,
      evidence: match.evidence,
    });
  }
  list.sort((a, b) => b.score - a.score || a.label.localeCompare(b.label));
  return list.map((c, i) =>
    blind
      ? { ...c, rank: i + 1, label: `Candidate #${i + 1}` }
      : { ...c, rank: i + 1 },
  );
}

/* ---------------------------------- tools --------------------------------- */

export type ToolResult = {
  /** Compact JSON the synthesis step reasons over; every citeable item carries an `id`. */
  text: string;
  /** The evidence items referenced by `text` — the only ids the answer may cite. */
  evidence: EvidenceItem[];
};

/** Cap on evidence per row and rows per tool result — keeps the LLM pass token-bounded. */
const CITES_PER_ROW = 3;
const MAX_ROWS = 10;

/** Dedup evidence across rows by id, then stringify the rows for the synthesis step. */
function toToolResult(rows: { evidence?: EvidenceItem[] }[]): ToolResult {
  const seen = new Set<string>();
  const evidence: EvidenceItem[] = [];
  for (const row of rows) {
    for (const item of row.evidence ?? []) {
      if (!seen.has(item.id)) {
        seen.add(item.id);
        evidence.push(item);
      }
    }
  }
  return { text: JSON.stringify(rows), evidence };
}

function resolvePoolMember(
  pool: PoolCandidate[],
  ref: string,
): PoolCandidate | undefined {
  return pool.find((c) => c.label === ref || c.id === ref);
}

export function searchCandidates(
  pool: PoolCandidate[],
  args: {
    query?: string;
    skill?: string;
    minYears?: number;
    level?: string;
  },
): ToolResult {
  let filtered = pool;
  if (args.skill) {
    const needle = args.skill.toLowerCase();
    filtered = filtered.filter(
      (c) =>
        c.skills.some((s) => s.toLowerCase().includes(needle)) ||
        c.strengths.some((s) => s.toLowerCase().includes(needle)),
    );
  }
  if (args.minYears !== undefined)
    filtered = filtered.filter((c) => c.years >= args.minYears!);
  if (args.level)
    filtered = filtered.filter(
      (c) => c.level.toLowerCase() === args.level!.toLowerCase(),
    );
  // Free-text query: interpret as a level token, else as a skill term.
  const query = args.query?.toLowerCase();
  if (query) {
    const asLevel = (["junior", "mid", "senior", "lead"] as const).find((l) =>
      query.includes(l),
    );
    if (asLevel) {
      filtered = filtered.filter((c) => c.level.toLowerCase() === asLevel);
    } else {
      const term = query.match(/[a-z][a-z0-9+#.]{2,}/)?.[0];
      if (term)
        filtered = filtered.filter((c) =>
          c.skills.some((s) => s.toLowerCase().includes(term)),
        );
    }
  }
  const rows = filtered.slice(0, MAX_ROWS).map((c) => ({
    label: c.label,
    rank: c.rank,
    score: c.score,
    years: c.years,
    level: c.level,
    skills: c.skills.slice(0, 12),
    mustHaves: c.mustHaves,
    strengths: c.strengths,
    gaps: c.gaps,
    summary: c.summary,
    evidence: c.evidence.slice(0, CITES_PER_ROW),
  }));
  return toToolResult(rows);
}

export function getVerdicts(
  pool: PoolCandidate[],
  requirements: Requirement[],
  args: { candidateId: string },
): ToolResult {
  const member = resolvePoolMember(pool, args.candidateId);
  if (!member)
    throw new CopilotToolError(`Unknown candidate "${args.candidateId}"`);
  const reqById = new Map(requirements.map((r) => [r.id, r]));
  const verdictRows = member.verdicts.map((v) => {
    const req = reqById.get(v.requirementId);
    return {
      requirement: req?.text ?? v.requirementId,
      category: req?.category ?? null,
      must: req?.must ?? false,
      status: v.status,
      score: v.score,
      justification: v.evidence ?? null,
      evidenceItems: v.evidenceItems,
    };
  });
  return {
    text: JSON.stringify([
      {
        candidate: member.label,
        rank: member.rank,
        score: member.score,
        mustHaves: member.mustHaves,
        summary: member.summary,
        strengths: member.strengths,
        gaps: member.gaps,
        requirements: verdictRows,
      },
    ]),
    evidence: verdictRows.flatMap((r) => r.evidenceItems),
  };
}

export function compareCandidates(
  pool: PoolCandidate[],
  args: { candidateIds: string[] },
): ToolResult {
  const members = args.candidateIds
    .slice(0, 3)
    .map((ref) => resolvePoolMember(pool, ref))
    .filter((m): m is PoolCandidate => Boolean(m));
  if (!members.length)
    throw new CopilotToolError(
      "compare needs at least one known candidate — pass labels from the pool",
    );
  const rows = members.map((c) => ({
    label: c.label,
    rank: c.rank,
    score: c.score,
    categories: c.categories,
    mustHaves: c.mustHaves,
    strengths: c.strengths,
    gaps: c.gaps,
    summary: c.summary,
    evidence: c.evidence.slice(0, CITES_PER_ROW),
  }));
  return toToolResult(rows);
}

export function gapSummary(
  pool: PoolCandidate[],
  requirements: Requirement[],
): ToolResult {
  // Free-text gaps recorded by the scoring engine.
  const counts = new Map<string, number>();
  for (const c of pool) {
    for (const gap of c.gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  const gapRows = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([gap, count]) => ({
      gap,
      count,
      evidence: pool
        .filter((c) => c.gaps.includes(gap))
        .slice(0, 2)
        .flatMap((c) => c.evidence.slice(0, 1)),
    }));

  // Verdict-level gaps: requirements most often left partial/missing.
  const verdictRows = requirements.map((r) => {
    let met = 0;
    let partial = 0;
    let missing = 0;
    for (const c of pool) {
      const status = c.verdicts.find((v) => v.requirementId === r.id)?.status;
      if (status === "met") met++;
      else if (status === "partial") partial++;
      else missing++;
    }
    return { requirement: r.text, must: r.must, met, partial, missing };
  });

  return {
    text: JSON.stringify({ commonGaps: gapRows, requirements: verdictRows }),
    evidence: gapRows.flatMap((r) => r.evidence),
  };
}

export function mustHaveReport(
  pool: PoolCandidate[],
  requirements: Requirement[],
): ToolResult {
  const musts = requirements.filter((r) => r.must);
  const rows = musts.map((r) => {
    const met = pool.filter(
      (c) => c.verdicts.find((v) => v.requirementId === r.id)?.status === "met",
    );
    return {
      requirement: r.text,
      metCount: met.length,
      candidates: met.slice(0, 5).map((c) => c.label),
      evidence: met
        .slice(0, 3)
        .flatMap(
          (c) =>
            c.verdicts.find((v) => v.requirementId === r.id)?.evidenceItems ??
            [],
        ),
    };
  });
  const allMet = pool.filter(
    (c) => c.mustHaves.total > 0 && c.mustHaves.met === c.mustHaves.total,
  );
  return {
    text: JSON.stringify({
      mustHaves: rows,
      candidatesMeetingAll: allMet.map((c) => c.label),
    }),
    evidence: rows.flatMap((r) => r.evidence),
  };
}

/* ------------------------------ arg coercion ------------------------------ */

function strOpt(value: unknown): string | undefined {
  const s = typeof value === "string" ? value.trim() : "";
  return s ? s : undefined;
}
function numOpt(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}
function strArrayOpt(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

/** Runs one tool against the pool. `args` is untrusted model output — coerced, not trusted. */
export function runCopilotTool(
  tool: CopilotTool,
  args: unknown,
  ctx: { pool: PoolCandidate[]; requirements: Requirement[] },
): ToolResult {
  const o = (typeof args === "object" && args !== null ? args : {}) as Record<
    string,
    unknown
  >;
  switch (tool) {
    case "search_candidates": {
      const search: {
        query?: string;
        skill?: string;
        minYears?: number;
        level?: string;
      } = {};
      // Optional props are omitted rather than set to undefined (exactOptionalPropertyTypes).
      // Bracket access because `o` is an index-signature view of the untrusted args.
      const query = strOpt(o["query"]);
      if (query) search.query = query;
      const skill = strOpt(o["skill"]);
      if (skill) search.skill = skill;
      const minYears = numOpt(o["minYears"]);
      if (minYears !== undefined) search.minYears = minYears;
      const level = strOpt(o["level"]);
      if (level) search.level = level;
      return searchCandidates(ctx.pool, search);
    }
    case "get_verdicts":
      return getVerdicts(ctx.pool, ctx.requirements, {
        candidateId: strOpt(o["candidateId"]) ?? "",
      });
    case "compare":
      return compareCandidates(ctx.pool, {
        candidateIds: strArrayOpt(o["candidateIds"]),
      });
    case "gap_summary":
      return gapSummary(ctx.pool, ctx.requirements);
    case "must_have_report":
      return mustHaveReport(ctx.pool, ctx.requirements);
    default: {
      // Exhaustiveness check: adding a tool to the enum without a case here is a
      // compile error, not a silent fall-through.
      const exhaustive: never = tool;
      throw new CopilotToolError(`Unknown copilot tool: ${String(exhaustive)}`);
    }
  }
}

/* -------------------------------- prompts --------------------------------- */

const TOOL_SELECT_SYSTEM = `You are a recruiting copilot. A recruiter asked a question about a scored candidate pool. Pick the ONE tool that answers it, with arguments.
Output JSON: {"tool": "<tool>", "args": {...}}.
Tools:
- search_candidates: args {query?, skill?, minYears?, level?} — find/rank candidates by skill, tenure, level, or free-text query.
- get_verdicts: args {candidateId} — one candidate's per-requirement verdicts and evidence. candidateId must be a label from the pool.
- compare: args {candidateIds: [<=3]} — side-by-side comparison of up to 3 candidates. Use labels from the pool.
- gap_summary: args {} — common qualification gaps across the pool.
- must_have_report: args {} — which candidates satisfy each must-have requirement.
When the question is generic (pool health, wide shortlists), prefer gap_summary or must_have_report over search_candidates.`;

const SYNTHESIS_SYSTEM = `You are a recruiting copilot answering a recruiter's question about a scored candidate pool. Write a concise, recruiter-friendly answer using ONLY the tool output provided. Markdown bullet lists are fine.
Never invent candidates, scores, verdicts, or quotes — everything you assert must be in the tool output. Support claims by citing evidence ids in the "evidenceIds" array, using ONLY ids shown in the tool output. If nothing in the output supports a claim, don't make it. If a candidate is labelled "Candidate #N", keep using that label and never reveal a name, file name or contact detail.
Output JSON: {"answer": "...", "evidenceIds": [...]}.`;

const TOOL_CALL_SCHEMA = {
  type: "object",
  properties: {
    tool: {
      type: "string",
      enum: [
        "search_candidates",
        "get_verdicts",
        "compare",
        "gap_summary",
        "must_have_report",
      ],
    },
    args: {
      type: "object",
      properties: {
        query: { type: "string" },
        skill: { type: "string" },
        minYears: { type: "number" },
        level: { type: "string" },
        candidateId: { type: "string" },
        candidateIds: { type: "array", items: { type: "string" } },
      },
    },
  },
  required: ["tool"],
} as const;

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    answer: { type: "string" },
    evidenceIds: { type: "array", items: { type: "string" } },
  },
  required: ["answer", "evidenceIds"],
} as const;

/** Compact pool preview for the tool-selection prompt — enough to choose a tool, not to answer from. */
function poolPreview(pool: PoolCandidate[]): string {
  return pool
    .slice(0, 15)
    .map(
      (c) =>
        `- ${c.label} — score ${c.score}, ${c.years}y, ${c.level}; skills: ${
          c.skills.slice(0, 8).join(", ") || "—"
        }`,
    )
    .join("\n");
}

/* ------------------------------ agent engine ------------------------------ */

/**
 * The answer may cite only ids present in the tool output — never fabricated.
 * `pool` here is the evidence the tool actually returned, which is the sole
 * universe of citeable ids.
 */
function resolveCitations(ids: string[], pool: EvidenceItem[]): EvidenceItem[] {
  const byId = new Map(pool.map((e) => [e.id, e]));
  const seen = new Set<string>();
  const citations: EvidenceItem[] = [];
  for (const id of ids) {
    const item = byId.get(id);
    if (item && !seen.has(id)) {
      seen.add(id);
      citations.push(item);
    }
  }
  return citations;
}

async function agentAnswer(
  question: string,
  ctx: { pool: PoolCandidate[]; requirements: Requirement[] },
): Promise<CopilotResponse> {
  const selection = await chatJson({
    system: TOOL_SELECT_SYSTEM,
    user: `Pool (${ctx.pool.length} scored candidates):\n${poolPreview(ctx.pool)}\n\nQuestion: ${question}`,
    schema: {
      name: "copilot_tool_call",
      schema: TOOL_CALL_SCHEMA as unknown as Record<string, unknown>,
    },
    maxTokens: 400,
  });
  const call = copilotToolCallSchema.safeParse(selection);
  if (!call.success) throw new CopilotToolError("Model chose no usable tool");
  const { tool, args } = call.data;

  const result = runCopilotTool(tool, args, ctx);

  const answer = await chatJson({
    system: SYNTHESIS_SYSTEM,
    user: `Question: ${question}\n\nTool output:\n${result.text}`,
    schema: {
      name: "copilot_answer",
      schema: ANSWER_SCHEMA as unknown as Record<string, unknown>,
    },
    maxTokens: 800,
  });
  const parsed = copilotAnswerSchema.safeParse(answer);
  if (!parsed.success)
    throw new CopilotToolError("Model answer did not validate");

  return {
    answer: parsed.data.answer,
    citations: resolveCitations(parsed.data.evidenceIds, result.evidence),
    tools: [tool],
    engine: "agent",
  };
}

/* --------------------------- deterministic fallback ------------------------ */

/**
 * Rule-based answer used when chat is unavailable (or the agent path fails).
 * Mirrors what the old client-side copilot did, but over the same server pool,
 * and it still cites stored evidence so the no-fabrication rule holds offline.
 */
export function deterministicAnswer(
  question: string,
  pool: PoolCandidate[],
  _requirements: Requirement[],
): CopilotResponse {
  if (!pool.length) {
    return {
      answer:
        "No candidates have been screened yet. Upload resumes and run screening — the copilot answers from stored verdicts only, never guesses.",
      citations: [],
      tools: [],
      engine: "deterministic",
    };
  }

  const lower = question.toLowerCase();
  const top = pool.slice(0, 3);
  const cite = (list: PoolCandidate[], limit = 3) =>
    list.slice(0, limit).flatMap((c) => c.evidence.slice(0, 1));

  if (lower.includes("compare") || lower.includes("top 3")) {
    return {
      answer: `Top ${top.length} by current weighting:\n\n${top
        .map(
          (c) =>
            `- **#${c.rank} ${c.label}** (${c.score}) — skills ${c.categories.skills}, experience ${c.categories.experience}, education ${c.categories.education}`,
        )
        .join("\n")}`,
      citations: cite(top),
      tools: ["compare"],
      engine: "deterministic",
    };
  }

  if (lower.includes("certification")) {
    const weak = pool.filter((c) => c.categories.certifications < 45);
    return {
      answer: `${weak.length} of ${pool.length} candidates score under 45 on certifications. Consider lowering that weight or treating it as a nice-to-have.`,
      citations: cite(weak),
      tools: ["search_candidates"],
      engine: "deterministic",
    };
  }

  if (lower.includes("must") || lower.includes("requirement")) {
    const full = pool.filter(
      (c) => c.mustHaves.total > 0 && c.mustHaves.met === c.mustHaves.total,
    );
    return {
      answer: full.length
        ? `${full.length} candidate${full.length === 1 ? "" : "s"} meet every must-have:\n\n${full
            .slice(0, 5)
            .map((c) => `- **${c.label}** (${c.score})`)
            .join("\n")}`
        : "No candidate currently meets every must-have requirement. Loosening a must-have on the job description page will widen the shortlist.",
      citations: cite(full),
      tools: ["must_have_report"],
      engine: "deterministic",
    };
  }

  if (lower.includes("gap")) {
    const counts = new Map<string, number>();
    for (const c of pool) {
      for (const gap of c.gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
    }
    const common = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3);
    return {
      answer: common.length
        ? `Most common gaps across ${pool.length} candidates:\n\n${common
            .map(([gap, n]) => `- ${gap} (${n})`)
            .join("\n")}`
        : `No gaps were recorded for the current pool of ${pool.length} candidates.`,
      citations: common.flatMap(([gap]) => {
        const member = pool.find((c) => c.gaps.includes(gap));
        return member ? member.evidence.slice(0, 1) : [];
      }),
      tools: ["gap_summary"],
      engine: "deterministic",
    };
  }

  // Name lookup is skipped in blind mode: labels are "Candidate #N", so the word
  // "candidate" would otherwise match every question.
  const byName = pool.find((c) => {
    const first = c.label.split(" ")[0]!.toLowerCase();
    return first !== "candidate" && lower.includes(first);
  });
  if (byName) {
    return {
      answer: `**${byName.label}** ranks #${byName.rank} with a score of ${byName.score}.${
        byName.strengths[0] ? ` Strength: ${byName.strengths[0]}.` : ""
      }${byName.gaps[0] ? ` Gap: ${byName.gaps[0]}.` : ""}`,
      citations: byName.evidence.slice(0, 1),
      tools: ["get_verdicts"],
      engine: "deterministic",
    };
  }

  const term = lower
    .match(/[a-z][a-z0-9+#.]{2,}/g)
    ?.find((t) =>
      pool.some((c) => c.skills.some((s) => s.toLowerCase().includes(t))),
    );
  if (term) {
    const withSkill = pool
      .filter((c) => c.skills.some((s) => s.toLowerCase().includes(term)))
      .slice(0, 5);
    return {
      answer: `${withSkill.length} candidate${withSkill.length === 1 ? "" : "s"} show ${term}:\n\n${withSkill
        .map((c) => `- **${c.label}** — score ${c.score}, ${c.years} yrs`)
        .join("\n")}`,
      citations: cite(withSkill),
      tools: ["search_candidates"],
      engine: "deterministic",
    };
  }

  return {
    answer: `Across ${pool.length} scored candidates the highest match is **${top[0]!.label}** at ${top[0]!.score}. Ask about a specific skill, candidate, must-haves or gaps.`,
    citations: top[0]!.evidence.slice(0, 1),
    tools: ["search_candidates"],
    engine: "deterministic",
  };
}

/* ------------------------------- entry point ------------------------------ */

export async function copilotAnswer(
  request: CopilotRequest,
): Promise<CopilotResponse> {
  const { jobId, question, blind = false, weights = DEFAULT_WEIGHTS } = request;

  const job = store.job(jobId);
  if (!job) {
    return {
      answer:
        "There's no job to screen against yet. Analyze a job description, upload resumes, then run screening — the copilot answers from the real scored candidates.",
      citations: [],
      tools: [],
      engine: "deterministic",
    };
  }

  const pool = buildPool(store.matches(jobId), store.resumes(), weights, blind);
  if (!pool.length) {
    return {
      answer:
        "No candidates have been screened yet. Upload resumes and run screening — the copilot answers from stored verdicts only, never guesses.",
      citations: [],
      tools: [],
      engine: "deterministic",
    };
  }

  if (!capabilities().chat) {
    return deterministicAnswer(question, pool, job.requirements);
  }

  try {
    return await agentAnswer(question, {
      pool,
      requirements: job.requirements,
    });
  } catch (error) {
    // Any model or tool failure degrades to the deterministic answer — the
    // recruiter still gets a grounded, labelled reply (graceful degradation).
    return deterministicAnswer(question, pool, job.requirements);
  }
}
