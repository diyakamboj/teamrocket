import { createHash } from "node:crypto";
import { capabilities, config } from "./config";
import { analyzeDocument } from "./document-intelligence";
import { extractPdfText, looksLikeUsableText } from "./pdf-text";
import { parseResume } from "./resume-parser";
import { store } from "./store";
import { PROCESSING_STAGES, type ResumeRecord, type TextSource } from "@/lib/types";

/** Content hashes of files already ingested, so re-uploads are flagged. */
const hashes = new Map<string, string>();

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  tif: "image/tiff",
  tiff: "image/tiff",
  bmp: "image/bmp",
  heif: "image/heif",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  doc: "application/msword",
  txt: "text/plain",
  md: "text/plain",
};

function extensionOf(fileName: string) {
  return fileName.split(".").pop()?.toLowerCase() ?? "";
}

export type IncomingFile = { name: string; bytes: Uint8Array };

export function ingest(files: IncomingFile[]): ResumeRecord[] {
  const created: ResumeRecord[] = [];

  for (const file of files) {
    const id = store.nextId("r");
    const digest = createHash("sha256").update(file.bytes).digest("hex");
    const existingId = hashes.get(digest);
    const existing = existingId ? store.resume(existingId) : undefined;
    const oversized = file.bytes.byteLength > config.pipeline.maxFileBytes;

    const record: ResumeRecord = {
      id,
      fileName: file.name,
      fileSize: file.bytes.byteLength,
      stage: existing ? "duplicate" : oversized ? "failed" : "queued",
      progress: 0,
      uploadedAt: new Date().toISOString(),
      duplicateOf: existing?.fileName,
      error: oversized
        ? `File is larger than the ${Math.round(config.pipeline.maxFileBytes / 1024 / 1024)} MB limit`
        : undefined,
    };

    store.saveUpload(id, file.bytes);
    store.addResume(record);
    if (!existing && !oversized) hashes.set(digest, id);
    created.push(record);
  }

  void drain();
  return created;
}

export function retry(id: string) {
  const record = store.resume(id);
  if (!record) return;
  store.updateResume(id, { stage: "queued", progress: 0, error: undefined });
  void drain();
}

export function retryAllFailed() {
  for (const record of store.resumes()) {
    if (record.stage === "failed") {
      store.updateResume(record.id, { stage: "queued", progress: 0, error: undefined });
    }
  }
  void drain();
}

export function cancelRemaining() {
  for (const record of store.resumes()) {
    if (record.stage === "queued") store.updateResume(record.id, { stage: "skipped" });
  }
}

export function resolveDuplicate(id: string, action: "skip" | "replace") {
  const record = store.resume(id);
  if (!record || record.stage !== "duplicate") return;
  if (action === "skip") {
    store.updateResume(id, { stage: "skipped" });
    return;
  }
  store.updateResume(id, { stage: "queued", duplicateOf: undefined, progress: 0 });
  void drain();
}

export function clearAll() {
  hashes.clear();
  store.clearResumes();
}

/* --------------------------------- worker -------------------------------- */

let running = 0;
let draining = false;

async function drain() {
  if (draining) return;
  draining = true;
  try {
    while (true) {
      const next = store.resumes().find((r) => r.stage === "queued");
      if (!next || running >= config.pipeline.concurrency) break;

      running += 1;
      store.updateResume(next.id, { stage: "uploading", progress: 10 });
      void process(next.id).finally(() => {
        running -= 1;
        // Slot freed — pick up whatever is still queued.
        void drain();
      });
    }
  } finally {
    draining = false;
  }
}

async function process(id: string) {
  try {
    const bytes = store.readUpload(id);
    if (!bytes) throw new Error("Uploaded file is no longer available on disk");

    const record = store.resume(id);
    if (!record) return;

    const extension = extensionOf(record.fileName);
    const contentType = CONTENT_TYPES[extension] ?? "application/octet-stream";

    store.updateResume(id, { stage: "extracting", progress: 30 });
    const extraction = await extractText(id, bytes, extension, contentType);

    if (!extraction.text.trim()) {
      throw new Error(
        extraction.scanned
          ? "No text could be read from this document — it may be an empty scan"
          : "Document contained no readable text",
      );
    }

    store.updateResume(id, {
      stage: "parsing",
      progress: 70,
      textSource: extraction.source,
      textChars: extraction.text.length,
      pageCount: extraction.pageCount,
      scanned: extraction.scanned,
    });

    const { parsed, engine } = await parseResume(extraction.text);

    store.updateResume(id, {
      stage: "complete",
      progress: 100,
      parsed,
      parseEngine: engine,
      processedAt: new Date().toISOString(),
      error: undefined,
    });
  } catch (error) {
    store.updateResume(id, {
      stage: "failed",
      progress: 100,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function extractText(
  id: string,
  bytes: Uint8Array,
  extension: string,
  contentType: string,
): Promise<{ text: string; source: TextSource; pageCount?: number | undefined; scanned: boolean }> {
  if (extension === "txt" || extension === "md") {
    return {
      text: new TextDecoder().decode(bytes),
      source: "plain-text",
      pageCount: 1,
      scanned: false,
    };
  }

  // Cheap local pass first: it tells us whether the PDF has a text layer, which
  // is what "scanned document" means for the recruiter-facing status.
  const local = extension === "pdf" ? extractPdfText(bytes) : { text: "", pageCount: 0 };
  const hasTextLayer = looksLikeUsableText(local.text);

  if (capabilities().documentIntelligence) {
    if (!hasTextLayer) store.updateResume(id, { stage: "ocr", progress: 50 });
    const result = await analyzeDocument(bytes, contentType);
    return {
      text: result.content,
      source: "azure-document-intelligence",
      pageCount: result.pageCount || local.pageCount || undefined,
      scanned: !hasTextLayer,
    };
  }

  if (hasTextLayer) {
    return {
      text: local.text,
      source: "embedded-pdf-text",
      pageCount: local.pageCount || undefined,
      scanned: false,
    };
  }

  throw new Error(
    extension === "pdf"
      ? "This looks like a scanned PDF with no text layer. OCR requires Azure Document Intelligence — set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY."
      : `Reading .${extension} files requires Azure Document Intelligence — set AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT and AZURE_DOCUMENT_INTELLIGENCE_KEY.`,
  );
}

export function counts() {
  const result = {
    total: 0,
    queued: 0,
    processing: 0,
    completed: 0,
    failed: 0,
    duplicate: 0,
    skipped: 0,
  };
  for (const record of store.resumes()) {
    result.total += 1;
    if (record.stage === "queued") result.queued += 1;
    else if (PROCESSING_STAGES.includes(record.stage)) result.processing += 1;
    else if (record.stage === "complete") result.completed += 1;
    else if (record.stage === "failed") result.failed += 1;
    else if (record.stage === "duplicate") result.duplicate += 1;
    else if (record.stage === "skipped") result.skipped += 1;
  }
  return result;
}

/** Rebuilds the dedupe index after a restart, using what is still on disk. */
export function rehydrateHashes() {
  if (hashes.size > 0) return;
  for (const record of store.resumes()) {
    const bytes = store.readUpload(record.id);
    if (!bytes) continue;
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (!hashes.has(digest) && record.stage !== "duplicate") hashes.set(digest, record.id);
  }
}
