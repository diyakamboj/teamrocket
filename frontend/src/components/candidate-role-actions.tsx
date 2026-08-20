import { Armchair, Briefcase, Loader2, UserMinus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
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
  compact = false,
  showRolePicker = false,
  className,
}: {
  candidateId: string;
  candidateName: string;
  currentJobId?: string | null;
  source?: string | null;
  employmentStatus?: string | null;
  jobs: JobPipelineSummary[];
  onChanged?: () => void;
  /** Tighter labels for dense table rows. */
  compact?: boolean;
  /**
   * Show the role picker inline. Off by default: a bare <select> of titles
   * in every row said nothing about the roles being chosen between, and
   * reassignment now lives in the candidate's profile where each role can
   * show its own numbers and its internal/external section.
   */
  showRolePicker?: boolean;
  className?: string;
}) {
  const [busy, setBusy] = useState<"role" | "bench" | "remove" | null>(null);
  const onBench = employmentStatus === "bench";
  const internal = source === "internal";

  async function changeRole(nextJobId: string) {
    setBusy("role");
    try {
      const target = nextJobId || null;
      await moveCandidateToRole(candidateId, target, currentJobId ?? null);
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

  async function removeFromRole() {
    setBusy("remove");
    try {
      await moveCandidateToRole(candidateId, null, currentJobId ?? null);
      // Worth being explicit: recruiters expect a "remove" to delete, and
      // this deliberately does not.
      toast.success(`${candidateName} removed from the role`, {
        description: "They stay in your pool and can be added to another role.",
      });
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not remove them");
    } finally {
      setBusy(null);
    }
  }

  async function bench() {
    setBusy("bench");
    try {
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
      {showRolePicker && (
        <>
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
              className={cn(
                "truncate rounded-lg border border-input bg-background py-1 pl-7 pr-2 text-xs disabled:opacity-50",
                compact ? "max-w-[9.5rem]" : "max-w-[14rem]",
              )}
            >
              <option value="">No role (pool)</option>
              {jobs.map((job) => (
                <option key={job.job_id} value={job.job_id}>
                  {job.title}
                </option>
              ))}
            </select>
          </div>
        </>
      )}

      {currentJobId && (
        <button
          type="button"
          onClick={() => void removeFromRole()}
          disabled={busy !== null}
          title="Take them off this role — they stay in your pool"
          className={cn(
            "press inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
            "hover:border-destructive/50 hover:bg-destructive/10 hover:text-destructive",
            busy !== null && "opacity-50",
          )}
        >
          {busy === "remove" ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <UserMinus className="h-3 w-3" />
          )}
          {compact ? "Remove" : "Remove from role"}
        </button>
      )}

      {/* The bench is internal employees between assignments. Offering it on
          an external applicant only ever led to a prompt asking whether to
          reclassify them as staff, which is not a decision to surface as a
          side effect of a bench button. */}
      {internal && (
      <button
        type="button"
        onClick={() => void bench()}
        disabled={busy !== null || onBench}
        title={onBench ? `${candidateName} is already on the bench` : "Place on the internal bench"}
        className={cn(
          "inline-flex items-center gap-1 rounded-lg border px-2 py-1 text-xs font-medium transition-colors",
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
      )}
    </div>
  );
}
