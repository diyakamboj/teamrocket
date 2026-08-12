/**
 * AI seam — the only module consumers import for chat/embeddings. The rest of
 * the server never names Azure directly; swapping the provider means swapping
 * the client factory here, not touching parsers, matching, or the copilot.
 */
import { config } from "../config";
import { AzureOpenAIChatClient } from "./chat";
import { AzureOpenAIEmbeddingClient } from "./embeddings";
import type { ChatClient, ChatRequest, EmbeddingClient } from "./types";

// Lazy singletons: like the store, one instance per process. Vite reloads server
// modules on edit, but the clients are stateless over the config object, so a
// duplicate instance would be harmless anyway.
let chat: ChatClient | undefined;
let embeddings: EmbeddingClient | undefined;

/**
 * Builds the chat client from the current config. Azure is the primary provider
 * (approved decision); an OpenAI-compatible client slots in here behind the same
 * interface.
 */
export function chatClient(): ChatClient {
  return (chat ??= new AzureOpenAIChatClient(config.openai));
}

export function embeddingClient(): EmbeddingClient {
  return (embeddings ??= new AzureOpenAIEmbeddingClient(config.openai));
}

/** Structured-output chat completion. Preserves the historical `chatJson` signature. */
export function chatJson(request: ChatRequest): Promise<unknown> {
  return chatClient().chatJson(request);
}

/** Batched embeddings. Preserves the historical `embed` signature. */
export function embed(inputs: string[]): Promise<number[][]> {
  return embeddingClient().embed(inputs);
}

export { AzureOpenAIError, extractJson } from "./azure";
export { cosineSimilarity } from "./embeddings";
export type {
  ChatClient,
  ChatRequest,
  EmbeddingClient,
  AzureOpenAIConfig,
} from "./types";
