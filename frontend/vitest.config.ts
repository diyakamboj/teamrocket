import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "node:path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // Route files register themselves with the router on import; the units
    // under test here are plain components, so nothing needs a router.
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
