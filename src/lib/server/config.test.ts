import { describe, expect, it, vi } from "vitest";

// config.ts computes its singleton at module load from process.env, so force the
// unconfigured state before the dynamic import below evaluates it. `unstubEnvs`
// (vitest.config.ts) restores the real env afterwards.
vi.stubEnv("AZURE_OPENAI_ENDPOINT", "");
vi.stubEnv("AZURE_OPENAI_API_KEY", "");
vi.stubEnv("AZURE_OPENAI_DEPLOYMENT", "");
vi.stubEnv("AZURE_OPENAI_EMBEDDING_DEPLOYMENT", "");
vi.stubEnv("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT", "");
vi.stubEnv("AZURE_DOCUMENT_INTELLIGENCE_KEY", "");

const { capabilities } = await import("@/lib/server/config");

describe("config capabilities", () => {
  it("reports no cloud capabilities when unconfigured (offline mode)", () => {
    expect(capabilities()).toEqual({
      documentIntelligence: false,
      chat: false,
      embeddings: false,
    });
  });
});
