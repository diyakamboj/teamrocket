/**
 * Azure OpenAI transport: deployment URL building, retry handling, and the
 * tolerant JSON extractor. Provider-specific plumbing shared by the chat and
 * embedding clients.
 */

export class AzureOpenAIError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AzureOpenAIError";
  }
}

type ChatResponse = {
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

function deploymentUrl(
  endpoint: string,
  apiVersion: string,
  deployment: string,
  path: string,
) {
  return `${endpoint}/openai/deployments/${deployment}/${path}?api-version=${apiVersion}`;
}

/** Azure returns 429 with a Retry-After header under load; respect it a few times. */
async function requestWithRetry(
  url: string,
  key: string,
  body: unknown,
  attempts = 4,
): Promise<Response> {
  let lastError = "";

  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers: { "api-key": key, "Content-Type": "application/json" },
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
    const wait =
      Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : 2 ** attempt * 1000;
    await new Promise((resolve) => setTimeout(resolve, wait));
  }

  throw new AzureOpenAIError(lastError);
}

export function extractJson(raw: string): unknown {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "");
  try {
    return JSON.parse(trimmed);
  } catch {
    // Models occasionally wrap the object in prose — salvage the outermost braces.
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start === -1 || end <= start) {
      throw new AzureOpenAIError(
        `Model did not return JSON: ${raw.slice(0, 200)}`,
      );
    }
    try {
      return JSON.parse(trimmed.slice(start, end + 1));
    } catch {
      // An unparseable salvage must surface as the typed error, not a raw
      // SyntaxError, so callers can catch and degrade predictably.
      throw new AzureOpenAIError(
        `Model did not return JSON: ${raw.slice(0, 200)}`,
      );
    }
  }
}

/** Chat completion constrained to a JSON object for one Azure deployment. */
export async function chatJson(
  cfg: {
    endpoint: string;
    apiVersion: string;
    deployment: string;
    key: string;
  },
  opts: {
    system: string;
    user: string;
    schema?: { name: string; schema: Record<string, unknown> };
    maxTokens?: number;
    temperature?: number;
  },
): Promise<unknown> {
  const url = deploymentUrl(
    cfg.endpoint,
    cfg.apiVersion,
    cfg.deployment,
    "chat/completions",
  );
  const messages: { role: "system" | "user"; content: string }[] = [
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
        json_schema: {
          name: opts.schema.name,
          strict: false,
          schema: opts.schema.schema,
        },
      },
    });
  }
  attempts.push({ ...base, response_format: { type: "json_object" } });

  let lastError: unknown;
  for (const body of attempts) {
    try {
      const response = await requestWithRetry(url, cfg.key, body);
      const payload = (await response.json()) as ChatResponse;
      const content = payload.choices?.[0]?.message?.content;
      if (!content)
        throw new AzureOpenAIError("Model returned an empty completion");
      return extractJson(content);
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      // A 400 here means the deployment can't do structured outputs — try plain JSON mode.
      if (!message.startsWith("400")) throw error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new AzureOpenAIError(String(lastError));
}

/** Batched embeddings for one Azure deployment. Returns one vector per input, in order. */
export async function embed(
  cfg: {
    endpoint: string;
    apiVersion: string;
    deployment: string;
    key: string;
  },
  inputs: string[],
): Promise<number[][]> {
  if (inputs.length === 0) return [];

  const url = deploymentUrl(
    cfg.endpoint,
    cfg.apiVersion,
    cfg.deployment,
    "embeddings",
  );
  const vectors: number[][] = [];
  const BATCH = 16;

  for (let i = 0; i < inputs.length; i += BATCH) {
    const batch = inputs
      .slice(i, i + BATCH)
      .map((text) => text.slice(0, 8000) || " ");
    const response = await requestWithRetry(url, cfg.key, { input: batch });
    const payload = (await response.json()) as {
      data?: { embedding: number[]; index: number }[];
    };
    const data = [...(payload.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== batch.length) {
      throw new AzureOpenAIError(
        "Embedding response length did not match the request",
      );
    }
    vectors.push(...data.map((d) => d.embedding));
  }

  return vectors;
}
