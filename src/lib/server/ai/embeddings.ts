import { embed as azureEmbed, AzureOpenAIError } from "./azure";
import type { AzureOpenAIConfig, EmbeddingClient } from "./types";

/**
 * Azure OpenAI embeddings client. The embedding cache lives in the store, not
 * here — this seam only talks to the network so it stays trivially testable.
 */
export class AzureOpenAIEmbeddingClient implements EmbeddingClient {
  constructor(private readonly cfg: AzureOpenAIConfig) {}

  async embed(inputs: string[]): Promise<number[][]> {
    const { endpoint, key, embeddingDeployment, apiVersion } = this.cfg;
    if (!endpoint || !key || !embeddingDeployment) {
      throw new AzureOpenAIError("Azure OpenAI embeddings are not configured");
    }
    return azureEmbed(
      { endpoint, apiVersion, deployment: embeddingDeployment, key },
      inputs,
    );
  }
}

/** Cosine similarity between two equal-length vectors (provider-agnostic). */
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
