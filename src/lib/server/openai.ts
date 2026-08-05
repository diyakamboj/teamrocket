import { config } from "./config";

export class AzureOpenAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AzureOpenAIError";
  }
}

type ChatMessage = { role: "system" | "user"; content: string };

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

function deploymentUrl(deployment: string, path: string) {
  const { endpoint, apiVersion } = config.openai;
  return `${endpoint}/openai/deployments/${deployment}/${path}?api-version=${apiVersion}`;
}

/** Azure returns 429 with a Retry-After header under load; respect it a few times. */
async function requestWithRetry(url: string, body: unknown, attempts = 4): Promise<Response> {
  let lastError = "";

  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "api-key": config.openai.key!, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (response.ok) return response;

    const text = await response.text();
    lastError = `${response.status} ${response.statusText} — ${text.slice(0, 400)}`;

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === attempts - 1) {
      throw new AzureOpenAIError(lastError);
    }

    const retryAfter = Number(response.headers.get("retry-after"));
    const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1000;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  throw new AzureOpenAIError(lastError);
}

function extractJson(raw: string): unknown {
  const trimmed = raw.trim().replace(/^```(?:json)?/i, "").replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // Models occasionally wrap the object in prose — salvage the outermost braces.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new AzureOpenAIError(`Model did not return JSON: ${raw.slice(0, 200)}`);
    }
    return JSON.parse(trimmed.slice(start, end + 1));
  }
}

/**
 * Chat completion constrained to a JSON object. Prefers structured outputs and
 * degrades to json_object mode when the deployment/api-version rejects them.
 */
export async function chatJson(opts: {
  system: string;
  user: string;
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  temperature?: number;
}): Promise<unknown> {
  const { endpoint, key, chatDeployment } = config.openai;
  if (!endpoint || !key || !chatDeployment) {
    throw new AzureOpenAIError(
      "Azure OpenAI is not configured (set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT)",
    );
  }

  const url = deploymentUrl(chatDeployment, "chat/completions");
  const messages: ChatMessage[] = [
    { role: "system", content: opts.system },
    { role: "user", content: opts.user },
  ];
  const base = {
    messages,
    temperature: opts.temperature ?? 0,
    max_tokens: opts.maxTokens ?? 4000,
  };

  const attempts: unknown[] = [];
  if (opts.schema) {
    attempts.push({
      ...base,
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schema.name, strict: false, schema: opts.schema.schema },
      },
    });
  }
  attempts.push({ ...base, response_format: { type: "json_object" } });

  let lastError: unknown;
  for (const body of attempts) {
    try {
      const response = await requestWithRetry(url, body);
      const payload = (await response.json()) as ChatResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (!content) throw new AzureOpenAIError("Model returned an empty completion");
      return extractJson(content);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // A 400 here means the deployment can't do structured outputs — try plain JSON mode.
      if (!message.startsWith("400")) throw error;
    }
  }

  throw lastError instanceof Error ? lastError : new AzureOpenAIError(String(lastError));
}

/** Batched embeddings. Returns one vector per input, in order. */
export async function embed(inputs: string[]): Promise<number[][]> {
  const { endpoint, key, embeddingDeployment } = config.openai;
  if (!endpoint || !key || !embeddingDeployment) {
    throw new AzureOpenAIError("Azure OpenAI embeddings are not configured");
  }
  if (inputs.length === 0) return [];

  const url = deploymentUrl(embeddingDeployment, "embeddings");
  const vectors: number[][] = [];
  const BATCH = 16;

  for (let i = 0; i < inputs.length; i += BATCH) {
    const batch = inputs.slice(i, i + BATCH).map((text) => text.slice(0, 8000) || " ");
    const response = await requestWithRetry(url, { input: batch });
    const payload = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    const data = [...(payload.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== batch.length) {
      throw new AzureOpenAIError("Embedding response length did not match the request");
    }
    vectors.push(...data.map((d) => d.embedding));
  }

  return vectors;
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
