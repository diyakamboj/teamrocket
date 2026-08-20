import { useEffect, useState } from "react";
import {
  Calendar as CalendarIcon,
  CheckCircle2,
  Clock,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  UserCheck,
  Video,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import {
  cancelInterview,
  confirmInterview,
  confirmRescheduleInterview,
  getKnownInterviewers,
  listCandidateInterviews,
  proposeInterview,
  rescheduleInterviewPropose,
  type InterviewProposal,
  type ScheduledInterview,
  type TimeSlot,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

interface CandidateInterviewSectionProps {
  candidateId: string;
  candidateName: string;
  candidateEmail?: string | null;
  jobId?: string | null;
  jobTitle?: string | null;
}


export function CandidateInterviewSection({
  candidateId,
  candidateName,
  candidateEmail,
  jobId,
  jobTitle,
}: CandidateInterviewSectionProps) {
  const [interviews, setInterviews] = useState<ScheduledInterview[]>([]);
  const [loading, setLoading] = useState(true);
  const [showScheduleForm, setShowScheduleForm] = useState(false);
  const [durationMinutes, setDurationMinutes] = useState<number>(45);
  const [interviewType, setInterviewType] = useState<string>("Technical Interview");
  // The interviewer roster and their calendars both live server-side.
  const [availableInterviewers, setAvailableInterviewers] = useState<
    { name: string; email: string; title: string }[]
  >([]);
  const [selectedInterviewers, setSelectedInterviewers] = useState<string[]>([]);
  const [notes, setNotes] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    getKnownInterviewers()
      .then((people) => {
        if (cancelled) return;
        setAvailableInterviewers(people);
        setSelectedInterviewers((current) =>
          current.length > 0 ? current : people.slice(0, 2).map((p) => p.name),
        );
      })
      .catch(() => {
        if (!cancelled) setAvailableInterviewers([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const [proposal, setProposal] = useState<InterviewProposal | null>(null);
  const [proposing, setProposing] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<TimeSlot | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Rescheduling state
  const [reschedulingId, setReschedulingId] = useState<string | null>(null);
  const [rescheduleProposal, setRescheduleProposal] = useState<InterviewProposal | null>(null);
  const [selectedRescheduleSlot, setSelectedRescheduleSlot] = useState<TimeSlot | null>(null);
  const [reschedulingSubmit, setReschedulingSubmit] = useState(false);

  // Cancel state
  const [cancelingId, setCancelingId] = useState<string | null>(null);
  const [cancelReason, setCancelReason] = useState<string>("");
  const [cancelingSubmit, setCancelingSubmit] = useState(false);

  const fetchInterviews = async () => {
    try {
      setLoading(true);
      const res = await listCandidateInterviews(candidateId);
      setInterviews(res);
    } catch (err) {
      console.error("Failed to load candidate interviews", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchInterviews();
  }, [candidateId]);

  const toggleInterviewer = (name: string) => {
    setSelectedInterviewers((prev) =>
      prev.includes(name) ? prev.filter((n) => n !== name) : [...prev, name],
    );
  };

  const handlePropose = async () => {
    if (selectedInterviewers.length === 0) {
      toast.error("Please select at least one required interviewer");
      return;
    }
    try {
      setProposing(true);
      const res = await proposeInterview({
        candidate_id: candidateId,
        job_id: jobId ?? null,
        interview_type: interviewType,
        duration_minutes: durationMinutes,
        required_interviewers: selectedInterviewers,
        notes: notes || null,
      });
      setProposal(res);
      setSelectedSlot(res.proposed_slots[0] ?? null);
      toast.success("AI found suitable slots based on interviewer availability!");
    } catch (err: any) {
      toast.error(err.message || "Failed to find interview slots");
    } finally {
      setProposing(false);
    }
  };

  const handleConfirm = async () => {
    if (!proposal || !selectedSlot) return;
    try {
      setConfirming(true);
      await confirmInterview({
        proposal_id: proposal.proposal_id,
        candidate_id: candidateId,
        job_id: jobId ?? null,
        interview_type: proposal.interview_type,
        duration_minutes: proposal.duration_minutes,
        interviewers: proposal.required_interviewers,
        start_time: selectedSlot.start_time,
        end_time: selectedSlot.end_time,
        notes: notes || null,
      });
      toast.success("Interview scheduled! Microsoft Teams link & Outlook calendar event created.");
      setShowScheduleForm(false);
      setProposal(null);
      setSelectedSlot(null);
      void fetchInterviews();
    } catch (err: any) {
      toast.error(err.message || "Failed to confirm interview booking");
    } finally {
      setConfirming(false);
    }
  };

  const handleStartReschedule = async (interviewId: string) => {
    try {
      setReschedulingId(interviewId);
      const res = await rescheduleInterviewPropose(interviewId);
      setRescheduleProposal(res);
      setSelectedRescheduleSlot(res.proposed_slots[0] ?? null);
    } catch (err: any) {
      toast.error(err.message || "Failed to propose reschedule slots");
      setReschedulingId(null);
    }
  };

  const handleConfirmReschedule = async (interviewId: string) => {
    if (!selectedRescheduleSlot) return;
    try {
      setReschedulingSubmit(true);
      await confirmRescheduleInterview(
        interviewId,
        selectedRescheduleSlot.start_time,
        selectedRescheduleSlot.end_time,
      );
      toast.success("Interview rescheduled! Calendar & Teams meeting updated.");
      setReschedulingId(null);
      setRescheduleProposal(null);
      setSelectedRescheduleSlot(null);
      void fetchInterviews();
    } catch (err: any) {
      toast.error(err.message || "Failed to reschedule interview");
    } finally {
      setReschedulingSubmit(false);
    }
  };

  const handleConfirmCancel = async (interviewId: string) => {
    try {
      setCancelingSubmit(true);
      await cancelInterview(interviewId, cancelReason || undefined);
      toast.success("Interview cancelled and notifications sent.");
      setCancelingId(null);
      setCancelReason("");
      void fetchInterviews();
    } catch (err: any) {
      toast.error(err.message || "Failed to cancel interview");
    } finally {
      setCancelingSubmit(false);
    }
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <CalendarIcon className="h-4 w-4 text-primary" />
            Interviews & AI Scheduling
          </CardTitle>
          <CardDescription className="text-xs">
            Coordinate technical loops with Outlook calendar availability & Teams links
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant={showScheduleForm ? "ghost" : "default"}
          onClick={() => {
            setShowScheduleForm(!showScheduleForm);
            setProposal(null);
          }}
          className="h-8 gap-1.5 rounded-lg text-xs"
        >
          {showScheduleForm ? (
            "Close"
          ) : (
            <>
              <Plus className="h-3.5 w-3.5" /> Schedule Interview
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {/* SCHEDULE FORM / PROPOSAL CARD */}
        {showScheduleForm && (
          <div className="space-y-4 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-center justify-between border-b pb-2">
              <h4 className="font-medium text-foreground">AI Scheduling Assistant</h4>
              <Badge variant="outline" className="text-xs bg-background">
                Microsoft Outlook & Teams
              </Badge>
            </div>

            {!proposal ? (
              <div className="space-y-4">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <Label className="text-xs">Interview Type</Label>
                    <select
                      className="mt-1 w-full rounded-md border border-input bg-background px-3 py-1.5 text-xs font-medium focus:outline-none focus:ring-1 focus:ring-primary"
                      value={interviewType}
                      onChange={(e) => setInterviewType(e.target.value)}
                    >
                      <option value="Technical Interview">Technical Interview</option>
                      <option value="Recruiter Screen">Recruiter Screen</option>
                      <option value="System Design Interview">System Design Interview</option>
                      <option value="Hiring Manager Interview">Hiring Manager Interview</option>
                    </select>
                  </div>
                  <div>
                    <Label className="text-xs">Duration</Label>
                    <div className="mt-1 flex gap-2">
                      {[30, 45, 60].map((mins) => (
                        <Button
                          key={mins}
                          type="button"
                          size="sm"
                          variant={durationMinutes === mins ? "default" : "outline"}
                          className="h-8 flex-1 text-xs"
                          onClick={() => setDurationMinutes(mins)}
                        >
                          {mins} mins
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Required Interviewers (Calendar Sync)</Label>
                  <div className="mt-1.5 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {availableInterviewers.map((inv) => {
                      const isSelected = selectedInterviewers.includes(inv.name);
                      return (
                        <button
                          key={inv.name}
                          type="button"
                          onClick={() => toggleInterviewer(inv.name)}
                          className={`flex items-center justify-between rounded-lg border p-2.5 text-left text-xs transition-colors ${
                            isSelected
                              ? "border-primary bg-primary/10 text-foreground font-medium"
                              : "border-input bg-background text-muted-foreground hover:bg-accent"
                          }`}
                        >
                          <div>
                            <p className="font-semibold text-foreground">{inv.name}</p>
                            <p className="text-xs text-muted-foreground">{inv.title}</p>
                          </div>
                          {isSelected && <UserCheck className="h-4 w-4 text-primary shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <Label className="text-xs">Agenda / Notes</Label>
                  <Input
                    placeholder="e.g. Focus on system design and Python coding"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="mt-1 h-8 text-xs"
                  />
                </div>

                <Button
                  onClick={handlePropose}
                  disabled={proposing}
                  className="w-full gap-2 text-xs font-semibold"
                >
                  {proposing ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Checking Outlook Calendars…
                    </>
                  ) : (
                    <>
                      <Clock className="h-4 w-4" /> Find Suitable Times via AI
                    </>
                  )}
                </Button>
              </div>
            ) : (
              /* PROPOSED SLOTS SELECTION */
              <div className="space-y-4">
                <div className="rounded-lg bg-background p-3 border border-border">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold">
                      Proposed Times for {proposal.interview_type} ({proposal.duration_minutes}m)
                    </p>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 text-xs text-muted-foreground"
                      onClick={() => setProposal(null)}
                    >
                      Change parameters
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Required participants: {proposal.required_interviewers.join(", ")}
                  </p>
                </div>

                <RadioGroup
                  value={selectedSlot?.slot_id ?? null}
                  onValueChange={(id) => {
                    const slot = proposal.proposed_slots.find((s) => s.slot_id === id);
                    if (slot) setSelectedSlot(slot);
                  }}
                  className="space-y-2"
                >
                  {proposal.proposed_slots.map((slot) => (
                    <label
                      key={slot.slot_id}
                      className={`flex items-start justify-between rounded-xl border p-3 cursor-pointer transition-all ${
                        selectedSlot?.slot_id === slot.slot_id
                          ? "border-primary bg-primary/10 shadow-sm"
                          : "border-input bg-background hover:bg-accent"
                      }`}
                    >
                      <div className="flex items-start gap-3">
                        <RadioGroupItem value={slot.slot_id} className="mt-0.5" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-xs text-foreground">
                              {slot.label}
                            </span>
                            {slot.is_recommended && (
                              <Badge className="h-4 bg-success/15 text-success dark:text-success border-success/30 text-[11px]">
                                Recommended
                              </Badge>
                            )}
                          </div>
                          <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <UserCheck className="h-3 w-3 text-success dark:text-success" />
                            <span>Interviewers free: {slot.available_interviewers.join(", ")}</span>
                          </div>
                        </div>
                      </div>
                      {slot.outlook_url && (
                        <a
                          href={slot.outlook_url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-primary hover:underline shrink-0"
                          onClick={(e) => e.stopPropagation()}
                        >
                          Outlook <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </label>
                  ))}
                </RadioGroup>

                <div className="flex items-center gap-2 pt-2">
                  <Button
                    onClick={handleConfirm}
                    disabled={confirming || !selectedSlot}
                    className="flex-1 gap-2 bg-success hover:bg-success text-xs font-semibold text-white"
                  >
                    {confirming ? (
                      <>
                        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Creating Teams Link…
                      </>
                    ) : (
                      <>
                        <CheckCircle2 className="h-4 w-4" /> Confirm & Book Interview
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setProposal(null)}
                    className="text-xs"
                  >
                    Back
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* SCHEDULED INTERVIEWS LIST */}
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading interviews…
          </div>
        ) : interviews.length === 0 ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            No interviews scheduled yet for this candidate.
          </div>
        ) : (
          <div className="space-y-3">
            {interviews.map((item) => (
              <div
                key={item.id}
                className="rounded-xl border border-border bg-card p-3.5 transition-shadow hover:shadow-sm"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm text-foreground">
                        {item.interview_type}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[11px] ${
                          item.status === "confirmed"
                            ? "bg-success/10 text-success dark:text-success border-success/30"
                            : item.status === "rescheduled"
                            ? "bg-primary/10 text-primary dark:text-primary border-primary/30"
                            : "bg-destructive/10 text-destructive dark:text-destructive border-destructive/30"
                        }`}
                      >
                        {item.status.toUpperCase()}
                      </Badge>
                    </div>
                    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3.5 w-3.5 text-primary" />
                      <span>
                        {new Date(item.start_time).toLocaleString(undefined, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}{" "}
                        ({item.duration_minutes} mins)
                      </span>
                    </div>
                  </div>

                  {/* TEAMS JOIN LINK */}
                  {item.status !== "cancelled" && item.teams_link && (
                    <a
                      href={item.teams_link}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-white shadow-sm hover:bg-primary transition-colors shrink-0"
                    >
                      <Video className="h-3.5 w-3.5" /> Join Teams Meeting
                    </a>
                  )}
                </div>

                <div className="mt-2 text-xs text-muted-foreground">
                  <p>
                    <span className="font-medium text-foreground">Interviewers:</span>{" "}
                    {item.interviewers.join(", ")}
                  </p>
                  {item.teams_meeting_id && (
                    <p className="mt-0.5 text-xs">
                      Meeting ID: <span className="font-mono">{item.teams_meeting_id}</span> | Passcode:{" "}
                      <span className="font-mono">{item.teams_passcode}</span>
                    </p>
                  )}
                </div>

                {/* RESCHEDULE OR CANCEL CONTROLS */}
                {item.status !== "cancelled" && (
                  <div className="mt-3 flex items-center justify-between border-t pt-2.5">
                    {item.outlook_deeplink && (
                      <a
                        href={item.outlook_deeplink}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                      >
                        <CalendarIcon className="h-3 w-3" /> Outlook Calendar Deeplink
                      </a>
                    )}

                    <div className="flex items-center gap-2 ml-auto">
                      {reschedulingId === item.id ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          {rescheduleProposal ? (
                            <select
                              className="rounded border bg-background px-2 py-1 text-xs"
                              onChange={(e) => {
                                const s = rescheduleProposal.proposed_slots.find(
                                  (slot) => slot.slot_id === e.target.value,
                                );
                                if (s) setSelectedRescheduleSlot(s);
                              }}
                            >
                              {rescheduleProposal.proposed_slots.map((s) => (
                                <option key={s.slot_id} value={s.slot_id}>
                                  {s.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-muted-foreground">Finding slots…</span>
                          )}
                          <Button
                            size="sm"
                            className="h-7 text-xs bg-primary hover:bg-primary"
                            disabled={reschedulingSubmit || !selectedRescheduleSlot}
                            onClick={() => handleConfirmReschedule(item.id)}
                          >
                            Save
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setReschedulingId(null)}
                          >
                            Cancel
                          </Button>
                        </div>
                      ) : cancelingId === item.id ? (
                        <div className="flex items-center gap-1.5 text-xs">
                          <Input
                            placeholder="Reason (optional)"
                            value={cancelReason}
                            onChange={(e) => setCancelReason(e.target.value)}
                            className="h-7 w-40 text-xs"
                          />
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 text-xs"
                            disabled={cancelingSubmit}
                            onClick={() => handleConfirmCancel(item.id)}
                          >
                            Confirm Cancel
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 text-xs"
                            onClick={() => setCancelingId(null)}
                          >
                            Back
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 gap-1 text-xs"
                            onClick={() => void handleStartReschedule(item.id)}
                          >
                            <RefreshCw className="h-3 w-3" /> Reschedule
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-7 gap-1 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                            onClick={() => setCancelingId(item.id)}
                          >
                            <XCircle className="h-3 w-3" /> Cancel
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
