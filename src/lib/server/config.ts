import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AzureCapabilities } from "@/lib/types";

/**
 * Vite only exposes VITE_-prefixed variables, and only to `import.meta.env`.
 * These are server-side secrets, so load the .env files into process.env here.
 * Real environment variables always win over file contents.
 */
function loadDotEnv() {
  for (const file of [".env", ".env.local"]) {
    let contents: string;
    try {
      contents = readFileSync(resolve(process.cwd(), file), "utf8");
    } catch {
      continue;
    }

    for (const line of contents.split("\n")) {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (!match) continue;
      const [, key, rawValue] = match;
      if (process.env[key!] !== undefined) continue;

      let value = rawValue!.trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      } else {
        value = value.split(" #")[0]!.trim();
      }
      process.env[key!] = value;
    }
  }
}

loadDotEnv();

function env(name: string): string | undefined {
  const value = process.env[name];
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function num(name: string, fallback: number): number {
  const parsed = Number(env(name));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Strips a trailing slash so we can always join with a leading-slash path. */
function endpoint(name: string): string | undefined {
  return env(name)?.replace(/\/+$/, "");
}

export const config = {
  documentIntelligence: {
    endpoint: endpoint("AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT"),
    key: env("AZURE_DOCUMENT_INTELLIGENCE_KEY"),
    // 2024-11-30 is the GA version that serves /documentintelligence/*. Older
    // resources only expose /formrecognizer/* — analyze() falls back on 404.
    apiVersion: env("AZURE_DOCUMENT_INTELLIGENCE_API_VERSION") ?? "2024-11-30",
    model: env("AZURE_DOCUMENT_INTELLIGENCE_MODEL") ?? "prebuilt-read",
  },
  openai: {
    endpoint: endpoint("AZURE_OPENAI_ENDPOINT"),
    key: env("AZURE_OPENAI_API_KEY"),
    apiVersion: env("AZURE_OPENAI_API_VERSION") ?? "2024-10-21",
    chatDeployment: env("AZURE_OPENAI_DEPLOYMENT"),
    embeddingDeployment: env("AZURE_OPENAI_EMBEDDING_DEPLOYMENT"),
  },
  pipeline: {
    /** Documents processed at the same time. Azure S0 tiers throttle hard above ~5. */
    concurrency: num("RESUME_PIPELINE_CONCURRENCY", 4),
    maxFileBytes: num("RESUME_MAX_FILE_BYTES", 20 * 1024 * 1024),
  },
  scoring: {
    /** Candidates that get the expensive per-candidate LLM analysis, best-first. */
    aiAnalysisLimit: num("SCREENING_AI_ANALYSIS_LIMIT", 50),
    concurrency: num("SCREENING_CONCURRENCY", 4),
  },
  dataDir: env("RESUMEIQ_DATA_DIR") ?? ".data",
} as const;

export function capabilities(): AzureCapabilities {
  const { documentIntelligence: di, openai } = config;
  return {
    documentIntelligence: Boolean(di.endpoint && di.key),
    chat: Boolean(openai.endpoint && openai.key && openai.chatDeployment),
    embeddings: Boolean(openai.endpoint && openai.key && openai.embeddingDeployment),
  };
}
