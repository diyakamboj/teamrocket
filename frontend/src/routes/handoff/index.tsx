import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  CheckCircle2,
  Clock,
  Copy,
  History,
  Loader2,
  Mail,
  Search,
  Send,
  UserCheck,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MiniBar, ScoreRing } from "@/components/score-ring";
import { useAppState } from "@/lib/app-state";
import { DEFAULT_WEIGHTS, rankCandidates, type Candidate } from "@/lib/candidates";
import { useCandidatePool } from "@/lib/use-candidate-pool";
import {
  API_BASE,
  createHandoff,
  getCandidateHistory,
  listHandoffsForCandidate,
  listJobs,
  type HistoryEvent,
  type InterviewHandoffRecord,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/handoff/")({
  head: () => ({
    meta: [
      { title: "Interview Handoff & Historical Data — ResumeIQ" },
      {
        name: "description",
        content:
          "Centralized evaluation history per candidate and one-click briefing handoffs to technical interviewers.",
      },
      { property: "og:title", content: "Interview Handoff & Historical Data — ResumeIQ" },
      {
        property: "og:description",
        content: "Track candidate evaluation history and hand off briefings to interviewers.",
      },
    ],
  }),
  component: InterviewHandoffPage,
});

const EVENT_LABEL: Record<string, string> = {
  evaluation_created: "Evaluation created",
  evaluation_updated: "Re-scored",
  decision_approved: "Candidate approved",
  decision_rejected: "Candidate rejected",
  blind_review_toggled: "Blind review toggled",
  handoff_created: "Briefing handed off",
  handoff_viewed: "Briefing viewed",
  handoff_acknowledged: "Briefing acknowledged",
};

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(`${iso}Z`.replace("ZZ", "Z")).getTime();
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function statusBadge(status: InterviewHandoffRecord["status"]) {
  if (status === "acknowledged") {
    return (
      <Badge className="gap-1 border-transparent bg-success/10 text-success dark:bg-success/15 dark:text-success">
        <CheckCircle2 className="h-3 w-3" /> Acknowledged
      </Badge>
    );
  }
  if (status === "viewed") {
    return (
      <Badge className="gap-1 border-transparent bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary">
        <UserCheck className="h-3 w-3" /> Viewed
      </Badge>
    );
  }
  return (
    <Badge variant="secondary" className="gap-1">
      <Clock className="h-3 w-3" /> Pending
    </Badge>
  );
}

function InterviewHandoffPage() {
  const { weights, activeJobId, setViewingCandidateId } = useAppState();
  const { candidates: pool } = useCandidatePool();
  const ranked = useMemo(
    () => rankCandidates(pool, weights || DEFAULT_WEIGHTS),
    [pool, weights],
  );
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(ranked[0]?.id ?? null);
  const [jobTitle, setJobTitle] = useState<string | null>(null);

  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [handoffs, setHandoffs] = useState<InterviewHandoffRecord[]>([]);

  const [interviewerName, setInterviewerName] = useState("");
  const [interviewerEmail, setInterviewerEmail] = useState("");
  const [recruiterNotes, setRecruiterNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const filtered = useMemo(
    () =>
      query.trim() === ""
        ? ranked.slice(0, 40)
        : ranked.filter(
            (c) =>
              c.name.toLowerCase().includes(query.toLowerCase()) ||
              c.title.toLowerCase().includes(query.toLowerCase()),
          ),
    [ranked, query],
  );

  const selected: Candidate | undefined = ranked.find((c) => c.id === selectedId);

  useEffect(() => {
    listJobs()
      .then((jobs) => {
        const match = jobs.find((j) => j.id === activeJobId);
        setJobTitle(match?.title ?? null);
      })
      .catch(() => setJobTitle(null));
  }, [activeJobId]);

  async function loadCandidateData(candidateId: string) {
    setHistoryLoading(true);
    try {
      const [historyRows, handoffRows] = await Promise.all([
        getCandidateHistory(candidateId),
        listHandoffsForCandidate(candidateId),
      ]);
      setHistory(historyRows);
      setHandoffs(handoffRows);
    } catch {
      setHistory([]);
      setHandoffs([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  useEffect(() => {
    if (selectedId) void loadCandidateData(selectedId);
  }, [selectedId]);

  useEffect(() => {
    setViewingCandidateId(selectedId);
  }, [selectedId, setViewingCandidateId]);

  async function handleCreateHandoff() {
    if (!selected) return;
    if (!interviewerName.trim() || !interviewerEmail.trim()) {
      toast.error("Interviewer name and email are required");
      return;
    }
    setSubmitting(true);
    try {
      const handoff = await createHandoff({
        candidate_id: selected.id,
        candidate_name: selected.name,
        candidate_email: selected.email,
        job_id: activeJobId,
        job_title: jobTitle ?? selected.title,
        interviewer_name: interviewerName.trim(),
        interviewer_email: interviewerEmail.trim(),
        recruiter_notes: recruiterNotes.trim() || undefined,
        scorecard: {
          overall_score: selected.score,
          skill_score: selected.categories.skills,
          experience_score: selected.categories.experience,
          education_score: selected.categories.education,
          certification_score: selected.categories.certifications,
          project_score: selected.categories.projects,
        },
        matched_skills: selected.skills,
        missing_skills: selected.gaps,
        strengths: selected.strengths.join("; "),
        weaknesses: selected.gaps.join("; "),
        transferable_skills: selected.transferable.join("; "),
        evidence_highlights: selected.evidence.map((e) => `${e.skill}: ${e.detail} (${e.source})`),
      });
      toast.success(
        `Briefing handed off to ${handoff.interviewer_name}${
          handoff.email_source === "mock"
            ? " (email logged — SMTP not configured)"
            : " — email sent"
        }`,
      );
      setInterviewerName("");
      setInterviewerEmail("");
      setRecruiterNotes("");
      void loadCandidateData(selected.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create handoff");
    } finally {
      setSubmitting(false);
    }
  }

  function copyLink(handoffId: string) {
    const link = `${window.location.origin}/handoff/${handoffId}`;
    void navigator.clipboard.writeText(link);
    toast.success("Briefing link copied");
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold sm:text-3xl">Interview Handoff & Historical Data</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Centralized evaluation history per candidate, plus one-click briefing handoffs for
          technical interviewers.
        </p>
        {!API_BASE && (
          <p className="mt-1 text-xs text-muted-foreground">
            Set VITE_API_BASE_URL to connect the backend for history and handoffs.
          </p>
        )}
      </header>

      <div className="grid gap-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="card-surface h-fit space-y-3 p-4 lg:sticky lg:top-24">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search candidates"
              className="rounded-xl pl-9"
            />
          </div>
          <div className="max-h-[520px] space-y-1 overflow-y-auto pr-1">
            {filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedId(c.id)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm transition-colors",
                  selectedId === c.id
                    ? "bg-primary-soft text-primary-soft-foreground"
                    : "hover:bg-secondary",
                )}
              >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-secondary text-xs font-bold">
                  {c.initials}
                </span>
                <span className="min-w-0">
                  <p className="truncate font-semibold">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.title}</p>
                </span>
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-6 text-center text-xs text-muted-foreground">No matches.</p>
            )}
          </div>
        </aside>

        {!selected ? (
          <div className="card-surface p-10 text-center text-sm text-muted-foreground">
            Pick a candidate to view their history and create a handoff.
          </div>
        ) : (
          <div className="min-w-0 space-y-6">
            <div className="card-surface flex flex-wrap items-center gap-4 p-5">
              <ScoreRing value={selected.score} size={56} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-lg font-bold">{selected.name}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {selected.title} · {selected.years} yrs · {selected.location}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1.5 sm:grid-cols-3">
                <MiniBar label="Skills" value={selected.categories.skills} />
                <MiniBar label="Experience" value={selected.categories.experience} />
                <MiniBar label="Education" value={selected.categories.education} />
              </div>
            </div>

            <div className="grid gap-6 xl:grid-cols-2">
              <section className="card-surface space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <History className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-bold">Evaluation history</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Centralized log — every re-score, decision, and handoff event for this candidate,
                  newest first.
                </p>

                {historyLoading ? (
                  <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading history…
                  </div>
                ) : history.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No history yet — actions on this candidate will appear here.
                  </p>
                ) : (
                  <ol className="space-y-3 border-l pl-4">
                    {history.map((event) => (
                      <li key={event.id} className="relative">
                        <span className="absolute -left-[21px] top-1.5 h-2 w-2 rounded-full bg-primary" />
                        <p className="text-sm font-semibold">
                          {EVENT_LABEL[event.event_type] ?? event.event_type}
                        </p>
                        {event.summary && (
                          <p className="text-xs text-muted-foreground">{event.summary}</p>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {timeAgo(event.created_at)}
                          {event.actor_email ? ` · ${event.actor_email}` : ""}
                        </p>
                      </li>
                    ))}
                  </ol>
                )}
              </section>

              <section className="card-surface space-y-4 p-5">
                <div className="flex items-center gap-2">
                  <Send className="h-4 w-4 text-muted-foreground" />
                  <h2 className="text-base font-bold">Hand off briefing to interviewer</h2>
                </div>
                <p className="text-xs text-muted-foreground">
                  Sends a candidate summary (scorecard, strengths, gaps, suggested focus areas) to a
                  technical interviewer with a trackable link.
                </p>

                <div className="space-y-3">
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Interviewer name
                    </label>
                    <Input
                      value={interviewerName}
                      onChange={(e) => setInterviewerName(e.target.value)}
                      placeholder="Jordan Lee"
                      className="rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Interviewer email
                    </label>
                    <Input
                      type="email"
                      value={interviewerEmail}
                      onChange={(e) => setInterviewerEmail(e.target.value)}
                      placeholder="jordan.lee@company.com"
                      className="rounded-xl"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-semibold text-muted-foreground">
                      Notes for the interviewer (optional)
                    </label>
                    <Textarea
                      value={recruiterNotes}
                      onChange={(e) => setRecruiterNotes(e.target.value)}
                      placeholder="Focus round 2 on system design; comp expectations already aligned."
                      className="rounded-xl"
                      rows={3}
                    />
                  </div>
                  <Button
                    onClick={() => void handleCreateHandoff()}
                    disabled={submitting}
                    className="w-full rounded-xl"
                  >
                    {submitting ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Mail className="mr-2 h-4 w-4" />
                    )}
                    Send briefing
                  </Button>
                </div>

                <div className="space-y-2 border-t pt-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    Past handoffs
                  </p>
                  {handoffs.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No handoffs sent yet.</p>
                  ) : (
                    handoffs.map((h) => (
                      <div
                        key={h.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"
                      >
                        <div className="min-w-0">
                          <p className="truncate font-semibold">{h.interviewer_name}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {h.interviewer_email} · {timeAgo(h.created_at)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {statusBadge(h.status)}
                          <button
                            onClick={() => copyLink(h.id)}
                            aria-label="Copy briefing link"
                            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </section>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
