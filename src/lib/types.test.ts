import { describe, expect, it } from "vitest";
import {
  DEFAULT_WEIGHTS,
  rankCandidates,
  scoreBuckets,
  scoreOf,
  type Candidate,
  type Contact,
  type Weights,
} from "@/lib/types";

/** Frozen Candidate fixture — every field the schema demands, overridable per test. */
function makeCandidate(
  overrides: Partial<Candidate> & Pick<Candidate, "id" | "contact">,
): Candidate {
  return {
    rank: 0,
    score: {
      overall: 0,
      weights: DEFAULT_WEIGHTS,
      categories: [],
      aiAnalyzed: false,
    },
    categories: {
      skills: 0,
      experience: 0,
      education: 0,
      certifications: 0,
      projects: 0,
    },
    signals: {
      skills: { keyword: 0, semantic: 0, ai: null },
      experience: { keyword: 0, semantic: 0, ai: null },
      education: { keyword: 0, semantic: 0, ai: null },
      certifications: { keyword: 0, semantic: 0, ai: null },
      projects: { keyword: 0, semantic: 0, ai: null },
    },
    requirements: [],
    evidence: [],
    mustHaves: { met: 0, total: 0 },
    strengths: [],
    gaps: [],
    transferable: [],
    summary: "",
    aiAnalyzed: false,
    initials: "??",
    title: "",
    years: 0,
    level: "Junior",
    education: "Not stated",
    fileName: "fixture.pdf",
    skills: [],
    ...overrides,
  };
}

const contact = (name: string): Contact => ({
  name,
  email: "",
  phone: "",
  location: "",
  links: [],
});

const FULL_WEIGHTS: Weights = {
  skills: 40,
  experience: 25,
  education: 15,
  certifications: 10,
  projects: 10,
};

describe("scoreOf", () => {
  it("computes the weighted average of the five category scores", () => {
    const categories = {
      skills: 80,
      experience: 60,
      education: 100,
      certifications: 50,
      projects: 0,
    };
    expect(scoreOf(categories, FULL_WEIGHTS)).toBe(67);
  });

  it("is linear — all-equal categories reproduce that value", () => {
    const categories = {
      skills: 70,
      experience: 70,
      education: 70,
      certifications: 70,
      projects: 70,
    };
    expect(scoreOf(categories, FULL_WEIGHTS)).toBe(70);
  });
});

describe("rankCandidates", () => {
  it("recomputes overall from the given weights and sorts descending", () => {
    const list: Candidate[] = [
      makeCandidate({
        id: "a",
        contact: contact("Alice"),
        categories: {
          skills: 90,
          experience: 90,
          education: 90,
          certifications: 90,
          projects: 90,
        },
      }),
      makeCandidate({
        id: "b",
        contact: contact("Bob"),
        categories: {
          skills: 40,
          experience: 40,
          education: 40,
          certifications: 40,
          projects: 40,
        },
      }),
    ];

    const ranked = rankCandidates(list, FULL_WEIGHTS);
    expect(ranked.map((c) => c.id)).toEqual(["a", "b"]);
    expect(ranked[0]?.rank).toBe(1);
    expect(ranked[1]?.rank).toBe(2);
    expect(ranked[0]?.score.overall).toBe(90);
    expect(ranked[1]?.score.overall).toBe(40);
    expect(ranked[0]?.score.weights).toEqual(FULL_WEIGHTS);
  });

  it("breaks score ties by contact name, then assigns sequential ranks", () => {
    const list: Candidate[] = [
      makeCandidate({ id: "z", contact: contact("Zoe") }),
      makeCandidate({ id: "a", contact: contact("Ava") }),
    ];

    const ranked = rankCandidates(list, DEFAULT_WEIGHTS);
    expect(ranked.map((c) => c.id)).toEqual(["a", "z"]);
    expect(ranked.map((c) => c.rank)).toEqual([1, 2]);
  });

  it("does not mutate the input list", () => {
    const list: Candidate[] = [
      makeCandidate({ id: "x", contact: contact("Xena") }),
    ];
    const before = list[0]!.rank;
    rankCandidates(list, DEFAULT_WEIGHTS);
    expect(list[0]!.rank).toBe(before);
    expect(list[0]!.score.overall).toBe(0);
  });
});

describe("scoreBuckets", () => {
  it("buckets overall scores into the five ranges", () => {
    const list: Candidate[] = [
      makeCandidate({
        id: "a",
        contact: contact("A"),
        categories: {
          skills: 100,
          experience: 100,
          education: 100,
          certifications: 100,
          projects: 100,
        },
      }),
      makeCandidate({
        id: "b",
        contact: contact("B"),
        categories: {
          skills: 70,
          experience: 70,
          education: 70,
          certifications: 70,
          projects: 70,
        },
      }),
      makeCandidate({
        id: "c",
        contact: contact("C"),
        categories: {
          skills: 0,
          experience: 0,
          education: 0,
          certifications: 0,
          projects: 0,
        },
      }),
    ];

    const buckets = scoreBuckets(rankCandidates(list, DEFAULT_WEIGHTS));
    expect(buckets.find((b) => b.bucket === "0-40")?.count).toBe(1);
    expect(buckets.find((b) => b.bucket === "70-85")?.count).toBe(1);
    expect(buckets.find((b) => b.bucket === "85-100")?.count).toBe(1);
    expect(buckets.reduce((sum, b) => sum + b.count, 0)).toBe(3);
  });
});
