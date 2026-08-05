import { createServerFn } from "@tanstack/react-start";
import type { AzureCapabilities, ResumeRecord } from "@/lib/types";

export type ResumeCounts = {
  total: number;
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  duplicate: number;
  skipped: number;
};

export type ResumesSnapshot = {
  resumes: ResumeRecord[];
  counts: ResumeCounts;
  capabilities: AzureCapabilities;
};

/**
 * `@/lib/server` is imported dynamically *inside* every handler on purpose: the
 * compiler replaces handler bodies with an RPC stub in the client build, so the
 * Node-only modules never enter the browser graph. A shared top-level helper
 * would defeat that — the import-protection plugin rejects it.
 */

export const listResumes = createServerFn({ method: "GET" }).handler(
  async (): Promise<ResumesSnapshot> => {
    const be = await import("@/lib/server");
    be.rehydrateHashes();
    return {
      resumes: [...be.store.resumes()].sort((a, b) => a.uploadedAt.localeCompare(b.uploadedAt)),
      counts: be.counts(),
      capabilities: be.capabilities(),
    };
  },
);

export const uploadResumes = createServerFn({ method: "POST" })
  .validator((data: FormData) => {
    if (!(data instanceof FormData)) throw new Error("Expected multipart form data");
    return data;
  })
  .handler(async ({ data }): Promise<ResumesSnapshot> => {
    const be = await import("@/lib/server");
    be.rehydrateHashes();

    const incoming: { name: string; bytes: Uint8Array }[] = [];
    for (const entry of data.getAll("files")) {
      if (typeof entry === "string") continue;
      incoming.push({
        name: entry.name || "resume.pdf",
        bytes: new Uint8Array(await entry.arrayBuffer()),
      });
    }

    if (incoming.length) be.ingest(incoming);

    return {
      resumes: [...be.store.resumes()],
      counts: be.counts(),
      capabilities: be.capabilities(),
    };
  });

export const retryResume = createServerFn({ method: "POST" })
  .validator((data: { id: string }) => data)
  .handler(async ({ data }) => {
    const be = await import("@/lib/server");
    be.retry(data.id);
    return { ok: true };
  });

export const retryFailedResumes = createServerFn({ method: "POST" }).handler(async () => {
  const be = await import("@/lib/server");
  be.retryAllFailed();
  return { ok: true };
});

export const cancelQueuedResumes = createServerFn({ method: "POST" }).handler(async () => {
  const be = await import("@/lib/server");
  be.cancelRemaining();
  return { ok: true };
});

export const resolveDuplicateResume = createServerFn({ method: "POST" })
  .validator((data: { id: string; action: "skip" | "replace" }) => data)
  .handler(async ({ data }) => {
    const be = await import("@/lib/server");
    be.resolveDuplicate(data.id, data.action);
    return { ok: true };
  });

export const clearResumes = createServerFn({ method: "POST" }).handler(async () => {
  const be = await import("@/lib/server");
  be.clearAll();
  return { ok: true };
});
