import { beforeEach, describe, expect, it, vi } from "vitest";

// The agent touches three seams — capability gate, store, and the chat client.
// Pure pool/tool/deterministic functions are tested directly; the entry point is
// exercised with a mocked store and (for the agent path) a scripted chat seam.
vi.mock("@/lib/server/config", () => ({
  capabilities: vi.fn(),
}));

vi.mock("@/lib/server/store", () => ({
  store: {
    job: vi.fn(),
    matches: vi.fn(),
    resumes: vi.fn(),
  },
}));

vi.mock("@/lib/server/ai", () => ({
  chatJson: vi.fn(),
}));

import { capabilities } from "@/lib/server/config";
import { store } from "@/lib/server/store";
import { chatJson } from "@/lib/server/ai";
import {
  buildPool,
  compareCandidates,
  CopilotToolError,
  copilotAnswer,
  deterministicAnswer,
  gapSummary,
  getVerdicts,
  mustHaveReport,
  runCopilotTool,
  searchCandidates,
} from "@/lib/server/copilot";
import {
  DEFAULT_WEIGHTS,
  type EvidenceItem,
  type JobRecord,
  type MatchRecord,
  type Requirement,
  type ResumeRecord,
} from "@/lib/types";

const EVIDENCE: EvidenceItem[] = [
  {
    id: "ev-1",
    claim: "Skill: Kubernetes",
    quote: "Managed production Kubernetes clusters",
    source: "Experience",
    provenance: "keyword",
    confidence: 0.9,
  },
  {
    id: "ev-2",
    claim: "5+ years backend engineering",
    quote: "Backend engineer 2018–present",
    source: "Experience",
    provenance: "keyword",
    confidence: 0.9,
  },
  {
    id: "ev-3",
    claim: "No AWS certification",
    quote: "No certifications section",
    source: "Education",
    provenance: "keyword",
    confidence: 0.6,
  },
];

const REQUIREMENTS: Requirement[] = [
  {
    id: "r1",
    category: "Skills",
    text: "Kubernetes in production",
    must: true,
    keywords: ["kubernetes", "k8s"],
  },
  {
    id: "r2",
    category: "Experience",
    text: "5+ years backend engineering",
    must: true,
    keywords: ["backend"],
    minYears: 5,
  },
  {
    id: "r3",
    category: "Certifications",
    text: "AWS Certified",
    must: false,
    keywords: ["aws"],
  },
];

const JOB: JobRecord = {
  id: "job-1",
  title: "Backend Engineer",
  description: "Backend Engineer",
  summary: "",
  requirements: REQUIREMENTS,
  reviewed: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  analyzedBy: "heuristic",
};

function makeMatch(id: string): MatchRecord {
  return {
    resumeId: id,
    jobId: "job-1",
    score: {
      overall: 0, // recomputed by buildPool under the applied weights
      weights: DEFAULT_WEIGHTS,
      categories: [
        {
          category: "skills",
          value: 70,
          signals: { keyword: 70, semantic: 0, ai: null },
        },
        {
          category: "experience",
          value: 85,
          signals: { keyword: 85, semantic: 0, ai: null },
        },
        {
          category: "education",
          value: 50,
          signals: { keyword: 50, semantic: 0, ai: null },
        },
        {
          category: "certifications",
          value: 40,
          signals: { keyword: 40, semantic: 0, ai: null },
        },
        {
          category: "projects",
          value: 60,
          signals: { keyword: 60, semantic: 0, ai: null },
        },
      ],
      aiAnalyzed: false,
    },
    categories: {
      skills: 70,
      experience: 85,
      education: 50,
      certifications: 40,
      projects: 60,
    },
    signals: {
      skills: { keyword: 70, semantic: 0, ai: null },
      experience: { keyword: 85, semantic: 0, ai: null },
      education: { keyword: 50, semantic: 0, ai: null },
      certifications: { keyword: 40, semantic: 0, ai: null },
      projects: { keyword: 60, semantic: 0, ai: null },
    },
    requirements: [
      {
        requirementId: "r1",
        status: "met",
        score: 70,
        evidence: "Kubernetes in prod",
        evidenceItems: [EVIDENCE[0]!],
      },
      {
        requirementId: "r2",
        status: "met",
        score: 85,
        evidenceItems: [EVIDENCE[1]!],
      },
      {
        requirementId: "r3",
        status: "missing",
        score: 40,
        evidenceItems: [EVIDENCE[2]!],
      },
    ],
    evidence: EVIDENCE,
    mustHaves: { met: 2, total: 2 },
    strengths: ["Kubernetes depth", "Scalable systems"],
    gaps: ["No AWS certification"],
    transferable: [],
    summary: "Strong senior platform engineer.",
    aiAnalyzed: false,
    scoredAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeResume(id: string, name: string, years: number): ResumeRecord {
  return {
    id,
    fileName: `${name.replace(/\s+/g, "-")}.pdf`,
    fileSize: 100,
    stage: "complete",
    progress: 100,
    uploadedAt: "2026-01-01T00:00:00.000Z",
    parseEngine: "heuristic",
    parsed: {
      name,
      email: `${name.toLowerCase().replace(/\s+/g, ".")}@example.com`,
      phone: "555-0100",
      location: "Seattle",
      links: [],
      title: "Platform Engineer",
      totalYearsExperience: years,
      summary: "Summary",
      skills: [{ name: "Kubernetes" }, { name: "Go" }],
      experience: [],
      education: [],
      certifications: [],
      projects: [],
    },
  };
}

const MATCHES: Record<string, MatchRecord> = {
  "res-a": makeMatch("res-a"),
  "res-b": makeMatch("res-b"),
};
const RESUMES: ResumeRecord[] = [
  makeResume("res-a", "Ada Lovelace", 8),
  makeResume("res-b", "Grace Hopper", 4),
];

type ParsedJson = { label?: string; gap?: string; count?: number };

describe("buildPool", () => {
  it("ranks under the applied weights and carries the frozen match data", () => {
    const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, false);
    expect(pool).toHaveLength(2);
    // Score tie is broken by name; both carry rank, verdicts and evidence.
    expect(pool[0]!.label).toBe("Ada Lovelace");
    expect(pool.map((c) => c.rank)).toEqual([1, 2]);
    expect(pool[0]!.categories.skills).toBe(70);
    expect(pool[0]!.verdicts).toHaveLength(3);
    expect(pool[0]!.evidence).toHaveLength(3);
  });

  it("anonymizes labels in blind mode", () => {
    const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, true);
    expect(pool.map((c) => c.label)).toEqual(["Candidate #1", "Candidate #2"]);
    expect(pool.some((c) => /ada|grace/i.test(c.label))).toBe(false);
  });

  it("skips resumes that are not complete or that have no match", () => {
    const pending: ResumeRecord = {
      ...RESUMES[0]!,
      id: "res-c",
      stage: "parsing",
    };
    const pool = buildPool(
      MATCHES,
      [RESUMES[0]!, pending],
      DEFAULT_WEIGHTS,
      false,
    );
    expect(pool).toHaveLength(1);
  });
});

describe("searchCandidates", () => {
  const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, false);

  it("filters by skill and keeps the evidence for citations", () => {
    const result = searchCandidates(pool, { skill: "kubernetes" });
    const rows = JSON.parse(result.text) as ParsedJson[];
    expect(rows).toHaveLength(2);
    expect(result.evidence.length).toBeGreaterThan(0);
  });

  it("filters by tenure and level", () => {
    expect(
      JSON.parse(searchCandidates(pool, { minYears: 6 }).text),
    ).toHaveLength(1);
    // Ada is Senior (8y), Grace is Mid (4y) — Senior narrows to one.
    expect(
      JSON.parse(searchCandidates(pool, { level: "Senior" }).text),
    ).toHaveLength(1);
  });

  it("returns no rows when nothing matches", () => {
    expect(
      JSON.parse(searchCandidates(pool, { skill: "rust" }).text),
    ).toHaveLength(0);
  });
});

describe("getVerdicts", () => {
  const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, false);

  it("resolves a candidate by label and returns per-requirement verdicts with evidence", () => {
    const result = getVerdicts(pool, REQUIREMENTS, {
      candidateId: "Ada Lovelace",
    });
    const rows = JSON.parse(result.text) as {
      candidate: string;
      requirements: {
        requirement: string;
        status: string;
        evidenceItems: { id: string }[];
      }[];
    }[];
    expect(rows[0]!.candidate).toBe("Ada Lovelace");
    expect(rows[0]!.requirements).toHaveLength(3);
    expect(rows[0]!.requirements[0]!.status).toBe("met");
    expect(result.evidence).toContainEqual(
      expect.objectContaining({ id: "ev-1" }),
    );
  });

  it("throws a CopilotToolError for an unknown candidate", () => {
    expect(() =>
      getVerdicts(pool, REQUIREMENTS, { candidateId: "nobody" }),
    ).toThrow(CopilotToolError);
  });
});

describe("compareCandidates", () => {
  const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, false);

  it("returns side-by-side rows for the given labels", () => {
    const result = compareCandidates(pool, {
      candidateIds: ["Ada Lovelace", "Grace Hopper"],
    });
    const rows = JSON.parse(result.text) as {
      label: string;
      categories: { skills: number };
    }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.label).toBe("Ada Lovelace");
    expect(rows[0]!.categories.skills).toBe(70);
  });

  it("throws when no referenced candidate resolves", () => {
    expect(() => compareCandidates(pool, { candidateIds: ["ghost"] })).toThrow(
      CopilotToolError,
    );
  });
});

describe("gapSummary", () => {
  it("aggregates common gaps and the verdict distribution", () => {
    const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, false);
    const result = gapSummary(pool, REQUIREMENTS);
    const parsed = JSON.parse(result.text) as {
      commonGaps: { gap: string; count: number }[];
      requirements: { requirement: string; met: number; missing: number }[];
    };
    expect(parsed.commonGaps[0]).toMatchObject({
      gap: "No AWS certification",
      count: 2,
    });
    // r3 (AWS Certified) is unmet by both candidates.
    expect(
      parsed.requirements.find((r) => r.requirement.includes("AWS"))?.missing,
    ).toBe(2);
  });
});

describe("mustHaveReport", () => {
  it("lists met counts per must-have and who satisfies them all", () => {
    const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, false);
    const result = mustHaveReport(pool, REQUIREMENTS);
    const parsed = JSON.parse(result.text) as {
      mustHaves: {
        requirement: string;
        metCount: number;
        candidates: string[];
      }[];
      candidatesMeetingAll: string[];
    };
    expect(parsed.mustHaves).toHaveLength(2); // only r1, r2 are must-haves
    expect(parsed.mustHaves[0]!.metCount).toBe(2);
    expect(parsed.candidatesMeetingAll).toEqual([
      "Ada Lovelace",
      "Grace Hopper",
    ]);
    expect(result.evidence.length).toBeGreaterThan(0);
  });
});

describe("runCopilotTool", () => {
  it("dispatches each tool and coerces untrusted args", () => {
    const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, false);
    const ctx = { pool, requirements: REQUIREMENTS };
    // Garbage skill is coerced away — still returns a result over the whole pool.
    expect(
      runCopilotTool("search_candidates", { skill: 42 }, ctx).text,
    ).toBeTruthy();
    expect(
      runCopilotTool("get_verdicts", { candidateId: "Ada Lovelace" }, ctx)
        .evidence,
    ).not.toHaveLength(0);
    expect(() =>
      runCopilotTool("get_verdicts", { candidateId: "?!" }, ctx),
    ).toThrow(CopilotToolError);
  });
});

describe("deterministicAnswer", () => {
  const pool = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, false);

  it("answers the compare request with a stored-evidence citation", () => {
    const res = deterministicAnswer(
      "Compare the top 3 candidates",
      pool,
      REQUIREMENTS,
    );
    expect(res.engine).toBe("deterministic");
    expect(res.tools).toEqual(["compare"]);
    expect(res.answer).toContain("Ada Lovelace");
    expect(res.citations.length).toBeGreaterThan(0);
  });

  it("answers must-have questions and cites met candidates", () => {
    const res = deterministicAnswer(
      "who meets every must-have?",
      pool,
      REQUIREMENTS,
    );
    expect(res.tools).toEqual(["must_have_report"]);
    expect(res.answer).toContain("meet every must-have");
    expect(res.citations.length).toBeGreaterThan(0);
  });

  it("summarises gaps", () => {
    const res = deterministicAnswer(
      "What are the qualification gaps?",
      pool,
      REQUIREMENTS,
    );
    expect(res.tools).toEqual(["gap_summary"]);
    expect(res.answer).toContain("No AWS certification");
  });

  it("answers certification questions", () => {
    const res = deterministicAnswer(
      "Which candidates lack certifications?",
      pool,
      REQUIREMENTS,
    );
    expect(res.tools).toEqual(["search_candidates"]);
  });

  it("looks up a candidate by name", () => {
    const res = deterministicAnswer("tell me about Ada", pool, REQUIREMENTS);
    expect(res.tools).toEqual(["get_verdicts"]);
    expect(res.answer).toContain("Ada Lovelace");
  });

  it("falls back to a skill lookup", () => {
    // The regex-term matcher needs 3+ letters, so "Go" alone won't trigger it.
    const res = deterministicAnswer(
      "who knows kubernetes?",
      pool,
      REQUIREMENTS,
    );
    // The regex-term lookup answers with the matched term as written (lowercase).
    expect(res.answer).toContain("show kubernetes");
  });

  it("does not name-match the blind labels", () => {
    const blind = buildPool(MATCHES, RESUMES, DEFAULT_WEIGHTS, true);
    const res = deterministicAnswer(
      "which candidates are senior?",
      blind,
      REQUIREMENTS,
    );
    expect(res.answer).not.toContain("ranks #");
  });

  it("handles an empty pool", () => {
    const res = deterministicAnswer("hi", [], REQUIREMENTS);
    expect(res.answer).toContain("No candidates have been screened");
  });
});

describe("copilotAnswer", () => {
  beforeEach(() => {
    vi.mocked(capabilities).mockReset();
    vi.mocked(store.job).mockReset();
    vi.mocked(store.matches).mockReset();
    vi.mocked(store.resumes).mockReset();
    vi.mocked(chatJson).mockReset();
  });

  it("returns guidance when there is no job", async () => {
    vi.mocked(store.job).mockReturnValue(undefined);
    const res = await copilotAnswer({ jobId: "job-x", question: "hi" });
    expect(res.engine).toBe("deterministic");
    expect(res.answer).toContain("no job");
    expect(vi.mocked(chatJson)).not.toHaveBeenCalled();
  });

  it("returns guidance when nothing is screened yet", async () => {
    vi.mocked(capabilities).mockReturnValue({
      documentIntelligence: false,
      chat: true,
      embeddings: false,
    });
    vi.mocked(store.job).mockReturnValue(JOB);
    vi.mocked(store.matches).mockReturnValue({});
    vi.mocked(store.resumes).mockReturnValue([]);
    const res = await copilotAnswer({ jobId: "job-1", question: "hi" });
    expect(res.answer).toContain("No candidates have been screened");
  });

  it("answers deterministically offline and never calls the model", async () => {
    vi.mocked(capabilities).mockReturnValue({
      documentIntelligence: false,
      chat: false,
      embeddings: false,
    });
    vi.mocked(store.job).mockReturnValue(JOB);
    vi.mocked(store.matches).mockReturnValue(MATCHES);
    vi.mocked(store.resumes).mockReturnValue(RESUMES);

    const res = await copilotAnswer({
      jobId: "job-1",
      question: "who meets every must-have?",
    });
    expect(res.engine).toBe("deterministic");
    expect(res.tools).toEqual(["must_have_report"]);
    expect(vi.mocked(chatJson)).not.toHaveBeenCalled();
  });

  it("runs the agent and resolves citations only against the tool's own evidence", async () => {
    vi.mocked(capabilities).mockReturnValue({
      documentIntelligence: false,
      chat: true,
      embeddings: false,
    });
    vi.mocked(store.job).mockReturnValue(JOB);
    vi.mocked(store.matches).mockReturnValue(MATCHES);
    vi.mocked(store.resumes).mockReturnValue(RESUMES);
    vi.mocked(chatJson)
      .mockResolvedValueOnce({ tool: "must_have_report", args: {} })
      .mockResolvedValueOnce({
        answer: "Both candidates meet every must-have.",
        evidenceIds: ["ev-1", "not-shown"],
      });

    const res = await copilotAnswer({
      jobId: "job-1",
      question: "who meets every must-have?",
    });
    expect(res.engine).toBe("agent");
    expect(res.tools).toEqual(["must_have_report"]);
    // "not-shown" never reached the model, so it cannot be cited.
    expect(res.citations.map((e) => e.id)).toEqual(["ev-1"]);
    expect(vi.mocked(chatJson)).toHaveBeenCalledTimes(2);
  });

  it("degrades to deterministic when the model picks no usable tool", async () => {
    vi.mocked(capabilities).mockReturnValue({
      documentIntelligence: false,
      chat: true,
      embeddings: false,
    });
    vi.mocked(store.job).mockReturnValue(JOB);
    vi.mocked(store.matches).mockReturnValue(MATCHES);
    vi.mocked(store.resumes).mockReturnValue(RESUMES);
    vi.mocked(chatJson).mockResolvedValueOnce({ garbage: true });

    const res = await copilotAnswer({
      jobId: "job-1",
      question: "who meets every must-have?",
    });
    expect(res.engine).toBe("deterministic");
    expect(vi.mocked(chatJson)).toHaveBeenCalledTimes(1);
  });

  it("degrades to deterministic when the chat call fails", async () => {
    vi.mocked(capabilities).mockReturnValue({
      documentIntelligence: false,
      chat: true,
      embeddings: false,
    });
    vi.mocked(store.job).mockReturnValue(JOB);
    vi.mocked(store.matches).mockReturnValue(MATCHES);
    vi.mocked(store.resumes).mockReturnValue(RESUMES);
    vi.mocked(chatJson).mockRejectedValue(new Error("AzureOpenAIError 401"));

    const res = await copilotAnswer({ jobId: "job-1", question: "hi" });
    expect(res.engine).toBe("deterministic");
    expect(res.answer.length).toBeGreaterThan(0);
  });
});
