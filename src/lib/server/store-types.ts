import type {
  JobRecord,
  MatchRecord,
  ResumeRecord,
  ScreeningRun,
} from "@/lib/types";

/**
 * The persistence seam. Everything the pipeline, screening, and API layers read
 * or write goes through this interface — swap the JSON-file implementation for
 * Cosmos DB + Blob Storage without touching callers (deployment.md §7).
 */
export interface Store {
  nextId(prefix: string): string;

  resumes(): ResumeRecord[];
  resume(id: string): ResumeRecord | undefined;
  addResume(record: ResumeRecord): void;
  updateResume(
    id: string,
    patch: Partial<ResumeRecord>,
  ): ResumeRecord | undefined;
  removeResume(id: string): void;
  clearResumes(): void;
  /**
   * Full demo/dev reset — removes every resume, job, match and run so demo data
   * can replace whatever was loaded without leaving stale uploads around.
   */
  resetAll(): void;

  jobs(): JobRecord[];
  job(id: string): JobRecord | undefined;
  activeJob(): JobRecord | undefined;
  saveJob(job: JobRecord): JobRecord;

  matches(jobId: string): Record<string, MatchRecord>;
  saveMatch(match: MatchRecord): void;
  clearMatches(jobId: string): void;

  run(jobId: string): ScreeningRun | undefined;
  saveRun(run: ScreeningRun): void;

  /** Disk-cached embedding vectors, keyed by the text hash (matching.ts). */
  embedding(key: string): number[] | undefined;
  saveEmbedding(key: string, vector: number[]): void;

  /** Raw resume file bytes (the "blob" half of the store). */
  saveUpload(id: string, bytes: Uint8Array): void;
  readUpload(id: string): Uint8Array | undefined;
}
