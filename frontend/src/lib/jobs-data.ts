import { CANDIDATES, DEFAULT_WEIGHTS, rankCandidates, type Candidate } from "@/lib/mock-data";

/**
 * Candidates carry a `score` only after being run through rankCandidates()
 * (raw CANDIDATES entries default to score: 0). Pipeline summaries need a
 * meaningful score, so default to a pool ranked with DEFAULT_WEIGHTS; pass a
 * pool already ranked with the recruiter's live weights when available
 * (e.g. from useAppState().weights) for an up-to-date average.
 */
const DEFAULT_RANKED_POOL = rankCandidates(CANDIDATES, DEFAULT_WEIGHTS);

/**
 * Synthetic "Active Jobs" data layer for the Recruiter Dashboard.
 *
 * There is no real per-job candidate roster in this app today — every job is
 * scored against the same shared candidate pool (see mock-data.ts). Rather
 * than inventing a fake job<->candidate relationship, this module derives a
 * deterministic, per-(job, candidate) "pipeline stage" the same way the real
 * backend's Evaluation table would (one row per candidate_id + job_id pair),
 * just computed on the client with a seeded hash instead of persisted in a
 * database. Same job + same candidate always yields the same stage/membership
 * on every render — nothing here uses Math.random().
 */

export type JobStatus = "open" | "interviewing" | "offer_stage" | "on_hold" | "closed";

export type Job = {
  id: string;
  title: string;
  department: string;
  location: string;
  level: "Junior" | "Mid" | "Senior" | "Lead";
  status: JobStatus;
  postedDaysAgo: number;
  hiringManager: string;
  remote: boolean;
  summary: string;
};

export const JOB_STATUS_LABEL: Record<JobStatus, string> = {
  open: "Open",
  interviewing: "Interviewing",
  offer_stage: "Offer stage",
  on_hold: "On hold",
  closed: "Closed",
};

export const JOBS: Job[] = [
  {
    id: "job-backend-eng",
    title: "Backend Engineer",
    department: "Platform",
    location: "Berlin",
    level: "Senior",
    status: "interviewing",
    postedDaysAgo: 18,
    hiringManager: "Priya Sharma",
    remote: true,
    summary: "Own core service reliability and the Python/SQL/Azure backend stack.",
  },
  {
    id: "job-data-eng",
    title: "Data Engineer",
    department: "Data",
    location: "Austin",
    level: "Mid",
    status: "open",
    postedDaysAgo: 6,
    hiringManager: "Diego Ferreira",
    remote: true,
    summary: "Build and operate the batch + streaming pipelines feeding analytics.",
  },
  {
    id: "job-ml-eng",
    title: "ML Engineer",
    department: "AI Research",
    location: "Toronto",
    level: "Senior",
    status: "offer_stage",
    postedDaysAgo: 41,
    hiringManager: "Lena Bergman",
    remote: false,
    summary: "Ship production ML services from prototype to scale.",
  },
  {
    id: "job-cloud-architect",
    title: "Cloud Architect",
    department: "Infrastructure",
    location: "Amsterdam",
    level: "Lead",
    status: "on_hold",
    postedDaysAgo: 63,
    hiringManager: "Nadia Haddad",
    remote: true,
    summary: "Define the multi-region Azure architecture for the next platform generation.",
  },
  {
    id: "job-fullstack-eng",
    title: "Full-Stack Engineer",
    department: "Product",
    location: "Dublin",
    level: "Mid",
    status: "open",
    postedDaysAgo: 3,
    hiringManager: "Marek Novak",
    remote: true,
    summary: "Build customer-facing product features across the React/Python stack.",
  },
  {
    id: "job-devops-eng",
    title: "DevOps Engineer",
    department: "Platform",
    location: "Warsaw",
    level: "Mid",
    status: "interviewing",
    postedDaysAgo: 25,
    hiringManager: "Sofia Castellano",
    remote: true,
    summary: "Harden CI/CD and observability across every service team.",
  },
  {
    id: "job-sre",
    title: "Site Reliability Engineer",
    department: "Platform",
    location: "Bengaluru",
    level: "Senior",
    status: "closed",
    postedDaysAgo: 92,
    hiringManager: "Ravi Iyer",
    remote: false,
    summary: "Closed — role filled last quarter. Kept for historical pipeline reference.",
  },
];

export function getJob(id: string | null | undefined): Job | undefined {
  if (!id) return undefined;
  return JOBS.find((j) => j.id === id);
}

/** Mirrors the private hashSeed() helper in lib/fraud-data.ts. */
function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export const PIPELINE_STAGES = [
  "new",
  "screening",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;

export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_STAGE_LABEL: Record<PipelineStage, string> = {
  new: "New",
  screening: "Screening",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

/** Deterministic 15–49% of the pool "belongs" to a given job's pipeline. */
function membershipThreshold(jobId: string): number {
  const seed = hashSeed(`${jobId}:membership`);
  return 0.15 + (seed % 35) / 100;
}

export function isInPipeline(jobId: string, candidateId: string): boolean {
  const seed = hashSeed(`${jobId}:${candidateId}:member`);
  return (seed % 100) / 100 < membershipThreshold(jobId);
}

/**
 * Weighted funnel distribution: most of a pipeline should still be "new" or
 * "screening", tapering off toward hired/rejected — mirrors a realistic
 * in-flight hiring funnel rather than a flat random split.
 */
const STAGE_WEIGHTS: Record<PipelineStage, number> = {
  new: 34,
  screening: 28,
  interview: 20,
  offer: 8,
  hired: 4,
  rejected: 6,
};

export function stageOf(jobId: string, candidateId: string): PipelineStage {
  const seed = hashSeed(`${jobId}:${candidateId}:stage`);
  const totalWeight = Object.values(STAGE_WEIGHTS).reduce((a, b) => a + b, 0);
  let roll = seed % totalWeight;
  for (const stage of PIPELINE_STAGES) {
    const weight = STAGE_WEIGHTS[stage];
    if (roll < weight) return stage;
    roll -= weight;
  }
  return "new";
}

export type PipelineEntry = { candidate: Candidate; stage: PipelineStage };

export function pipelineForJob(
  jobId: string,
  pool: Candidate[] = DEFAULT_RANKED_POOL,
): PipelineEntry[] {
  return pool
    .filter((c) => isInPipeline(jobId, c.id))
    .map((candidate) => ({ candidate, stage: stageOf(jobId, candidate.id) }));
}

export type JobPipelineSummary = {
  jobId: string;
  total: number;
  byStage: Record<PipelineStage, number>;
  screeningProgressPct: number;
  internalCount: number;
  externalCount: number;
  avgScore: number;
};

export function summarizeJobPipeline(
  jobId: string,
  pool: Candidate[] = DEFAULT_RANKED_POOL,
): JobPipelineSummary {
  const entries = pipelineForJob(jobId, pool);
  const byStage = PIPELINE_STAGES.reduce(
    (acc, stage) => {
      acc[stage] = 0;
      return acc;
    },
    {} as Record<PipelineStage, number>,
  );
  let internalCount = 0;
  let externalCount = 0;
  let scoreSum = 0;

  for (const { candidate, stage } of entries) {
    byStage[stage] += 1;
    if (candidate.origin === "internal") internalCount += 1;
    else externalCount += 1;
    scoreSum += candidate.score;
  }

  const total = entries.length;
  const screened = total - byStage.new;
  const screeningProgressPct = total > 0 ? Math.round((screened / total) * 100) : 0;
  const avgScore = total > 0 ? Math.round(scoreSum / total) : 0;

  return { jobId, total, byStage, screeningProgressPct, internalCount, externalCount, avgScore };
}

/** Deduplicated candidate count across every job's pipeline — dashboard KPI. */
export function totalCandidatesInPipelines(pool: Candidate[] = DEFAULT_RANKED_POOL): number {
  const seen = new Set<string>();
  for (const job of JOBS) {
    for (const candidate of pool) {
      if (isInPipeline(job.id, candidate.id)) seen.add(candidate.id);
    }
  }
  return seen.size;
}
