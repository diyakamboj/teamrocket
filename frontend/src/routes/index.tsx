import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  Building2,
  CheckCircle2,
  Loader2,
  Pause,
  Plus,
  Users,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { MiniBar } from "@/components/score-ring";
import {
  getJobPipeline,
  listJobPipelines,
  updateCandidateSource,
  updateJobStatus,
  type JobPipelineSummary,
  type JobStatus,
  type PipelineCandidate,
  type PipelineStage,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Recruiter Dashboard — ResumeIQ" },
      {
        name: "description",
        content:
          "Active job listings with internal vs. external candidate views and live pipeline status tracking.",
      },
      { property: "og:title", content: "Recruiter Dashboard — ResumeIQ" },
      {
        property: "og:description",
        content: "Active job listings, internal/external candidate views, and pipeline status.",
      },
    ],
  }),
  component: RecruiterDashboard,
});

const STAGE_META: Record<PipelineStage, { label: string; className: string }> = {
  screened: { label: "Screened", className: "bg-secondary text-secondary-foreground" },
  interviewing: {
    label: "Interviewing",
    className: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
  interviewed: {
    label: "Interviewed",
    className: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  },
  selected: {
    label: "Selected",
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  rejected: {
    label: "Rejected",
    className: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  },
};

const STATUS_META: Record<JobStatus, { label: string; icon: typeof CheckCircle2; className: string }> = {
  open: {
    label: "Open",
    icon: CheckCircle2,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  paused: {
    label: "Paused",
    icon: Pause,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  closed: {
    label: "Closed",
    icon: XCircle,
    className: "bg-secondary text-secondary-foreground",
  },
};

function StageBadge({ stage }: { stage: PipelineStage }) {
  const meta = STAGE_META[stage];
  return <Badge className={cn("border-transparent font-medium", meta.className)}>{meta.label}</Badge>;
}

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(`${iso}Z`.replace("ZZ", "Z")).getTime();
  const days = Math.round(diffMs / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

type SourceFilter = "all" | "internal" | "external";

function RecruiterDashboard() {
  const [jobs, setJobs] = useState<JobPipelineSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);

  async function loadJobs() {
    setLoadingJobs(true);
    try {
      const rows = await listJobPipelines();
      setJobs(rows);
      setSelectedJobId((current) => current ?? rows[0]?.job_id ?? null);
    } catch {
      setJobs([]);
    } finally {
      setLoadingJobs(false);
    }
  }

  useEffect(() => {
    void loadJobs();
  }, []);

  async function loadCandidates(jobId: string, source: SourceFilter) {
    setLoadingCandidates(true);
    try {
      setCandidates(await getJobPipeline(jobId, source));
    } catch {
      setCandidates([]);
    } finally {
      setLoadingCandidates(false);
    }
  }

  useEffect(() => {
    if (selectedJobId) void loadCandidates(selectedJobId, sourceFilter);
  }, [selectedJobId, sourceFilter]);

  const selectedJob = jobs.find((j) => j.job_id === selectedJobId);

  const counts = useMemo(
    () => ({
      internal: candidates.filter((c) => c.source === "internal").length,
      external: candidates.filter((c) => c.source === "external").length,
    }),
    [candidates],
  );

  async function handleStatusChange(job: JobPipelineSummary, status: JobStatus) {
    try {
      await updateJobStatus(job.job_id, status);
      setJobs((prev) => prev.map((j) => (j.job_id === job.job_id ? { ...j, status } : j)));
      toast.success(`${job.title} marked ${STATUS_META[status].label.toLowerCase()}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update job status");
    }
  }

  async function handleSourceToggle(candidate: PipelineCandidate) {
    const next = candidate.source === "internal" ? "external" : "internal";
    try {
      await updateCandidateSource(candidate.candidate_id, next);
      setCandidates((prev) =>
        prev.map((c) => (c.candidate_id === candidate.candidate_id ? { ...c, source: next } : c)),
      );
      if (selectedJobId) void loadJobs();
      toast.success(`${candidate.candidate_name} marked ${next}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update candidate");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Recruiter Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Active job listings, internal vs. external candidates, and live pipeline status.
          </p>
        </div>
        <Link
          to="/job-analysis"
          className="inline-flex shrink-0 items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> New job
        </Link>
      </header>

      {loadingJobs ? (
        <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading job listings…
        </div>
      ) : jobs.length === 0 ? (
        <div className="card-surface p-10 text-center">
          <Briefcase className="mx-auto h-8 w-8 text-muted-foreground" />
          <h2 className="mt-3 text-lg font-bold">No job listings yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Create a job and rank candidates against it to see the pipeline here.
          </p>
          <Link
            to="/job-analysis"
            className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Create a job
          </Link>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {jobs.map((job) => {
              const status = STATUS_META[job.status] ?? STATUS_META.open;
              const StatusIcon = status.icon;
              const isSelected = job.job_id === selectedJobId;
              return (
                <button
                  key={job.job_id}
                  onClick={() => setSelectedJobId(job.job_id)}
                  className={cn(
                    "card-surface flex flex-col gap-3 p-5 text-left transition-shadow",
                    isSelected ? "ring-2 ring-primary" : "hover:shadow-[var(--shadow-lift)]",
                  )}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-base font-bold">{job.title}</p>
                      <p className="text-xs text-muted-foreground">
                        Posted {timeAgo(job.created_at)}
                      </p>
                    </div>
                    <Badge className={cn("shrink-0 gap-1 border-transparent", status.className)}>
                      <StatusIcon className="h-3 w-3" /> {status.label}
                    </Badge>
                  </div>

                  <div className="flex items-center gap-4 text-sm">
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Users className="h-3.5 w-3.5" /> {job.total_candidates} candidates
                    </span>
                    <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                      <Building2 className="h-3.5 w-3.5" /> {job.internal_candidates} internal
                    </span>
                  </div>

                  <MiniBar label="Average match score" value={Math.round(job.average_score)} />

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {(Object.keys(STAGE_META) as PipelineStage[])
                      .filter((stage) => job.stage_counts[stage] > 0)
                      .map((stage) => (
                        <span key={stage} className="inline-flex items-center gap-1">
                          <StageBadge stage={stage} />
                          <span className="text-xs text-muted-foreground">
                            {job.stage_counts[stage]}
                          </span>
                        </span>
                      ))}
                  </div>
                </button>
              );
            })}
          </div>

          {selectedJob && (
            <section className="card-surface space-y-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="truncate text-lg font-bold">{selectedJob.title} — pipeline</h2>
                  <p className="text-xs text-muted-foreground">
                    {selectedJob.total_candidates} candidates · avg score{" "}
                    {Math.round(selectedJob.average_score)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {(["all", "internal", "external"] as const).map((tab) => (
                    <Button
                      key={tab}
                      size="sm"
                      variant={sourceFilter === tab ? "default" : "outline"}
                      className="rounded-xl capitalize"
                      onClick={() => setSourceFilter(tab)}
                    >
                      {tab === "all" ? "All" : tab}
                      {tab !== "all" && (
                        <span className="ml-1.5 text-xs opacity-70">
                          ({tab === "internal" ? counts.internal : counts.external})
                        </span>
                      )}
                    </Button>
                  ))}
                  <select
                    value={selectedJob.status}
                    onChange={(e) =>
                      void handleStatusChange(selectedJob, e.target.value as JobStatus)
                    }
                    className="h-9 rounded-xl border bg-background px-2 text-xs font-medium"
                  >
                    <option value="open">Open</option>
                    <option value="paused">Paused</option>
                    <option value="closed">Closed</option>
                  </select>
                </div>
              </div>

              {loadingCandidates ? (
                <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Loading pipeline…
                </div>
              ) : candidates.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No {sourceFilter !== "all" ? sourceFilter : ""} candidates in this pipeline yet.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-sm">
                    <thead>
                      <tr className="text-left text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        <th className="pb-2">Candidate</th>
                        <th className="pb-2">Source</th>
                        <th className="pb-2">Score</th>
                        <th className="pb-2">Stage</th>
                        <th className="pb-2">Updated</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {candidates.map((c) => (
                        <tr key={c.candidate_id}>
                          <td className="py-2.5 pr-3">
                            <p className="font-semibold">{c.candidate_name}</p>
                            {c.candidate_email && (
                              <p className="text-xs text-muted-foreground">{c.candidate_email}</p>
                            )}
                          </td>
                          <td className="py-2.5 pr-3">
                            <button
                              onClick={() => void handleSourceToggle(c)}
                              className={cn(
                                "rounded-full px-2.5 py-0.5 text-[11px] font-semibold capitalize transition-colors",
                                c.source === "internal"
                                  ? "bg-primary-soft text-primary-soft-foreground"
                                  : "bg-secondary text-secondary-foreground",
                              )}
                              title="Click to toggle internal / external"
                            >
                              {c.source}
                            </button>
                          </td>
                          <td className="py-2.5 pr-3 tabular-nums">
                            {c.overall_score != null ? Math.round(c.overall_score) : "—"}
                          </td>
                          <td className="py-2.5 pr-3">
                            <StageBadge stage={c.stage} />
                          </td>
                          <td className="py-2.5 pr-3 text-xs text-muted-foreground">
                            {timeAgo(c.updated_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
