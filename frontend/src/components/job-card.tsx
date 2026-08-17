import { Link } from "@tanstack/react-router";
import { Building2, MapPin, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { JOB_STATUS_LABEL, type Job, type JobPipelineSummary } from "@/lib/jobs-data";

const STATUS_BADGE_CLASS: Record<Job["status"], string> = {
  open: "bg-primary-soft text-primary-soft-foreground border-transparent",
  interviewing: "bg-success/15 text-success border-transparent",
  offer_stage: "bg-warning/20 text-warning-foreground dark:text-warning border-transparent",
  on_hold: "bg-secondary text-muted-foreground border-transparent",
  closed: "bg-muted text-muted-foreground border-transparent",
};

export function JobCard({
  job,
  summary,
  onAskCopilot,
}: {
  job: Job;
  summary: JobPipelineSummary;
  onAskCopilot: () => void;
}) {
  return (
    <div className="card-surface flex flex-col gap-4 p-5 transition-shadow duration-300 hover:shadow-[var(--shadow-lift)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-base font-bold">{job.title}</p>
          <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Building2 className="h-3.5 w-3.5" /> {job.department}
            </span>
            <span className="inline-flex items-center gap-1">
              <MapPin className="h-3.5 w-3.5" /> {job.location}
              {job.remote ? " · Remote-friendly" : ""}
            </span>
          </p>
        </div>
        <Badge className={cn("shrink-0", STATUS_BADGE_CLASS[job.status])}>
          {JOB_STATUS_LABEL[job.status]}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <p className="text-lg font-extrabold tabular-nums">{summary.total}</p>
          <p className="text-xs text-muted-foreground">Candidates in pipeline</p>
        </div>
        <div>
          <p className="text-lg font-extrabold tabular-nums">{summary.avgScore || "—"}</p>
          <p className="text-xs text-muted-foreground">Average match score</p>
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Screening progress</span>
          <span className="tabular-nums">{summary.screeningProgressPct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-500"
            style={{ width: `${summary.screeningProgressPct}%` }}
          />
        </div>
      </div>

      {summary.total > 0 && (
        <div>
          <div className="mb-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>Internal vs. external</span>
            <span className="tabular-nums">
              {summary.internalCount} internal · {summary.externalCount} external
            </span>
          </div>
          <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full bg-primary"
              style={{ width: `${(summary.internalCount / summary.total) * 100}%` }}
            />
            <div
              className="h-full bg-chart-2"
              style={{ width: `${(summary.externalCount / summary.total) * 100}%` }}
            />
          </div>
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1">
        <Link
          to="/jobs/$jobId"
          params={{ jobId: job.id }}
          className="flex-1 rounded-xl bg-primary px-3 py-2 text-center text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          Continue screening
        </Link>
        <button
          type="button"
          onClick={onAskCopilot}
          aria-label={`Ask Copilot about ${job.title}`}
          title="Ask Copilot about this job"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <Sparkles className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
