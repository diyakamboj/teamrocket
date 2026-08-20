import { Armchair, Briefcase, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  markCandidateInternal,
  moveCandidateToRole,
  placeOnBench,
  type JobPipelineSummary,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * Per-candidate role and bench actions.
 *
 * Two things a recruiter could not do before: move someone between openings
 * (they were stuck on whichever role their résumé arrived under) and put an
 * employee on the bench without editing the record by hand.
 */
export function CandidateRoleActions({
  candidateId,
  candidateName,
  currentJobId,
  source,
  employmentStatus,
  jobs,
  onChanged,
  className,
}: {
  candidateId: string;
  candidateName: string;
  currentJobId?: string | null;
  source?: string | null;
  employmentStatus?: string | null;
  jobs: JobPipelineSummary[];
  onChanged?: () => void;
  className?: string;
}) {
  const [busy, setBusy] = useState<"role" | "bench" | null>(null);
  const onBench = employmentStatus === "bench";

  async function changeRole(nextJobId: string) {
    setBusy("role");
    try {
      const target = nextJobId || null;
      await moveCandidateToRole(candidateId, target);
      const label = jobs.find((j) => j.job_id === target)?.title;
      toast.success(
        target
          ? `${candidateName} moved to ${label ?? "the selected role"}`
          : `${candidateName} removed from the role — still in your pool`,
      );
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not change the role");
    } finally {
      setBusy(null);
    }
  }

  async function bench() {
    setBusy("bench");
    try {
      // The bench is internal employees only. Rather than reclassifying
      // silently — which is what the API used to do — say what is happening
      // and let the recruiter decide.
      if (source !== "internal") {
        const confirmed = window.confirm(
          `${candidateName} is currently an external candidate.\n\n` +
            "The bench is for internal employees between assignments. " +
            "Mark them as an internal employee and place them on the bench?",
        );
        if (!confirmed) return;
        await markCandidateInternal(candidateId);
      }
      await placeOnBench(candidateId);
      toast.success(`${candidateName} is on the bench`);
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not place them on the bench");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)}>
      <label className="sr-only" htmlFor={`role-${candidateId}`}>
        Role for {candidateName}
      </label>
      <div className="relative">
        <Briefcase className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground" />
        <select
          id={`role-${candidateId}`}
          value={currentJobId ?? ""}
          disabled={busy !== null}
          onChange={(e) => void changeRole(e.target.value)}
          className="rounded-lg border border-input bg-background py-1 pl-7 pr-2 text-[11px] disabled:opacity-50"
        >
          <option value="">No role (pool)</option>
          {jobs.map((job) => (
            <option key={job.job_id} value={job.job_id}>
              {job.title}
            </option>
          ))}
        </select>
      </div>

      <button
        type="button"
        onClick={() => void bench()}
        disabled={busy !== null || onBench}
        title={onBench ? `${candidateName} is already on the bench` : "Place on the internal bench"}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
          onBench
            ? "cursor-default border-transparent bg-secondary text-muted-foreground"
            : "hover:border-primary hover:bg-primary/10 hover:text-primary",
          busy !== null && "opacity-50",
        )}
      >
        {busy === "bench" ? (
          <Loader2 className="h-3 w-3 animate-spin" />
        ) : (
          <Armchair className="h-3 w-3" />
        )}
        {onBench ? "On bench" : "Bench"}
      </button>
    </div>
  );
}
