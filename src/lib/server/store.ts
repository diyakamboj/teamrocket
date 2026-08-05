import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { config } from "./config";
import type { JobRecord, MatchRecord, ResumeRecord, ScreeningRun } from "@/lib/types";

type Database = {
  resumes: ResumeRecord[];
  jobs: JobRecord[];
  /** jobId -> resumeId -> match */
  matches: Record<string, Record<string, MatchRecord>>;
  runs: Record<string, ScreeningRun>;
  activeJobId?: string;
  seq: number;
};

const EMPTY: Database = { resumes: [], jobs: [], matches: {}, runs: {}, seq: 0 };

const dataDir = resolve(process.cwd(), config.dataDir);
const dbPath = join(dataDir, "store.json");
const uploadsDir = join(dataDir, "uploads");
const embeddingsPath = join(dataDir, "embeddings.json");

// Vite reloads server modules on edit; keep one store instance across reloads so
// in-flight uploads and the write timer aren't duplicated.
const globalKey = Symbol.for("resumeiq.store");
type Holder = { db: Database; embeddings: Map<string, number[]>; timer?: NodeJS.Timeout | undefined };
const holder: Holder = ((globalThis as Record<symbol, unknown>)[globalKey] as Holder) ?? {
  db: load(),
  embeddings: loadEmbeddings(),
};
(globalThis as Record<symbol, unknown>)[globalKey] = holder;

function load(): Database {
  try {
    mkdirSync(uploadsDir, { recursive: true });
    const parsed = JSON.parse(readFileSync(dbPath, "utf8")) as Partial<Database>;
    return {
      ...EMPTY,
      ...parsed,
      resumes: parsed.resumes ?? [],
      jobs: parsed.jobs ?? [],
      matches: parsed.matches ?? {},
      runs: parsed.runs ?? {},
    };
  } catch {
    return structuredClone(EMPTY);
  }
}

function loadEmbeddings(): Map<string, number[]> {
  try {
    const parsed = JSON.parse(readFileSync(embeddingsPath, "utf8")) as Record<string, number[]>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function writeAtomic(path: string, contents: string) {
  mkdirSync(dataDir, { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, contents, "utf8");
  renameSync(tmp, path);
}

/** Coalesces the many small mutations the pipeline makes into one write. */
function schedulePersist() {
  if (holder.timer) return;
  holder.timer = setTimeout(() => {
    holder.timer = undefined;
    try {
      writeAtomic(dbPath, JSON.stringify(holder.db));
      writeAtomic(embeddingsPath, JSON.stringify(Object.fromEntries(holder.embeddings)));
    } catch (error) {
      console.error("[store] failed to persist:", error);
    }
  }, 400);
  holder.timer.unref?.();
}

export const store = {
  nextId(prefix: string) {
    holder.db.seq += 1;
    schedulePersist();
    return `${prefix}-${holder.db.seq.toString(36)}${Date.now().toString(36).slice(-4)}`;
  },

  resumes(): ResumeRecord[] {
    return holder.db.resumes;
  },

  resume(id: string): ResumeRecord | undefined {
    return holder.db.resumes.find((r) => r.id === id);
  },

  addResume(record: ResumeRecord) {
    holder.db.resumes.push(record);
    schedulePersist();
  },

  updateResume(id: string, patch: Partial<ResumeRecord>) {
    const record = store.resume(id);
    if (!record) return undefined;
    Object.assign(record, patch);
    schedulePersist();
    return record;
  },

  removeResume(id: string) {
    holder.db.resumes = holder.db.resumes.filter((r) => r.id !== id);
    for (const byResume of Object.values(holder.db.matches)) delete byResume[id];
    try {
      rmSync(uploadPath(id), { force: true });
    } catch {
      // The blob may already be gone; the record removal is what matters.
    }
    schedulePersist();
  },

  clearResumes() {
    for (const record of [...holder.db.resumes]) store.removeResume(record.id);
    holder.db.matches = {};
    holder.db.runs = {};
    schedulePersist();
  },

  jobs(): JobRecord[] {
    return holder.db.jobs;
  },

  job(id: string): JobRecord | undefined {
    return holder.db.jobs.find((j) => j.id === id);
  },

  activeJob(): JobRecord | undefined {
    const active = holder.db.activeJobId ? store.job(holder.db.activeJobId) : undefined;
    return active ?? holder.db.jobs.at(-1);
  },

  saveJob(job: JobRecord) {
    const index = holder.db.jobs.findIndex((j) => j.id === job.id);
    if (index === -1) holder.db.jobs.push(job);
    else holder.db.jobs[index] = job;
    holder.db.activeJobId = job.id;
    schedulePersist();
    return job;
  },

  matches(jobId: string): Record<string, MatchRecord> {
    return (holder.db.matches[jobId] ??= {});
  },

  saveMatch(match: MatchRecord) {
    store.matches(match.jobId)[match.resumeId] = match;
    schedulePersist();
  },

  clearMatches(jobId: string) {
    holder.db.matches[jobId] = {};
    schedulePersist();
  },

  run(jobId: string): ScreeningRun | undefined {
    return holder.db.runs[jobId];
  },

  saveRun(run: ScreeningRun) {
    holder.db.runs[run.jobId] = run;
    schedulePersist();
  },

  embedding(key: string): number[] | undefined {
    return holder.embeddings.get(key);
  },

  saveEmbedding(key: string, vector: number[]) {
    holder.embeddings.set(key, vector);
    schedulePersist();
  },
};

export function uploadPath(id: string) {
  return join(uploadsDir, `${id}.bin`);
}

export function saveUpload(id: string, bytes: Uint8Array) {
  mkdirSync(uploadsDir, { recursive: true });
  writeFileSync(uploadPath(id), bytes);
}

export function readUpload(id: string): Uint8Array | undefined {
  const path = uploadPath(id);
  return existsSync(path) ? new Uint8Array(readFileSync(path)) : undefined;
}
