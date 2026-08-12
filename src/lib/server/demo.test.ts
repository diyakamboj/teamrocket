import { beforeEach, describe, expect, it, vi } from "vitest";

// Offline smoke test for the demo seed: capabilities report all-offline and the
// AI seam is mocked, so exercising `demoData()` proves the *full* parse → JD
// analysis → screening chain completes with zero Azure and never calls the LLM.
// The store is stubbed so nothing hits `.data/` in the working tree, and so we
// can assert exactly what a demo load persists.
const storeMock = vi.hoisted(() => ({
  resetAllCalls: 0,
  addResumeCalls: 0,
  saveJobCalls: 0,
  saveMatchCalls: 0,
  saveRunCalls: 0,
  nextIdSeq: 0,
  lastRun: null as unknown,
}));

vi.mock("@/lib/server/config", () => ({
  config: { scoring: { aiAnalysisLimit: 50, concurrency: 4 } },
  capabilities: () => ({
    documentIntelligence: false,
    chat: false,
    embeddings: false,
  }),
}));

vi.mock("@/lib/server/ai", () => ({
  chatJson: vi.fn(),
  embed: vi.fn(),
  cosineSimilarity: vi.fn(),
}));

vi.mock("@/lib/server/store", () => ({
  store: {
    nextId: (prefix: string) => `${prefix}-demo-${++storeMock.nextIdSeq}`,
    resetAll: () => {
      storeMock.resetAllCalls += 1;
    },
    addResume: () => {
      storeMock.addResumeCalls += 1;
    },
    saveJob: () => {
      storeMock.saveJobCalls += 1;
    },
    saveMatch: () => {
      storeMock.saveMatchCalls += 1;
    },
    saveRun: (run: unknown) => {
      storeMock.saveRunCalls += 1;
      storeMock.lastRun = run;
    },
  },
}));

import { chatJson, embed } from "@/lib/server/ai";
import {
  DEMO_JOB_DESCRIPTION,
  DEMO_RESUME_TEXTS,
  demoData,
  loadDemoData,
} from "@/lib/server/demo";
import {
  jobRecordSchema,
  matchRecordSchema,
  resumeRecordSchema,
  screeningRunSchema,
} from "@/lib/validation";
import { DEFAULT_WEIGHTS, scoreOf } from "@/lib/types";

beforeEach(() => {
  storeMock.resetAllCalls = 0;
  storeMock.addResumeCalls = 0;
  storeMock.saveJobCalls = 0;
  storeMock.saveMatchCalls = 0;
  storeMock.saveRunCalls = 0;
  storeMock.lastRun = null;
  vi.clearAllMocks();
});

describe("demoData (offline pipeline smoke)", () => {
  it("parses every fixture resume into a complete, schema-valid record", async () => {
    const { resumes, job, matches } = await demoData();

    expect(DEMO_RESUME_TEXTS).toHaveLength(8);
    expect(resumes).toHaveLength(8);
    for (const resume of resumes) {
      expect(resume.stage).toBe("complete");
      expect(resume.progress).toBe(100);
      expect(resume.parseEngine).toBe("heuristic");
      expect(resume.textSource).toBe("plain-text");
      expect(resume.parsed).toBeDefined();
      expect(resume.parsed!.name).toMatch(/^[A-Z]/);
      expect(resume.parsed!.skills.length).toBeGreaterThan(0);
      expect(resumeRecordSchema.safeParse(resume).success).toBe(true);
    }

    expect(job.title).toContain("Backend Engineer");
    expect(job.requirements).toHaveLength(8);
    // Offline analysis spans all four categories with a must/nice split.
    expect(new Set(job.requirements.map((r) => r.category)).size).toBe(4);
    expect(job.requirements.filter((r) => r.must)).toHaveLength(4);
    expect(jobRecordSchema.safeParse(job).success).toBe(true);

    expect(matches).toHaveLength(resumes.length);
    for (const match of matches) {
      expect(matchRecordSchema.safeParse(match).success).toBe(true);
      // The stored overall always agrees with the client-side re-weight helper.
      expect(match.score.overall).toBe(
        scoreOf(match.categories, DEFAULT_WEIGHTS),
      );
      expect(match.aiAnalyzed).toBe(false);
    }

    // No LLM or embedding call anywhere along the chain.
    expect(chatJson).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it("screens into a believable, differentiated ranking with citable verdicts", async () => {
    const { resumes, job, matches } = await demoData();
    const nameToId = new Map(resumes.map((r) => [r.parsed!.name, r.id]));
    const matchOf = (name: string) =>
      matches.find((m) => m.resumeId === nameToId.get(name))!;

    const top = matchOf("Ada Lovelace");
    const junior = matchOf("Edsger Dijkstra");
    expect(top.score.overall).toBeGreaterThan(junior.score.overall);

    // A real gap exists in the pool: not everyone meets every must-have.
    expect(
      matches.some(
        (m) => m.mustHaves.total > 0 && m.mustHaves.met < m.mustHaves.total,
      ),
    ).toBe(true);

    // The strongest candidate carries verdicts with keyword-backed evidence.
    expect(top.requirements).toHaveLength(job.requirements.length);
    const first = top.requirements.find(
      (v) => v.requirementId === job.requirements[0]?.id,
    )!;
    expect(first.status).toBe("met");
    expect(first.evidence).toMatch(/Keyword match:/);
    expect(first.evidenceItems[0]?.provenance).toBe("keyword");
  });
});

describe("loadDemoData (store persistence)", () => {
  it("resets then persists the batch as a completed run", async () => {
    const result = await loadDemoData();

    expect(result.resumes).toBe(8);
    expect(result.screened).toBe(8);
    expect(result.jobTitle).toContain("Backend Engineer");

    expect(storeMock.resetAllCalls).toBe(1);
    expect(storeMock.addResumeCalls).toBe(8);
    expect(storeMock.saveJobCalls).toBe(1);
    expect(storeMock.saveMatchCalls).toBe(8);
    expect(storeMock.saveRunCalls).toBe(1);

    const run = storeMock.lastRun as { running: boolean; jobId: string };
    expect(run.running).toBe(false);
    expect(screeningRunSchema.safeParse(run).success).toBe(true);
  });
});
