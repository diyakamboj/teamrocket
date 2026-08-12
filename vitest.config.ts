import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Match the `@/*` → `src/*` alias in tsconfig.json so server code and the
    // shared `validation.ts`/`types.ts` resolve the same way under Vitest.
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Tests stub process.env (via vi.stubEnv) so capabilities() is
    // deterministic regardless of the developer's shell — restore after each.
    unstubEnvs: true,
  },
});
