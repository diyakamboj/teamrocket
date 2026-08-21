import { useEffect, useMemo, useState } from "react";
import { Briefcase, Check, Globe, Loader2, Users } from "lucide-react";
import { toast } from "sonner";
import {
  listJobPipelines,
  moveCandidateToRole,
  type JobPipelineSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Move a candidate between roles, from their profile.
 *
 * This replaces a bare <select> in each table row. A dropdown of titles told
 * a recruiter nothing about the roles they were choosing between — not how
 * many people were already in each, and not whether a role was internal or
 * external, which is the distinction that decides whether a move even makes
 * sense. Here each role is a row with its own numbers, grouped under the two
 * sections, with the current one marked.
 */

type Section = { key: "internal" | "external"; label: string; hint: string; icon: typeof Briefcase };

const SECTIONS: Section[] = [
  {
    key: "internal",
    label: "Internal roles",
    hint: "Filled with people already at the company",
    icon: Briefcase,
  },
  {
    key: "external",
    label: "External roles",
    hint: "Open to applicants from outside",
    icon: Globe,
  },
];

export function CandidateRolePanel({
  candidateId,
  candidateName,
  currentJobId,
  onChanged,
}: {
  candidateId: string;
  candidateName: string;
  currentJobId?: string | null;
  onChanged?: () => void;
}) {
  const [jobs, setJobs] = useState<JobPipelineSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(currentJobId ?? null);

  useEffect(() => {
    setActiveJobId(currentJobId ?? null);
  }, [currentJobId]);

  useEffect(() => {
    listJobPipelines()
      .then(setJobs)
      .catch(() => setJobs([]))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const bySection: Record<"internal" | "external", JobPipelineSummary[]> = {
      internal: [],
      external: [],
    };
    for (const job of jobs) {
      // "both" is an external-facing opening that also accepts internals, so
      // it appears under external rather than vanishing.
      const mode = (job.sourcing_mode ?? "both").toLowerCase();
      bySection[mode === "internal" ? "internal" : "external"].push(job);
    }
    return bySection;
  }, [jobs]);

  async function assign(nextJobId: string | null) {
    if (nextJobId === activeJobId) return;
    setBusy(nextJobId ?? "none");
    const previous = activeJobId;
    try {
      await moveCandidateToRole(candidateId, nextJobId, previous ?? null);
      setActiveJobId(nextJobId);
      const label = jobs.find((j) => j.job_id === nextJobId)?.title;
      toast.success(
        nextJobId
          ? `${candidateName} moved to ${label ?? "the selected role"}`
          : `${candidateName} is in your pool with no role`,
      );
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the role");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading roles…
      </p>
    );
  }

  return (
    <section className="space-y-4">
      <div>
        <h3 className="text-sm font-semibold">Role</h3>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Pick which opening {candidateName || "this candidate"} is being considered for.
        </p>
      </div>

      {SECTIONS.map((section) => {
        const rows = grouped[section.key];
        return (
          <div key={section.key}>
            <div className="flex items-center gap-1.5 pb-1.5">
              <section.icon className="h-3.5 w-3.5 text-muted-foreground" />
              <p className="text-xs font-semibold">{section.label}</p>
              <span className="text-xs text-muted-foreground">· {section.hint}</span>
            </div>

            {rows.length === 0 ? (
              <p className="rounded-lg border border-dashed px-3 py-3 text-center text-xs text-muted-foreground">
                No {section.key} roles yet
              </p>
            ) : (
              <ul className="space-y-1.5">
                {rows.map((job) => {
                  const isCurrent = job.job_id === activeJobId;
                  return (
                    <li key={job.job_id}>
                      <button
                        type="button"
                        disabled={busy !== null}
                        onClick={() => void assign(job.job_id)}
                        className={cn(
                          "press-fx flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors",
                          isCurrent
                            ? "border-primary bg-primary-soft"
                            : "hover:border-primary/40 hover:bg-secondary/60",
                          busy !== null && "opacity-60",
                        )}
                      >
                        <span
                          className={cn(
                            "grid h-6 w-6 shrink-0 place-items-center rounded-md",
                            isCurrent
                              ? "bg-primary text-primary-foreground"
                              : "bg-secondary text-muted-foreground",
                          )}
                        >
                          {busy === job.job_id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : isCurrent ? (
                            <Check className="h-3 w-3" />
                          ) : (
                            <Briefcase className="h-3 w-3" />
                          )}
                        </span>

                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{job.title}</span>
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Users className="h-3 w-3" />
                              {job.total_candidates} in pipeline
                            </span>
                            {job.average_score > 0 && (
                              <span className="metric">avg {Math.round(job.average_score)}</span>
                            )}
                            <span className="capitalize">{job.status}</span>
                          </span>
                        </span>

                        {isCurrent && (
                          <span className="shrink-0 rounded-full bg-primary px-2 py-0.5 text-xs font-semibold text-primary-foreground">
                            Current
                          </span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}

      <button
        type="button"
        disabled={busy !== null || !activeJobId}
        onClick={() => void assign(null)}
        className={cn(
          "w-full rounded-lg border border-dashed px-3 py-2 text-xs font-medium transition-colors",
          activeJobId
            ? "text-muted-foreground hover:border-destructive/50 hover:text-destructive"
            : "cursor-default text-muted-foreground/60",
        )}
      >
        {busy === "none" ? "Removing…" : "Take them off this role (they stay in your pool)"}
      </button>
    </section>
  );
}
