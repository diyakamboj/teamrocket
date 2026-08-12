import { describe, expect, it, vi } from "vitest";

// Offline path, deterministically: no embeddings and no chat, so `screen()`
// exercises the keyword + fallback-semantics path and the frozen MatchRecord
// shape without any Azure call. `store` is stubbed only because matching.ts
// imports it (screen never touches it offline) — this also keeps tests from
// creating `.data/` in the working tree.
vi.mock("@/lib/server/config", () => ({
  config: { scoring: { aiAnalysisLimit: 50, concurrency: 4 } },
  capabilities: () => ({
    documentIntelligence: false,
    chat: false,
    embeddings: false,
  }),
}));

vi.mock("@/lib/server/store", () => ({
  store: { embedding: () => undefined, saveEmbedding: () => {} },
}));

import {
  blend,
  coerceAiAnalysis,
  keywordSignal,
  screen,
  yearsSignal,
} from "@/lib/server/matching";
import {
  DEFAULT_WEIGHTS,
  scoreOf,
  type JobRecord,
  type Requirement,
  type ResumeRecord,
} from "@/lib/types";

const JOB: JobRecord = {
  id: "job-1",
  title: "Backend Engineer",
  description: "Backend Engineer",
  summary: "",
  requirements: [
    {
      id: "job-1-req-1",
      category: "Skills",
      text: "Kubernetes in production",
      must: true,
      keywords: ["kubernetes", "k8s"],
    },
    {
      id: "job-1-req-2",
      category: "Experience",
      text: "5+ years backend engineering",
      must: true,
      keywords: ["backend"],
      minYears: 5,
    },
  ],
  reviewed: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  analyzedBy: "heuristic",
};

const RESUME: ResumeRecord = {
  id: "res-1",
  fileName: "Ada-Lovelace.pdf",
  fileSize: 1024,
  stage: "complete",
  progress: 100,
  uploadedAt: "2026-01-01T00:00:00.000Z",
  parseEngine: "heuristic",
  parsed: {
    name: "Ada Lovelace",
    email: "ada@example.com",
    title: "Platform Engineer",
    totalYearsExperience: 8,
    links: [],
    skills: [
      {
        name: "Kubernetes",
        evidence: "Managed production Kubernetes clusters",
      },
      { name: "Go", evidence: "Wrote Go services" },
    ],
    experience: [
      {
        company: "Analytical Engines",
        title: "Platform Engineer",
        highlights: [],
        technologies: [],
      },
    ],
    education: [],
    certifications: [],
    projects: [],
  },
};

const SKILLS_REQ: Requirement = {
  id: "job-1-req-1",
  category: "Skills",
  text: "Kubernetes in production",
  must: true,
  keywords: ["kubernetes", "k8s"],
};

const YEARS_REQ: Requirement = {
  id: "job-1-req-2",
  category: "Experience",
  text: "5+ years backend engineering",
  must: true,
  keywords: ["backend"],
  minYears: 5,
};

describe("keywordSignal", () => {
  it("scores a full in-category match at 100", () => {
    const hit = keywordSignal(SKILLS_REQ, "Kubernetes k8s", "Kubernetes k8s");
    expect(hit.score).toBe(100);
    expect(hit.matched).toEqual(["kubernetes", "k8s"]);
    expect(hit.missing).toEqual([]);
  });

  it("gives partial credit when only one alias of a keyword set matches", () => {
    const hit = keywordSignal(
      SKILLS_REQ,
      "Kubernetes in production",
      "Kubernetes in production",
    );
    expect(hit.matched).toEqual(["kubernetes"]);
    expect(hit.missing).toEqual(["k8s"]);
    expect(hit.score).toBe(70);
  });

  it("weakens matches found outside the requirement's own resume section", () => {
    // One of two keywords, found only out-of-category: best 0.5, coverage 0.25.
    const hit = keywordSignal(SKILLS_REQ, "", "I run Kubernetes on weekends");
    expect(hit.score).toBe(35);
  });

  it("scores no match at zero", () => {
    const hit = keywordSignal(
      SKILLS_REQ,
      "Writing Python APIs",
      "Writing Python APIs",
    );
    expect(hit.score).toBe(0);
    expect(hit.missing).toEqual(["kubernetes", "k8s"]);
  });
});

describe("yearsSignal", () => {
  it("returns undefined when the requirement states no duration", () => {
    const noYears: Requirement = { ...SKILLS_REQ, minYears: undefined };
    expect(yearsSignal(noYears, 8)).toBeUndefined();
  });

  it("scores unknown tenure as a soft 40 when the requirement wants N+ years", () => {
    expect(yearsSignal(YEARS_REQ, undefined)).toBe(40);
  });

  it("rewards candidates at or past the stated bar near the top of the scale", () => {
    expect(yearsSignal(YEARS_REQ, 5)).toBe(85);
    expect(yearsSignal(YEARS_REQ, 8)).toBe(94);
  });

  it("scales partial tenure by ratio", () => {
    expect(yearsSignal(YEARS_REQ, 2)).toBe(32); // round(2/5 * 80)
  });
});

describe("blend", () => {
  it("blends keyword + semantic when the AI signal is absent", () => {
    expect(blend({ keyword: 100, semantic: 50, ai: null })).toBe(80);
  });

  it("blends all three signals when AI contributed", () => {
    expect(blend({ keyword: 100, semantic: 100, ai: 0 })).toBe(50);
  });
});

describe("coerceAiAnalysis", () => {
  it("coerces model output into frozen evidence and clamps category scores", () => {
    const analysis = coerceAiAnalysis(
      {
        requirements: [
          {
            id: "job-1-req-1",
            status: "met",
            score: 92,
            evidence: "Kubernetes in prod",
          },
          { id: "job-1-req-2", status: "partial", score: 55 },
          { id: "job-1-req-3", status: "bogus", score: 999 }, // invalid status -> missing, clamped
        ],
        categoryScores: {
          skills: 95,
          experience: 55,
          education: 0,
          bogus: 120,
        },
        strengths: ["Kubernetes depth", "Go", "extra", "fourth"],
        gaps: [],
        transferable: ["System design"],
        evidence: [
          {
            skill: "Kubernetes",
            detail: "Managed clusters",
            source: "Experience",
          },
          { skill: "", detail: "empty claim dropped" },
          "garbage dropped",
        ],
        summary: "  Strong senior fit.  ",
      },
      "res-1",
    );

    expect(analysis.requirements.get("job-1-req-1")).toEqual({
      status: "met",
      score: 92,
      evidence: "Kubernetes in prod",
    });
    expect(analysis.requirements.get("job-1-req-2")?.status).toBe("partial");
    expect(analysis.requirements.get("job-1-req-3")).toEqual({
      status: "missing",
      score: 100,
      evidence: undefined,
    });

    expect(analysis.categoryScores).toEqual({
      skills: 95,
      experience: 55,
      education: 0,
    });
    expect(analysis.strengths).toEqual(["Kubernetes depth", "Go", "extra"]);
    expect(analysis.transferable).toEqual(["System design"]);

    expect(analysis.evidence).toEqual([
      {
        id: "res-1-ev-1",
        claim: "Kubernetes",
        quote: "Managed clusters",
        source: "Experience",
        provenance: "ai",
        confidence: 0.9,
      },
    ]);
    expect(analysis.summary).toBe("Strong senior fit.");
  });

  it("degrades to empty structures for garbage input", () => {
    const analysis = coerceAiAnalysis("not an object", "res-1");
    expect(analysis.requirements.size).toBe(0);
    expect(analysis.categoryScores).toEqual({});
    expect(analysis.evidence).toEqual([]);
    expect(analysis.strengths).toEqual([]);
    expect(analysis.summary).toBe("");
  });
});

describe("screen (offline)", () => {
  it("produces a frozen MatchRecord with keyword signals and nested must-haves", async () => {
    const matches = await screen(JOB, [RESUME]);
    expect(matches).toHaveLength(1);
    const match = matches[0]!;

    expect(match.resumeId).toBe("res-1");
    expect(match.jobId).toBe("job-1");
    expect(match.aiAnalyzed).toBe(false);
    expect(match.score.aiAnalyzed).toBe(false);
    expect(match.score.weights).toEqual(DEFAULT_WEIGHTS);
    // The stored overall always agrees with the client-side re-weighting helper.
    expect(match.score.overall).toBe(
      scoreOf(match.categories, DEFAULT_WEIGHTS),
    );
    expect(match.score.categories).toHaveLength(5);
    expect(match.score.categories[0]?.signals.ai).toBeNull();

    // Kubernetes keyword matches in its own section; the AI signal is absent.
    expect(match.categories.skills).toBe(70);
    expect(match.signals.skills.ai).toBeNull();

    // Every requirement gets a verdict with a citable evidence item.
    expect(match.requirements).toHaveLength(2);
    const kubernetes = match.requirements.find(
      (v) => v.requirementId === "job-1-req-1",
    )!;
    expect(kubernetes.status).toBe("met");
    expect(kubernetes.evidenceItems).toHaveLength(1);
    expect(kubernetes.evidenceItems[0]?.id).toBe("res-1-vr-job-1-req-1");
    expect(kubernetes.evidenceItems[0]?.provenance).toBe("keyword");

    expect(match.mustHaves).toEqual({ met: 1, total: 2 });

    // Deterministic evidence items carry the frozen shape with provenance.
    expect(match.evidence).toHaveLength(2);
    expect(match.evidence[0]).toMatchObject({
      id: "res-1-ev-1",
      claim: "Skill: Kubernetes",
      provenance: "keyword",
      confidence: 0.9,
    });
  });

  it("skips resumes that are not complete/parsed", async () => {
    const pending: ResumeRecord = { ...RESUME, id: "res-2", stage: "parsing" };
    const matches = await screen(JOB, [RESUME, pending]);
    expect(matches).toHaveLength(1);
  });
});
