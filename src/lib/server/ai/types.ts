/**
 * The AI provider seam. Everything in the server talks to these interfaces,
 * never to Azure directly — so the provider is swappable (Azure today, an
 * OpenAI-compatible endpoint later) and testable with a fake client.
 */

/** Structured-output chat request, mirroring the old `chatJson` options. */
export type ChatRequest = {
  system: string;
  user: string;
  schema?: { name: string; schema: Record<string, unknown> };
  maxTokens?: number;
  temperature?: number;
};

export interface ChatClient {
  /** Chat completion constrained to a JSON object (structured output → json_object → salvage). */
  chatJson(request: ChatRequest): Promise<unknown>;
}

export interface EmbeddingClient {
  /** One vector per input, in order. */
  embed(inputs: string[]): Promise<number[][]>;
}

/** The Azure-specific config subset the clients need (from `config.openai`). */
export type AzureOpenAIConfig = {
  endpoint: string | undefined;
  key: string | undefined;
  apiVersion: string;
  chatDeployment: string | undefined;
  embeddingDeployment: string | undefined;
};
