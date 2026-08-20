import {
  ArrowRight,
  Check,
  ChevronRight,
  CircleDashed,
  Clock,
  Loader2,
  MinusCircle,
  PartyPopper,
  Send,
  SkipForward,
  UserX,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  getJobProgress,
  skipAssessment,
  triggerCandidateAssessment,
  type CandidateProgress,
  type ProgressStep,
} from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * The hiring board, written for someone who has not run a hiring loop before.
 *
 * The old board showed a stage name and every possible button, leaving the
 * recruiter to work out which one applied. That is fine if you already know
 * the process. This shows each candidate as a checklist in the order things
 * actually happen, and names the single next action.
 *
 * The assessment step is three-valued on purpose: "not sent", "sent", and
 * "skipped on purpose" are different situations, and a board that only
 * records completion makes the last two look identical.
 */
export function HiringStepsBoard({
  jobId,
  jobTitle,
  source,
  onChanged,
  onGoto,
}: {
  jobId: string;
  jobTitle?: string | null;
  source?: string;
  onChanged?: () => void;
  /** Switch the workspace to the tab where this action is performed. */
  onGoto?: (tab: "pipeline" | "candidates") => void;
}) {
  const [rows, setRows] = useState<CandidateProgress[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  //: Candidate whose skip reason is being typed, if any.
  const [skipping, setSkipping] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setRows(await getJobProgress(jobId, source));
    } catch {
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [jobId, source]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function sendAssessment(row: CandidateProgress) {
    setBusy(row.candidate_id);
    try {
      const record = await triggerCandidateAssessment({
        candidate_id: row.candidate_id,
        job_id: jobId,
      });
      if (record.notification_sent) {
        toast.success(`Assessment emailed to ${row.candidate_name}`);
      } else {
        toast.warning(`Assessment recorded, but no email was sent`, {
          description: record.notification_error ?? undefined,
        });
      }
      await refresh();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the assessment");
    } finally {
      setBusy(null);
    }
  }

  async function skip(row: CandidateProgress, reason: string) {
    setBusy(row.candidate_id);
    try {
      await skipAssessment({
        candidate_id: row.candidate_id,
        job_id: jobId,
        job_title: jobTitle ?? null,
        reason: reason.trim() || "No reason given",
      });
      toast.success(`Assessment skipped for ${row.candidate_name}`, {
        description: "They can now move on to the interview rounds.",
      });
      setSkipping(null);
      await refresh();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not skip the assessment");
    } finally {
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Working out where everyone is…
      </p>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="surface-lift p-10 text-center">
        <CircleDashed className="mx-auto h-8 w-8 text-muted-foreground" />
        <h3 className="mt-3 font-display text-lg font-bold">Nobody on this role yet</h3>
        <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">
          Upload résumés against this role and they will appear here with the steps to work
          through.
        </p>
      </div>
    );
  }

  const active = rows.filter((r) => r.hiring_status === "active");
  const closed = rows.filter((r) => r.hiring_status !== "active");

  return (
    <div className="flow-stack">
      {active.length > 0 && (
        <div className="flow-stack">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
            In progress · {active.length}
          </h3>
          {active.map((row) => (
            <CandidateCard
              key={row.candidate_id}
              row={row}
              busy={busy === row.candidate_id}
              skipping={skipping === row.candidate_id}
              onSend={() => void sendAssessment(row)}
              onStartSkip={() => setSkipping(row.candidate_id)}
              onCancelSkip={() => setSkipping(null)}
              onConfirmSkip={(reason) => void skip(row, reason)}
              {...(onGoto ? { onGoto } : {})}
            />
          ))}
        </div>
      )}

      {closed.length > 0 && (
        <div className="flow-stack">
          <h3 className="font-display text-sm font-bold uppercase tracking-wide text-muted-foreground">
            Closed · {closed.length}
          </h3>
          {closed.map((row) => (
            <CandidateCard key={row.candidate_id} row={row} busy={false} />
          ))}
        </div>
      )}
    </div>
  );
}

function CandidateCard({
  row,
  busy,
  skipping,
  onSend,
  onStartSkip,
  onCancelSkip,
  onConfirmSkip,
  onGoto,
}: {
  row: CandidateProgress;
  busy: boolean;
  skipping?: boolean;
  onSend?: () => void;
  onStartSkip?: () => void;
  onCancelSkip?: () => void;
  onConfirmSkip?: (reason: string) => void;
  onGoto?: (tab: "pipeline" | "candidates") => void;
}) {
  const hired = row.hiring_status === "hired";
  const rejected = row.hiring_status === "rejected";
  const done = row.steps.filter((s) => s.state === "done" || s.state === "skipped").length;

  return (
    <article
      className={cn(
        "surface-lift p-5",
        hired && "border-success/40",
        rejected && "opacity-70",
      )}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <h4 className="truncate font-display text-base font-bold">{row.candidate_name}</h4>
          {hired && (
            <span className="inline-flex items-center gap-1 rounded-full bg-success/15 px-2.5 py-1 text-[11px] font-bold text-success">
              <PartyPopper className="h-3 w-3" /> Hired
            </span>
          )}
          {rejected && (
            <span className="inline-flex items-center gap-1 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-bold text-muted-foreground">
              <UserX className="h-3 w-3" /> Not proceeding
            </span>
          )}
        </div>
        <span className="metric shrink-0 text-[11px] font-semibold text-muted-foreground">
          {done} of {row.steps.length} steps done
        </span>
      </header>

      <ol className="mt-4 grid gap-1.5">
        {row.steps.map((step) => (
          <StepRow key={step.key} step={step} />
        ))}
      </ol>

      {row.next_action && (
        <footer className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl bg-secondary/60 px-4 py-3">
          <div className="min-w-0">
            <p className="text-xs font-bold">Next: {row.next_action.label}</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">{row.next_action.why}</p>
          </div>

          {/* Skip stays available while an assessment is out, not only
              before it is sent. Waiting on a candidate is not a state you
              should be stuck in — they may never submit, and the recruiter
              still has to be able to move on. */}
          {(row.next_action.kind === "send_assessment" || row.next_action.kind === "wait") &&
            !skipping && (
              <div className="flex shrink-0 items-center gap-2">
                {row.next_action.kind === "send_assessment" && onSend && (
                  <Button
                    size="sm"
                    disabled={busy}
                    onClick={onSend}
                    className="press gap-1.5 rounded-xl text-xs"
                  >
                    {busy ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Send className="h-3 w-3" />
                    )}
                    Send assessment
                  </Button>
                )}

                {row.next_action.kind === "wait" && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-card px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground">
                    <Clock className="h-3 w-3" /> Waiting
                  </span>
                )}

                {onStartSkip && (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={onStartSkip}
                    className="press gap-1.5 rounded-xl text-xs"
                  >
                    <SkipForward className="h-3 w-3" />
                    {row.next_action.kind === "wait" ? "Skip and continue" : "Skip"}
                  </Button>
                )}
              </div>
            )}

          {/* Actions that happen on another tab get a way to reach it.
              Telling someone to "move to the technical interview" without
              saying where is the gap that made this unusable for anyone who
              had not already learnt the layout. */}
          {row.next_action.goto && row.next_action.goto_label && onGoto && (
            <Button
              size="sm"
              onClick={() => onGoto(row.next_action!.goto as "pipeline" | "candidates")}
              className="press shrink-0 gap-1.5 rounded-xl text-xs"
            >
              {row.next_action.goto_label}
              <ArrowRight className="h-3 w-3" />
            </Button>
          )}
        </footer>
      )}

      {skipping && onConfirmSkip && onCancelSkip && (
        <SkipReasonForm
          candidateName={row.candidate_name}
          busy={busy}
          onCancel={onCancelSkip}
          onConfirm={onConfirmSkip}
        />
      )}
    </article>
  );
}

/**
 * Why the assessment was skipped.
 *
 * Inline rather than `window.prompt`: prompt is blocked outright in
 * sandboxed frames, where it returns null without showing anything — the
 * button simply appeared to do nothing. A reason is asked for because an
 * unexplained skip is what nobody can account for later when the hire is
 * questioned, but it is pre-filled and one click to accept.
 */
function SkipReasonForm({
  candidateName,
  busy,
  onCancel,
  onConfirm,
}: {
  candidateName: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
}) {
  const [reason, setReason] = useState("Already assessed by the hiring manager");

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        onConfirm(reason);
      }}
      className="mt-4 rounded-xl border border-warning/40 bg-warning/5 p-4"
    >
      <p className="text-xs font-bold">Skip the skills assessment for {candidateName}?</p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">
        They will move straight on to the interview rounds. The reason is recorded against them.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why are you skipping it?"
          className="min-w-[16rem] flex-1 rounded-lg border border-input bg-background px-3 py-2 text-xs"
        />
        <Button type="submit" size="sm" disabled={busy} className="press gap-1.5 rounded-xl text-xs">
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <SkipForward className="h-3 w-3" />}
          Confirm skip
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={onCancel}
          className="rounded-xl text-xs"
        >
          Cancel
        </Button>
      </div>
    </form>
  );
}

const STEP_ICON = {
  done: Check,
  current: ChevronRight,
  todo: CircleDashed,
  skipped: MinusCircle,
} as const;

function StepRow({ step }: { step: ProgressStep }) {
  const Icon = STEP_ICON[step.state];
  return (
    <li
      className={cn(
        "flex flex-wrap items-center gap-2.5 rounded-lg px-2.5 py-1.5",
        step.state === "current" && "bg-primary-soft/60",
      )}
    >
      <span
        className={cn(
          "grid h-5 w-5 shrink-0 place-items-center rounded-full",
          step.state === "done" && "bg-success/15 text-success",
          step.state === "current" && "bg-primary text-primary-foreground",
          step.state === "todo" && "bg-secondary text-muted-foreground",
          step.state === "skipped" && "bg-warning/20 text-warning-foreground",
        )}
      >
        <Icon className="h-3 w-3" />
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate text-xs",
          step.state === "todo" ? "text-muted-foreground" : "font-medium",
          step.state === "skipped" && "line-through decoration-1",
        )}
      >
        {step.label}
      </span>

      {step.interviewer && (
        <span className="shrink-0 text-[10px] text-muted-foreground">{step.interviewer}</span>
      )}

      <span className="shrink-0 text-[11px] text-muted-foreground">{step.detail}</span>
    </li>
  );
}
