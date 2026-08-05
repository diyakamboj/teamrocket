import { config } from "./config";

export type AnalyzeResult = {
  content: string;
  pageCount: number;
  /** Mean word confidence reported by OCR; undefined for born-digital text layers. */
  confidence?: number | undefined;
};

type OperationBody = {
  status?: string;
  error?: { message?: string; code?: string };
  analyzeResult?: {
    content?: string;
    pages?: { words?: { confidence?: number }[] }[];
  };
};

class DocumentIntelligenceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocumentIntelligenceError";
  }
}

/** Newer resources serve /documentintelligence; classic ones only /formrecognizer. */
function analyzeUrls(model: string, apiVersion: string) {
  const base = config.documentIntelligence.endpoint!;
  const query = `?api-version=${apiVersion}`;
  return [
    `${base}/documentintelligence/documentModels/${model}:analyze${query}`,
    `${base}/formrecognizer/documentModels/${model}:analyze${query}`,
  ];
}

async function submit(bytes: Uint8Array, contentType: string): Promise<string> {
  const { key, model, apiVersion } = config.documentIntelligence;
  let lastError = "";

  for (const url of analyzeUrls(model, apiVersion)) {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Ocp-Apim-Subscription-Key": key!,
        "Content-Type": contentType,
      },
      body: bytes as unknown as BodyInit,
    });

    if (response.status === 202) {
      const operation = response.headers.get("operation-location");
      if (!operation) throw new DocumentIntelligenceError("Analyze accepted without an operation URL");
      return operation;
    }

    const body = await response.text();
    lastError = `${response.status} ${response.statusText} — ${body.slice(0, 400)}`;
    // Only a missing route is worth retrying on the legacy path.
    if (response.status !== 404) break;
  }

  throw new DocumentIntelligenceError(`Azure Document Intelligence rejected the file: ${lastError}`);
}

async function poll(operationUrl: string): Promise<OperationBody> {
  const { key } = config.documentIntelligence;
  const deadline = Date.now() + 3 * 60_000;
  let delay = 800;

  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, delay));
    delay = Math.min(delay * 1.4, 5_000);

    const response = await fetch(operationUrl, {
      headers: { "Ocp-Apim-Subscription-Key": key! },
    });
    if (response.status === 429) continue;
    if (!response.ok) {
      throw new DocumentIntelligenceError(
        `Polling failed: ${response.status} ${await response.text().then((t) => t.slice(0, 200))}`,
      );
    }

    const body = (await response.json()) as OperationBody;
    const status = body.status?.toLowerCase();
    if (status === "succeeded") return body;
    if (status === "failed") {
      throw new DocumentIntelligenceError(body.error?.message ?? "Analysis failed");
    }
  }

  throw new DocumentIntelligenceError("Analysis timed out after 3 minutes");
}

/**
 * Runs the document through Azure AI Document Intelligence. `prebuilt-read`
 * transparently OCRs scanned pages, so this is the path scanned resumes take.
 */
export async function analyzeDocument(
  bytes: Uint8Array,
  contentType: string,
): Promise<AnalyzeResult> {
  const { endpoint, key } = config.documentIntelligence;
  if (!endpoint || !key) {
    throw new DocumentIntelligenceError(
      "Azure Document Intelligence is not configured (set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY)",
    );
  }

  const operationUrl = await submit(bytes, contentType);
  const body = await poll(operationUrl);
  const pages = body.analyzeResult?.pages ?? [];
  const confidences = pages.flatMap((p) => (p.words ?? []).map((w) => w.confidence ?? 0));

  return {
    content: body.analyzeResult?.content ?? "",
    pageCount: pages.length,
    confidence: confidences.length
      ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
      : undefined,
  };
}
