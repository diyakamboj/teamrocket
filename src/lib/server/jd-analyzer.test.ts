import { describe, expect, it, vi } from "vitest";

// Force the offline path deterministically regardless of the developer's shell.
// vi.mock is hoisted above the imports, so the static imports below receive the
// mocked config (same pattern as resume-parser.test.ts).
vi.mock("@/lib/server/config", () => ({
  config: {},
  capabilities: () => ({
    documentIntelligence: false,
    chat: false,
    embeddings: false,
  }),
}));

import {
  analyzeJobDescription,
  coerceJobAnalysis,
  deriveKeywords,
  heuristicRequirements,
} from "@/lib/server/jd-analyzer";

const SAMPLE_JD = `Senior Backend Engineer

About us: We are building the next generation of payments infrastructure.

Requirements:
- Minimum 5+ years of backend engineering experience
- Strong proficiency with Kubernetes in production
- Bachelor's degree in Computer Science required
- AWS Certified Solutions Architect preferred
- Nice to have: experience with Kafka
`;

describe("heuristicRequirements", () => {
  it("extracts the role title from the first short line", () => {
    const { title } = heuristicRequirements(SAMPLE_JD, "job-1");
    expect(title).toBe("Senior Backend Engineer");
  });

  it("extracts requirements with category, must flag, and minYears", () => {
    const { requirements } = heuristicRequirements(SAMPLE_JD, "job-1");
    expect(requirements).toHaveLength(5);

    const kubernetes = requirements.find((r) => r.text.includes("Kubernetes"));
    expect(kubernetes?.category).toBe("Skills");
    expect(kubernetes?.must).toBe(true);

    const years = requirements.find((r) => r.text.includes("Minimum"));
    expect(years?.category).toBe("Experience");
    expect(years?.minYears).toBe(5);
    expect(years?.must).toBe(true);

    const degree = requirements.find((r) => r.text.includes("Bachelor"));
    expect(degree?.category).toBe("Education");
    expect(degree?.must).toBe(true);

    const cert = requirements.find((r) => r.text.includes("AWS Certified"));
    expect(cert?.category).toBe("Certifications");
    expect(cert?.must).toBe(false);

    // A nice-to-have experience line is not a must, and states no duration.
    const kafka = requirements.find((r) => r.text.includes("Kafka"));
    expect(kafka?.category).toBe("Experience");
    expect(kafka?.must).toBe(false);
    expect(kafka?.minYears).toBeUndefined();
  });

  it("assigns sequential ids and derives keywords for each requirement", () => {
    const { requirements } = heuristicRequirements(SAMPLE_JD, "job-1");
    requirements.forEach((r, i) => {
      expect(r.id).toBe(`job-1-req-${i + 1}`);
      expect(r.keywords.length).toBeGreaterThan(0);
    });
  });

  it("skips company prose and section headings", () => {
    const { requirements } = heuristicRequirements(SAMPLE_JD, "job-1");
    expect(requirements.some((r) => r.text.includes("About us"))).toBe(false);
    expect(requirements.some((r) => r.text === "Requirements:")).toBe(false);
  });
});

describe("deriveKeywords", () => {
  it("keeps content words, lowercased, and drops stop words", () => {
    expect(
      deriveKeywords("Strong proficiency with Kubernetes and Docker"),
    ).toEqual(["kubernetes", "docker"]);
  });

  it("deduplicates and caps the result at 8 terms", () => {
    expect(
      deriveKeywords("Kubernetes and Kubernetes with Postgres and Redis"),
    ).toEqual(["kubernetes", "postgres", "redis"]);

    const capped = deriveKeywords(
      "alpha beta gamma delta epsilon zeta eta theta iota kappa",
    );
    expect(capped.length).toBeLessThanOrEqual(8);
  });
});

describe("analyzeJobDescription (offline)", () => {
  it("uses the heuristic engine and returns a contract-valid JobRecord", async () => {
    const job = await analyzeJobDescription(SAMPLE_JD, "job-1");
    expect(job.analyzedBy).toBe("heuristic");
    expect(job.id).toBe("job-1");
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.description).toBe(SAMPLE_JD);
    expect(job.reviewed).toBe(false);
    expect(job.requirements).toHaveLength(5);
    expect(typeof job.createdAt).toBe("string");
    expect(typeof job.updatedAt).toBe("string");
  });
});

describe("coerceJobAnalysis", () => {
  it("coerces messy model output and drops requirements that violate the contract", () => {
    const parsed = coerceJobAnalysis(
      {
        title: "  Backend Engineer  ",
        summary: "Screens for distributed systems.",
        requirements: [
          {
            category: "Experience",
            text: "5+ years backend",
            must: true,
            keywords: ["backend", "years"],
          },
          {
            category: "NotACategory",
            text: "invalid category coerced to Skills",
            must: true,
            keywords: [],
          },
          { text: "no category -> Skills", must: false },
          "just-a-string", // non-object entries are dropped before validation
        ],
      },
      "job-1",
    );
    expect(parsed.title).toBe("Backend Engineer");
    expect(parsed.requirements).toHaveLength(3);

    const [experience, badCategory, noCategory] = parsed.requirements;
    expect(experience?.id).toBe("job-1-req-1");
    expect(experience?.category).toBe("Experience");
    expect(experience?.keywords).toEqual(["backend", "years"]);
    expect(badCategory?.category).toBe("Skills");
    expect(noCategory?.category).toBe("Skills");
  });

  it("degrades to empty requirements for garbage input", () => {
    const parsed = coerceJobAnalysis(
      { title: "X", requirements: "not-an-array" },
      "job-1",
    );
    expect(parsed.requirements).toEqual([]);
  });
});
