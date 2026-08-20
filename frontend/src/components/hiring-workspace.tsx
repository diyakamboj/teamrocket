import { Link } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { AlertTriangle, Loader2, PlusCircle } from "lucide-react";
import { CreateJobModal } from "@/components/create-job-modal";
import {
  getJobPipeline,
  listJobPipelines,
  type JobPipelineSummary,
  type PipelineCandidate,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export type JobWithPipeline = JobPipelineSummary & { pipeline: PipelineCandidate[] };

export const TOP_MATCH_SCORE = 85;

/**
 * Loads every job with its candidate pipeline once, so a workspace can filter
 * and count without each card issuing its own request.
 */
export function useJobWorkspace(source: "internal" | "external") {
  const [jobs, setJobs] = useState<JobWithPipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  //: Bumped by `refresh` so adding someone to a role re-reads the counts
  //: rather than leaving the list showing what was true on mount.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    listJobPipelines()
      .then(async (summaries) =>
        Promise.all(
          summaries.map(async (job) => ({
            ...job,
            pipeline: await getJobPipeline(job.job_id, source).catch(() => []),
          })),
        ),
      )
      .then((rows) => {
        if (cancelled) return;
        setJobs(
          // Strict: a role belongs to one funnel. "both" used to match here,
          // so every unclassified job appeared in the internal workspace as
          // well as the external one — which is why external reqs showed up
          // under internal hiring. Unclassified roles are surfaced
          // separately by `useUnclassifiedJobs` rather than shown in both.
          rows.filter((j) => (j.sourcing_mode || "both") === source),
        );

        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load hiring data");
        setLoading(false);
      });


    return () => {
      cancelled = true;
    };
  }, [source, version]);

  const refresh = useCallback(() => setVersion((v) => v + 1), []);

  return { jobs, loading, error, refresh };
}

/**
 * Roles that never had a funnel chosen.
 *
 * These predate the internal/external choice being mandatory at creation.
 * They belong to neither workspace, so rather than silently appearing in
 * both they are listed for the recruiter to classify.
 */
export function useUnclassifiedJobs() {
  const [jobs, setJobs] = useState<JobPipelineSummary[]>([]);

  const refresh = useCallback(() => {
    listJobPipelines()
      .then((rows) => setJobs(rows.filter((j) => (j.sourcing_mode || "both") === "both")))
      .catch(() => setJobs([]));
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { jobs, refresh };
}

export function countTopMatches(job: JobWithPipeline): number {
  return job.pipeline.filter((c) => (c.overall_score ?? 0) >= TOP_MATCH_SCORE).length;
}

export function countInStage(job: JobWithPipeline, stages: PipelineCandidate["stage"][]): number {
  return job.pipeline.filter((c) => stages.includes(c.stage)).length;
}

export function JobGrid({
  jobs,
  loading,
  error,
  emptyMessage,
  metrics,
}: {
  jobs: JobWithPipeline[];
  loading: boolean;
  error: string | null;
  emptyMessage: string;
  metrics: (job: JobWithPipeline) => { label: string; value: number; tone?: string }[];
}) {
  if (loading) {
    return (
      <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
      </p>
    );
  }
  if (error) {
    return (
      <p className="flex items-center justify-center gap-2 py-12 text-sm text-destructive">
        <AlertTriangle className="h-4 w-4" /> {error}
      </p>
    );
  }
  if (jobs.length === 0) {
    return <p className="py-12 text-center text-sm text-muted-foreground">{emptyMessage}</p>;
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {jobs.map((job) => (
        <Card key={job.job_id} className="card-surface transition-all hover:border-primary">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <Badge variant="outline" className="text-[11px] font-bold uppercase">
                {job.status}
              </Badge>
              <span className="rounded border border-success/30 bg-success/15 px-2 py-0.5 text-[11px] font-bold text-success">
                avg {Math.round(job.average_score)}%
              </span>
            </div>
            <CardTitle className="mt-2 text-base font-bold">{job.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-center text-xs">
              {metrics(job).map((m) => (
                <div key={m.label}>
                  <span className="block text-[11px] font-semibold text-muted-foreground">
                    {m.label}
                  </span>
                  <span className={cn("font-bold", m.tone ?? "text-foreground")}>{m.value}</span>
                </div>
              ))}
            </div>

            <Link to="/jobs/$jobId" params={{ jobId: String((job as any).job_id || (job as any).id || "") }}>
              <Button variant="outline" className="w-full rounded-lg text-xs font-semibold">
                Open job workspace →
              </Button>
            </Link>

          </CardContent>
        </Card>
      ))}
    </div>
  );
}

export function WorkspaceHeader({
  eyebrow,
  icon,
  title,
  subtitle,
  createLabel,
}: {
  eyebrow: string;
  icon: ReactNode;
  title: string;
  subtitle: string;
  createLabel: string;
}) {
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            {icon} {eyebrow}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        </div>

        <Button onClick={() => setIsCreateModalOpen(true)} className="rounded-xl">
          <PlusCircle className="mr-2 h-4 w-4" /> {createLabel}
        </Button>
      </div>

      <CreateJobModal isOpen={isCreateModalOpen} onClose={() => setIsCreateModalOpen(false)} />
    </>
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint: string;
}) {
  return (
    <Card className="card-surface p-6">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </h3>
      <div className="mt-2 text-2xl font-extrabold">{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </Card>
  );
}

export function useWorkspaceTotals(jobs: JobWithPipeline[]) {
  return useMemo(() => {
    const all = jobs.flatMap((j) => j.pipeline);
    const scored = all.filter((c) => c.overall_score !== null && c.overall_score !== undefined);
    return {
      candidates: all.length,
      topMatches: all.filter((c) => (c.overall_score ?? 0) >= TOP_MATCH_SCORE).length,
      averageScore: scored.length
        ? Math.round(scored.reduce((s, c) => s + (c.overall_score ?? 0), 0) / scored.length)
        : 0,
      interviewing: all.filter((c) => c.stage === "interviewing" || c.stage === "interviewed")
        .length,
      selected: all.filter((c) => c.stage === "selected").length,
    };
  }, [jobs]);
}
