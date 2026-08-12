import { describe, expect, it, vi } from "vitest";

// Force the offline path deterministically regardless of the developer's shell.
// vi.mock is hoisted above the imports, so the static imports below receive the
// mocked config. The real `capabilities()` gate is tested separately in
// config.test.ts.
vi.mock("@/lib/server/config", () => ({
  config: {},
  capabilities: () => ({
    documentIntelligence: false,
    chat: false,
    embeddings: false,
  }),
}));

import {
  coerceParsedResume,
  heuristicParse,
  parseResume,
} from "@/lib/server/resume-parser";

const SAMPLE_RESUME = `Jane Doe
jane.doe@example.com
+1 (415) 555-0132
linkedin.com/in/janedoe
github.com/janedoe

Product-minded engineer with 8 years of experience across React, TypeScript, and AWS.

SUMMARY
Product-minded engineer with 8 years of experience across React, TypeScript, and AWS.

SKILLS
React, TypeScript, Node.js, PostgreSQL, Docker, Kubernetes, AWS, GraphQL

EXPERIENCE
Senior Software Engineer | Acme Corp | March 2019 – Present
- Led migration of a monolith to microservices on Kubernetes
- Built a GraphQL gateway serving 2M requests/day
- Reduced deploy time from 45min to 5min with CI/CD

Software Engineer | Globex | June 2016 – February 2019
- Developed React dashboards for internal analytics
- Maintained PostgreSQL data pipelines

EDUCATION
B.Sc. Computer Science, University of California, 2016

CERTIFICATIONS
AWS Certified Solutions Architect
`;

describe("heuristicParse", () => {
  it("extracts contact details from the header", () => {
    const parsed = heuristicParse(SAMPLE_RESUME);
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.email).toBe("jane.doe@example.com");
    expect(parsed.phone).toBe("+1 (415) 555-0132");
    expect(parsed.links.some((l) => l.includes("github.com"))).toBe(true);
  });

  it("extracts known skills, canonicalised and deduplicated", () => {
    const parsed = heuristicParse(SAMPLE_RESUME);
    expect(parsed.skills.map((s) => s.name)).toEqual(
      expect.arrayContaining([
        "React",
        "TypeScript",
        "AWS",
        "Kubernetes",
        "Docker",
      ]),
    );
    // "PostgreSQL" is canonicalised to its override form.
    expect(
      parsed.skills.some((s) => s.name.toLowerCase().includes("postgres")),
    ).toBe(true);
  });

  it("parses experience blocks with dates and highlights", () => {
    const parsed = heuristicParse(SAMPLE_RESUME);
    const [first, second] = parsed.experience;
    expect(first?.company).toBe("Acme Corp");
    expect(first?.title).toContain("Senior Software Engineer");
    expect(first?.startDate).toBe("March 2019");
    expect(first?.current).toBe(true);
    expect(first?.highlights.length).toBeGreaterThan(0);
    expect(second?.company).toBe("Globex");
    expect(second?.startDate).toBe("June 2016");
    expect(second?.current).toBe(false);
  });

  it("estimates total years of experience from role durations", () => {
    const parsed = heuristicParse(SAMPLE_RESUME);
    expect(parsed.totalYearsExperience).toBeGreaterThan(8);
  });

  it("extracts education and certifications", () => {
    const parsed = heuristicParse(SAMPLE_RESUME);
    expect(parsed.education[0]?.graduationYear).toBe("2016");
    expect(parsed.education[0]?.degree).toContain("B.Sc");
    expect(parsed.certifications.some((c) => c.name.includes("AWS"))).toBe(
      true,
    );
  });
});

describe("parseResume (offline)", () => {
  it("uses the heuristic engine and matches heuristicParse when chat is unavailable", async () => {
    const { parsed, engine } = await parseResume(SAMPLE_RESUME);
    expect(engine).toBe("heuristic");
    expect(parsed).toEqual(heuristicParse(SAMPLE_RESUME));
  });
});

describe("coerceParsedResume", () => {
  it("normalises messy model output against the frozen contract", () => {
    const parsed = coerceParsedResume({
      name: "  Jane  ",
      email: null,
      links: null,
      skills: [
        { name: "React", years: "five" }, // non-numeric years -> dropped
        { name: "" }, // empty names dropped
        "just-a-string", // non-object entries dropped
        { name: "PostgreSQL", evidence: "used daily", years: 3 },
      ],
      experience: [
        {
          company: "Acme",
          title: "Engineer",
          highlights: ["x"],
          technologies: "none",
        },
      ],
    });
    expect(parsed.name).toBe("Jane");
    expect(parsed.email).toBeUndefined();
    expect(parsed.links).toEqual([]);
    expect(parsed.skills).toEqual([
      { name: "React" },
      { name: "PostgreSQL", evidence: "used daily", years: 3 },
    ]);
    expect(parsed.experience).toEqual([
      {
        company: "Acme",
        title: "Engineer",
        current: false,
        highlights: ["x"],
        technologies: [],
      },
    ]);
  });

  it("degrades to an empty-but-valid resume for garbage input", () => {
    for (const junk of [null, undefined, 42, "hello", []]) {
      const parsed = coerceParsedResume(junk);
      expect(parsed.skills).toEqual([]);
      expect(parsed.experience).toEqual([]);
      expect(parsed.education).toEqual([]);
      expect(parsed.links).toEqual([]);
    }
  });
});
