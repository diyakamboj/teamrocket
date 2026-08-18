import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Briefcase,
  Building2,
  FileText,
  MapPin,
  Sparkles,
  Trophy,
  UploadCloud,
  UserRoundX,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/empty-state";
import { OriginBadge } from "@/components/origin-badge";
import { PageHeader } from "@/components/page-header";
import { ScoreRing } from "@/components/score-ring";
import { useAppState } from "@/lib/app-state";
import { CANDIDATES, rankCandidates } from "@/lib/mock-data";
import {
  JOB_STATUS_LABEL,
  PIPELINE_STAGES,
  PIPELINE_STAGE_LABEL,
  getJob,
  pipelineForJob,
  summarizeJobPipeline,
  type PipelineStage,
} from "@/lib/jobs-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/jobs/$jobId")({
  head: ({ params }) => {
    const job = getJob(params.jobId);
    return {
      meta: [
        { title: job ? `${job.title} — Hiring Pipeline — ResumeIQ` : "Job not found — ResumeIQ" },
      ],
    };
  },
  component: JobDetail,
});

const STAGE_BADGE_CLASS: Record<PipelineStage, string> = {
  new: "bg-secondary text-muted-foreground border-transparent",
  screening: "bg-primary-soft text-primary-soft-foreground border-transparent",
  interview: "bg-primary-soft text-primary-soft-foreground border-transparent",
  offer: "bg-warning/20 text-warning-foreground dark:text-warning border-transparent",
  hired: "bg-success/15 text-success border-transparent",
  rejected: "bg-destructive/15 text-destructive border-transparent",
};

function JobDetail() {
  const { jobId } = Route.useParams();
  const { setSelectedJobId, openCopilot, weights, blindMode, compareIds } = useAppState();
  const [stageFilter, setStageFilter] = useState<PipelineStage | "all">("all");
  const [originFilter, setOriginFilter] = useState<"all" | "internal" | "external">("all");

  useEffect(() => {
    setSelectedJobId(jobId);
  }, [jobId, setSelectedJobId]);

  const job = getJob(jobId);
  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);
  const summary = useMemo(() => (job ? summarizeJobPipeline(job.id, ranked) : null), [job, ranked]);
  const entries = useMemo(() => (job ? pipelineForJob(job.id, ranked) : []), [job, ranked]);

  const visibleEntries = useMemo(
    () =>
      entries
        .filter((e) => (stageFilter === "all" ? true : e.stage === stageFilter))
        .filter((e) => (originFilter === "all" ? true : e.candidate.origin === originFilter))
        .slice()
        .sort((a, b) => b.candidate.score - a.candidate.score)
        .slice(0, 12),
    [entries, stageFilter, originFilter],
  );

  if (!job) {
    return (
      <div className="mx-auto max-w-3xl">
        <EmptyState
          icon={Briefcase}
          title="This job couldn't be found"
          description="It may have been removed, or the link is out of date. Head back to the dashboard to see your active jobs."
          action={{ label: "Back to workspace", to: "/" }}
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeader
        crumbs={[{ label: "Workspace", to: "/" }, { label: job.title }]}
        title={job.title}
        description={
          <>
            <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
              <Badge>{JOB_STATUS_LABEL[job.status]}</Badge>
              <span className="inline-flex items-center gap-1.5">
                <Building2 className="h-4 w-4" /> {job.department}
              </span>
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="h-4 w-4" /> {job.location}
                {job.remote ? " · Remote-friendly" : ""}
              </span>
            </span>
          </>
        }
        actions={
          <Button className="rounded-xl" onClick={() => openCopilot({ jobId: job.id })}>
            <Sparkles className="mr-2 h-4 w-4" /> Copilot
          </Button>
        }
      />

      <p className="max-w-2xl text-sm text-muted-foreground">{job.summary}</p>

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" className="rounded-xl" asChild>
          <Link to="/job-analysis" search={{ job: job.id }}>
            <FileText className="mr-1.5 h-3.5 w-3.5" /> Job description
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="rounded-xl" asChild>
          <Link to="/upload" search={{ job: job.id }}>
            <UploadCloud className="mr-1.5 h-3.5 w-3.5" /> Upload resumes
          </Link>
        </Button>
        <Button variant="outline" size="sm" className="rounded-xl" asChild>
          <Link to="/candidates" search={{ job: job.id }}>
            <Trophy className="mr-1.5 h-3.5 w-3.5" /> Rank candidates
          </Link>
        </Button>
        {compareIds.length >= 2 && (
          <Button variant="outline" size="sm" className="rounded-xl" asChild>
            <Link to="/compare">Compare ({compareIds.length})</Link>
          </Button>
        )}
      </div>

      {summary && summary.total > 0 ? (
        <>
          <section className="card-surface p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Pipeline
              </h2>
              <p className="text-xs text-muted-foreground">
                {summary.screeningProgressPct}% screened · {summary.internalCount} internal ·{" "}
                {summary.externalCount} external
              </p>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {(["all", "internal", "external"] as const).map((origin) => (
                <button
                  key={origin}
                  onClick={() => setOriginFilter(origin)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-xs font-semibold capitalize transition-colors",
                    originFilter === origin
                      ? "border-primary bg-primary-soft"
                      : "hover:bg-secondary",
                  )}
                >
                  {origin === "all" ? "All hiring" : origin === "internal" ? "Internal" : "External"}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={() => setStageFilter("all")}
                className={cn(
                  "rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors",
                  stageFilter === "all" ? "border-primary bg-primary-soft" : "hover:bg-secondary",
                )}
              >
                All stages{" "}
                <span className="tabular-nums text-muted-foreground">({summary.total})</span>
              </button>
              {PIPELINE_STAGES.map((stage) => (
                <button
                  key={stage}
                  onClick={() => setStageFilter(stage)}
                  className={cn(
                    "rounded-xl border px-3 py-2 text-left text-xs font-semibold transition-colors",
                    stageFilter === stage ? "border-primary bg-primary-soft" : "hover:bg-secondary",
                  )}
                >
                  {PIPELINE_STAGE_LABEL[stage]}{" "}
                  <span className="tabular-nums text-muted-foreground">
                    ({summary.byStage[stage]})
                  </span>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-sm font-bold uppercase tracking-wide text-muted-foreground">
                Candidates
              </h2>
              <Link
                to="/candidates"
                search={{ job: job.id }}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Full ranking
              </Link>
            </div>

            <div className="card-surface divide-y overflow-hidden">
              {visibleEntries.map(({ candidate, stage }) => (
                <div
                  key={candidate.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-4 px-5 py-3"
                >
                  <ScoreRing value={candidate.score} size={40} />
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 truncate text-sm font-bold">
                      {blindMode ? `Candidate #${candidate.rank}` : candidate.name}
                      <OriginBadge origin={candidate.origin} />
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {candidate.title} · {candidate.years} yrs
                    </p>
                  </div>
                  <Badge className={cn("shrink-0", STAGE_BADGE_CLASS[stage])}>
                    {PIPELINE_STAGE_LABEL[stage]}
                  </Badge>
                </div>
              ))}
              {visibleEntries.length === 0 && (
                <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                  No candidates match this pipeline view.
                </p>
              )}
            </div>
          </section>
        </>
      ) : (
        <EmptyState
          icon={UserRoundX}
          title="No candidates in this pipeline yet"
          description="Upload resumes or analyze the job description to start building this pipeline."
          action={{ label: "Upload resumes", to: "/upload", search: { job: job.id } }}
        />
      )}
    </div>
  );
}
