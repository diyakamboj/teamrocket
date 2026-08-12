import { chatJson as azureChatJson, AzureOpenAIError } from "./azure";
import type { AzureOpenAIConfig, ChatClient, ChatRequest } from "./types";

/**
 * Azure OpenAI chat client. Holds the config at construction so callers select
 * it through the seam (`ai/index.ts`) rather than importing Azure directly.
 * The config guard (missing deployment) throws the same error the old `chatJson`
 * did, so parsers keep their graceful-degradation behavior.
 */
export class AzureOpenAIChatClient implements ChatClient {
  constructor(private readonly cfg: AzureOpenAIConfig) {}

  async chatJson(request: ChatRequest): Promise<unknown> {
    const { endpoint, key, chatDeployment, apiVersion } = this.cfg;
    if (!endpoint || !key || !chatDeployment) {
      throw new AzureOpenAIError(
        "Azure OpenAI is not configured (set AZURE_OPENAI_ENDPOINT, AZURE_OPENAI_API_KEY and AZURE_OPENAI_DEPLOYMENT)",
      );
    }
    return azureChatJson(
      { endpoint, apiVersion, deployment: chatDeployment, key },
      request,
    );
  }
}
