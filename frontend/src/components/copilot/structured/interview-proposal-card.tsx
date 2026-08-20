import { useState } from "react";
import { Calendar, CheckCircle2, Clock, ExternalLink, Loader2, UserCheck, Video } from "lucide-react";
import { toast } from "sonner";
import { confirmInterview, type InterviewProposal, type ScheduledInterview, type TimeSlot } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

interface InterviewProposalCardProps {
  proposal: InterviewProposal;
}

export function InterviewProposalCard({ proposal }: InterviewProposalCardProps) {
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(
    proposal.proposed_slots[0] ?? null,
  );
  const [confirming, setConfirming] = useState(false);
  const [scheduled, setScheduled] = useState<ScheduledInterview | null>(null);

  const handleConfirm = async () => {
    if (!selectedSlot) return;
    try {
      setConfirming(true);
      const res = await confirmInterview({
        proposal_id: proposal.proposal_id,
        candidate_id: proposal.candidate_id,
        job_id: proposal.job_id ?? null,
        interview_type: proposal.interview_type,
        duration_minutes: proposal.duration_minutes,
        interviewers: proposal.required_interviewers,
        start_time: selectedSlot.start_time,
        end_time: selectedSlot.end_time,
        notes: proposal.notes ?? null,
      });
      setScheduled(res);
      toast.success("Interview confirmed! Microsoft Teams meeting & Outlook invite generated.");
    } catch (err: any) {
      toast.error(err.message || "Failed to confirm interview booking");
    } finally {
      setConfirming(false);
    }
  };

  if (scheduled) {
    return (
      <div className="space-y-3 rounded-xl border border-success/30 bg-success/10 p-3.5 text-xs text-foreground">
        <div className="flex items-center gap-2 font-semibold text-success dark:text-success">
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          Interview Confirmed & Booked!
        </div>
        <div>
          <p className="font-semibold text-sm">{scheduled.interview_type}</p>
          <p className="text-muted-foreground mt-0.5">
            {new Date(scheduled.start_time).toLocaleString(undefined, {
              weekday: "short",
              month: "short",
              day: "numeric",
              hour: "numeric",
              minute: "2-digit",
            })}{" "}
            ({scheduled.duration_minutes} mins)
          </p>
          <p className="text-muted-foreground mt-0.5">
            Participants: {scheduled.interviewers.join(", ")}
          </p>
        </div>

        <div className="flex items-center gap-2 pt-1">
          <a
            href={scheduled.teams_link}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary transition-colors"
          >
            <Video className="h-3.5 w-3.5" /> Join Teams Meeting
          </a>

          {scheduled.outlook_deeplink && (
            <a
              href={scheduled.outlook_deeplink}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 rounded-lg border border-input bg-background px-2.5 py-1.5 text-xs hover:bg-accent"
            >
              <Calendar className="h-3.5 w-3.5 text-primary" /> Add to Outlook
            </a>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-3.5 text-xs text-foreground shadow-sm">
      <div className="flex items-center justify-between border-b pb-2">
        <div className="flex items-center gap-1.5 font-semibold text-foreground">
          <Calendar className="h-4 w-4 text-primary" />
          <span>Proposed {proposal.interview_type}</span>
        </div>
        <Badge variant="outline" className="text-[11px] bg-secondary/50">
          {proposal.duration_minutes} mins
        </Badge>
      </div>

      <div>
        <p className="text-muted-foreground">
          Candidate: <span className="font-semibold text-foreground">{proposal.candidate_name}</span>
        </p>
        <p className="text-muted-foreground mt-0.5">
          Interviewers:{" "}
          <span className="font-semibold text-foreground">
            {proposal.required_interviewers.join(", ")}
          </span>
        </p>
      </div>

      <div className="space-y-2 pt-1">
        <p className="font-medium text-xs text-muted-foreground">Select Preferred Time Slot:</p>
        {proposal.proposed_slots.map((slot) => {
          const isSelected = selectedSlot?.slot_id === slot.slot_id;
          return (
            <div
              key={slot.slot_id}
              onClick={() => setSelectedSlot(slot)}
              className={`flex items-start justify-between rounded-lg border p-2.5 cursor-pointer transition-all ${
                isSelected
                  ? "border-primary bg-primary/10 font-medium"
                  : "border-input bg-background hover:bg-accent"
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-foreground text-xs">{slot.label}</span>
                  {slot.is_recommended && (
                    <Badge className="h-4 bg-success/15 text-success dark:text-success border-success/30 text-[9px]">
                      Best Fit
                    </Badge>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                  <UserCheck className="h-3 w-3 text-success dark:text-success" />
                  <span>Free: {slot.available_interviewers.join(", ")}</span>
                </div>
              </div>

              {slot.outlook_url && (
                <a
                  href={slot.outlook_url}
                  target="_blank"
                  rel="noreferrer"
                  className="flex items-center gap-1 text-[11px] text-primary hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  Outlook <ExternalLink className="h-3 w-3" />
                </a>
              )}
            </div>
          );
        })}
      </div>

      <Button
        onClick={handleConfirm}
        disabled={confirming || !selectedSlot}
        className="w-full gap-2 bg-success hover:bg-success text-white text-xs font-semibold"
      >
        {confirming ? (
          <>
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Generating Teams Meeting…
          </>
        ) : (
          <>
            <CheckCircle2 className="h-4 w-4" /> Confirm & Book Interview
          </>
        )}
      </Button>
    </div>
  );
}
