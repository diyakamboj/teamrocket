import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { tanstackRouter } from "@tanstack/router-plugin/vite";

// Plain client-only SPA build — no TanStack Start, no Nitro. This app has no
// server-side data-loading (no createServerFn, no route loaders; every fetch
// goes client-side through src/lib/api.ts to the FastAPI backend), so the
// SSR/deploy-adapter layer TanStack Start provides was unused complexity.
// `vite build` now produces a plain static `dist/` — matching
// infra/terraform/storage.tf's Azure Storage static website hosting and
// azure-pipelines.yml's existing `frontend/dist` deploy step directly.
export default defineConfig({
  plugins: [
    tanstackRouter({ target: "react", autoCodeSplitting: true }),
    react(),
    tailwindcss(),
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
  ],
  server: {
    host: "::",
    port: 8080,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
});
