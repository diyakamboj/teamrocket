import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the Azure OpenAI JD-analysis path without a network call: mock the
// capability gate (chat on) and the chat seam. Everything downstream — coercion,
// schema validation, fallback — runs for real (same pattern as
// resume-parser.llm.test.ts).
vi.mock("@/lib/server/config", () => ({
  config: {},
  capabilities: () => ({
    documentIntelligence: false,
    chat: true,
    embeddings: false,
  }),
}));

vi.mock("@/lib/server/ai", () => ({
  chatJson: vi.fn(),
}));

import { chatJson } from "@/lib/server/ai";
import { analyzeJobDescription } from "@/lib/server/jd-analyzer";

const mockedChatJson = vi.mocked(chatJson);

describe("analyzeJobDescription (chat path)", () => {
  beforeEach(() => {
    mockedChatJson.mockReset();
  });

  it("uses the model's title/summary/requirements when they validate", async () => {
    mockedChatJson.mockResolvedValue({
      title: "Senior Backend Engineer",
      summary: "Screens for distributed systems engineers.",
      requirements: [
        {
          category: "Skills",
          text: "Kubernetes in production",
          must: true,
          keywords: ["kubernetes", "k8s"],
        },
        {
          category: "Experience",
          text: "5+ years backend engineering",
          must: true,
          keywords: ["backend"],
          minYears: 5,
        },
      ],
    });

    const job = await analyzeJobDescription("Some JD", "job-1");
    expect(job.analyzedBy).toBe("azure-openai");
    expect(job.title).toBe("Senior Backend Engineer");
    expect(job.requirements).toHaveLength(2);
    expect(job.requirements[0]?.category).toBe("Skills");
    expect(job.requirements[1]?.minYears).toBe(5);
  });

  it("falls back to the heuristic parser when the model returns nothing usable", async () => {
    mockedChatJson.mockResolvedValue({ title: "Junk", requirements: [] });

    const job = await analyzeJobDescription(
      "Backend Engineer\nRequirements:\n- Minimum 5+ years of backend engineering",
      "job-1",
    );
    expect(job.analyzedBy).toBe("heuristic");
    expect(job.title).toBe("Backend Engineer");
    expect(job.requirements.length).toBeGreaterThan(0);
    expect(mockedChatJson).toHaveBeenCalledTimes(1);
  });
});
