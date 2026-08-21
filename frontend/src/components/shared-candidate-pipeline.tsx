import { useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { moveCandidateInPipeline, type SharedCandidate } from "@/lib/api";
import { columnKeyFor, columnsForJob } from "@/lib/pipeline";
import { cn } from "@/lib/utils";

/**
 * Where a shared candidate stands in the owner's pipeline, and — for a
 * collaborator — the controls to move them.
 *
 * A collaborator cannot list the owner's jobs, so they can never open that
 * job's board. The share carries the job's rounds and the candidate's
 * position instead, which is what makes "work on the same candidate
 * together" mean something beyond reading the same profile.
 */
export function SharedCandidatePipeline({
  candidate,
  onMoved,
}: {
  candidate: SharedCandidate;
  onMoved: () => void;
}) {
  const [moving, setMoving] = useState(false);

  const columns = useMemo(() => columnsForJob(candidate.rounds), [candidate.rounds]);
  const currentKey = useMemo(
    () =>
      candidate.stage
        ? columnKeyFor({ stage: candidate.stage, round_id: candidate.round_id }, columns)
        : null,
    [candidate.stage, candidate.round_id, columns],
  );

  // A share with no job has no pipeline to show — the candidate was sent for
  // an opinion, not for a specific role.
  if (!candidate.job_id || !candidate.stage) return null;

  const canMove = candidate.permission === "collaborate";
  const current = columns.find((c) => c.key === currentKey);

  async function move(columnKey: string) {
    const column = columns.find((c) => c.key === columnKey);
    if (!column || !candidate.job_id) return;
    setMoving(true);
    try {
      await moveCandidateInPipeline(candidate.job_id, candidate.candidate_id, {
        stage: column.stage,
        round_id: column.roundId ?? null,
        candidate_name: candidate.name,
      });
      toast.success(`${candidate.name} → ${column.label}`);
      onMoved();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not move the candidate");
    } finally {
      setMoving(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border bg-background p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          In {candidate.job_title || "their pipeline"}
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[11px] font-semibold",
            current?.tone ?? "text-muted-foreground",
            "bg-secondary",
          )}
        >
          {current?.label ?? candidate.stage}
        </span>
      </div>

      {canMove ? (
        <div className="mt-2.5 flex items-center gap-2">
          <select
            aria-label={`Move ${candidate.name} to`}
            disabled={moving}
            value=""
            onChange={(e) => {
              const next = e.target.value;
              e.currentTarget.value = "";
              if (next) void move(next);
            }}
            className="h-7 flex-1 rounded-lg border bg-background px-2 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 disabled:opacity-50"
          >
            <option value="">{moving ? "Moving…" : "Move to…"}</option>
            {columns
              .filter((c) => c.key !== currentKey)
              .map((column) => (
                <option key={column.key} value={column.key}>
                  {column.label}
                </option>
              ))}
          </select>
          {moving && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />}
        </div>
      ) : (
        <p className="mt-2 text-xs text-muted-foreground">
          Shared read-only, so you can see where they are but not move them.
        </p>
      )}
    </div>
  );
}
