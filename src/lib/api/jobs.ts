import { createServerFn } from "@tanstack/react-start";
import { copilotRequestSchema, explainRequestSchema } from "@/lib/validation";
import type {
  AzureCapabilities,
  Candidate,
  CopilotRequest,
  CopilotResponse,
  ExplainResponse,
  JobRecord,
  Requirement,
  ScreeningRun,
} from "@/lib/types";

export type JobSnapshot = {
  job: JobRecord | null;
  run: ScreeningRun | null;
  capabilities: AzureCapabilities;
  /** Completed resumes available to screen against this job. */
  poolSize: number;
};

export type CandidatesSnapshot = JobSnapshot & { candidates: Candidate[] };

/** What `loadDemo` actually seeded — used for the success toast. */
export type DemoSnapshot = {
  jobTitle: string;
  resumes: number;
  screened: number;
};

/**
 * `@/lib/server` is imported dynamically *inside* every handler on purpose: the
 * compiler replaces handler bodies with an RPC stub in the client build, so the
 * Node-only modules never enter the browser graph. A shared top-level helper
 * would defeat that — the import-protection plugin rejects it.
 */
type Backend = typeof import("@/lib/server");

function toSnapshot(be: Backend, job: JobRecord | null): JobSnapshot {
  return {
    job,
    run: job ? (be.store.run(job.id) ?? null) : null,
    capabilities: be.capabilities(),
    poolSize: be.store
      .resumes()
      .filter((r) => r.stage === "complete" && r.parsed).length,
  };
}

export const getJob = createServerFn({ method: "GET" }).handler(
  async (): Promise<JobSnapshot> => {
    const be = await import("@/lib/server");
    return toSnapshot(be, be.store.activeJob() ?? null);
  },
);

export const analyzeJob = createServerFn({ method: "POST" })
  .validator((data: { description: string }) => data)
  .handler(async ({ data }): Promise<JobSnapshot> => {
    const description = data.description.trim();
    if (!description) throw new Error("Paste a job description first");

    const be = await import("@/lib/server");
    const job = await be.analyzeJobDescription(
      description,
      be.store.nextId("job"),
    );
    be.store.saveJob(job);
    // Requirements changed — any previous ranking for this job is stale.
    be.store.clearMatches(job.id);
    return toSnapshot(be, job);
  });

export const saveJobRequirements = createServerFn({ method: "POST" })
  .validator(
    (data: { jobId: string; title?: string; requirements: Requirement[] }) =>
      data,
  )
  .handler(async ({ data }): Promise<JobSnapshot> => {
    const be = await import("@/lib/server");
    const job = be.store.job(data.jobId);
    if (!job) throw new Error("Job not found — analyze a description first");

    const updated: JobRecord = {
      ...job,
      title: data.title?.trim() || job.title,
      requirements: data.requirements
        .filter((r) => r.text.trim())
        .map((r, index) => ({
          ...r,
          id: r.id || `${job.id}-req-${Date.now()}-${index}`,
          text: r.text.trim(),
          keywords: r.keywords?.length
            ? r.keywords
            : deriveFallbackKeywords(r.text),
        })),
      reviewed: true,
      updatedAt: new Date().toISOString(),
    };

    be.store.saveJob(updated);
    be.store.clearMatches(updated.id);
    return toSnapshot(be, updated);
  });

export const startScreening = createServerFn({ method: "POST" })
  .validator((data: { jobId: string }) => data)
  .handler(async ({ data }): Promise<JobSnapshot> => {
    const be = await import("@/lib/server");
    const job = be.store.job(data.jobId);
    if (!job) throw new Error("Job not found — analyze a description first");

    await be.runScreening(job);
    return toSnapshot(be, job);
  });

export const listCandidates = createServerFn({ method: "GET" }).handler(
  async (): Promise<CandidatesSnapshot> => {
    const be = await import("@/lib/server");
    const job = be.store.activeJob() ?? null;
    return {
      ...toSnapshot(be, job),
      candidates: job ? be.candidatesFor(job.id) : [],
    };
  },
);

/**
 * Seeds the store with a self-contained demo batch through the real offline
 * pipeline (`loadDemoData` in `server/demo.ts`) — no uploads, no Azure. Backs
 * the "Try the demo" actions behind the empty states.
 */
export const loadDemo = createServerFn({ method: "POST" }).handler(
  async (): Promise<DemoSnapshot> => {
    const be = await import("@/lib/server");
    return be.loadDemoData();
  },
);

/**
 * Per-candidate evidence trace — the explainable-scoring endpoint (P4/P5).
 * Returns the stored match's score explanation, verdicts and citable evidence
 * without re-running any pipeline. The request is validated against the frozen
 * `explainRequestSchema` before the store is touched.
 */
export const explainCandidate = createServerFn({ method: "POST" })
  .validator((data: { candidateId: string; jobId: string }) =>
    explainRequestSchema.parse(data),
  )
  .handler(async ({ data }): Promise<ExplainResponse> => {
    const be = await import("@/lib/server");
    const match = be.store.matches(data.jobId)[data.candidateId];
    if (!match)
      throw new Error(
        "No screening result for this candidate — run screening first",
      );
    return {
      candidateId: match.resumeId,
      jobId: match.jobId,
      score: match.score,
      requirements: match.requirements,
      evidence: match.evidence,
      strengths: match.strengths,
      gaps: match.gaps,
      transferable: match.transferable,
      summary: match.summary,
    };
  });

/** Mirrors the server-side keyword derivation for requirements added by hand. */
function deriveFallbackKeywords(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .match(/[a-z][a-z0-9+#./-]{2,}/g)
        ?.filter(
          (t) =>
            !["and", "the", "with", "for", "years", "experience"].includes(t),
        ) ?? [],
    ),
  ].slice(0, 8);
}

/**
 * Recruiter copilot — a bounded tool-using agent over the scored pool.
 * The request is validated against the frozen `copilotRequestSchema`; the answer
 * comes back with citations resolved server-side against stored evidence, so the
 * model can never assert a fact it wasn't shown (no-fabrication discipline).
 */
export const copilotAsk = createServerFn({ method: "POST" })
  .validator((data: CopilotRequest) => copilotRequestSchema.parse(data))
  .handler(async ({ data }): Promise<CopilotResponse> => {
    const be = await import("@/lib/server");
    return be.copilotAnswer(data);
  });
