import { beforeEach, describe, expect, it, vi } from "vitest";

// Exercise the Azure OpenAI parse path without a network call: mock the
// capability gate (chat on) and the chat seam. Everything downstream — coercion,
// schema validation, backfill, fallback — runs for real.
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
import { heuristicParse, parseResume } from "@/lib/server/resume-parser";

const mockedChatJson = vi.mocked(chatJson);

describe("parseResume (chat path)", () => {
  beforeEach(() => {
    mockedChatJson.mockReset();
  });

  it("validates well-formed model output into the frozen shape", async () => {
    mockedChatJson.mockResolvedValue({
      name: "Jane Doe",
      email: "jane.doe@example.com",
      skills: [
        { name: "React", evidence: "built the dashboard" },
        { name: "" }, // empty names dropped by coercion
        "plain string", // non-object entries dropped
      ],
      experience: [
        {
          company: "Acme Corp",
          title: "Senior Engineer",
          highlights: ["Led the team"],
        },
      ],
      education: [],
      certifications: [],
      projects: [],
    });

    const { parsed, engine } = await parseResume("ignored in this test");
    expect(engine).toBe("azure-openai");
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.skills).toEqual([
      { name: "React", evidence: "built the dashboard" },
    ]);
    expect(parsed.experience[0]?.company).toBe("Acme Corp");
  });

  it("falls back to the heuristic parser when the model returns nothing usable", async () => {
    mockedChatJson.mockResolvedValue({ name: "Junk" }); // no skills or experience

    const { parsed, engine } = await parseResume(
      "Jane Doe\nSKILLS\nReact, TypeScript",
    );
    expect(engine).toBe("heuristic");
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.skills.some((s) => s.name === "React")).toBe(true);
    expect(mockedChatJson).toHaveBeenCalledTimes(1);
  });
});
