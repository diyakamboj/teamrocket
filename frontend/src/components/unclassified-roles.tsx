import { AlertTriangle, Building2, Globe, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { updateJob, type JobPipelineSummary } from "@/lib/api";

/**
 * Roles created before choosing a funnel was mandatory.
 *
 * They match neither workspace now that filtering is strict, so they are
 * listed here to be classified rather than quietly appearing under both
 * internal and external hiring.
 */
export function UnclassifiedRoles({
  jobs,
  onClassified,
}: {
  jobs: JobPipelineSummary[];
  onClassified: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);

  if (jobs.length === 0) return null;

  async function classify(job: JobPipelineSummary, mode: "internal" | "external") {
    setBusy(job.job_id);
    try {
      await updateJob(job.job_id, { sourcing_mode: mode });
      toast.success(`${job.title} moved to ${mode} hiring`);
      onClassified();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update that role");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-warning/30 bg-warning/60 p-5 dark:border-warning/30 dark:bg-warning/5">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-bold">
            {jobs.length} {jobs.length === 1 ? "role has" : "roles have"} no hiring type
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            These were created before internal and external were separated, so they belong to
            neither workspace. Pick one and they will appear where they should.
          </p>

          <ul className="mt-4 space-y-2">
            {jobs.map((job) => (
              <li
                key={job.job_id}
                className="flex flex-wrap items-center gap-3 rounded-xl border bg-card px-3 py-2.5"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{job.title}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {job.total_candidates} in pipeline
                </span>
                <span className="flex shrink-0 items-center gap-1.5">
                  <button
                    type="button"
                    disabled={busy === job.job_id}
                    onClick={() => void classify(job, "internal")}
                    className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-50 dark:hover:bg-primary/10"
                  >
                    {busy === job.job_id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Building2 className="h-3 w-3" />
                    )}
                    Internal
                  </button>
                  <button
                    type="button"
                    disabled={busy === job.job_id}
                    onClick={() => void classify(job, "external")}
                    className="inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors hover:border-primary/30 hover:bg-primary/10 hover:text-primary disabled:opacity-50 dark:hover:bg-primary/10"
                  >
                    <Globe className="h-3 w-3" />
                    External
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
