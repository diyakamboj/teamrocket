import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, ClipboardCheck, Loader2, SkipForward, Square } from "lucide-react";
import { toast } from "sonner";
import {
  answerScreeningQuestion,
  completeScreening,
  getScreeningSession,
  listScreeningSessions,
  skipScreeningQuestion,
  startScreening,
  API_BASE,
  type ScreeningBriefing,
  type ScreeningSession,
} from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { CANDIDATES, rankCandidates, type Candidate } from "@/lib/mock-data";
import {
  BriefingPanel,
  Citations,
  competencyLabel,
  RatingChip,
  ScorecardPanel,
  ScreeningProgress,
} from "@/components/screening";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Search = { candidate?: string | undefined; session?: string | undefined };

export const Route = createFileRoute("/screening")({
  validateSearch: (search: Record<string, unknown>): Search => ({
    candidate: typeof search["candidate"] === "string" ? search["candidate"] : undefined,
    session: typeof search["session"] === "string" ? search["session"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "L1 Screening — ResumeIQ" },
      {
        name: "description",
        content:
          "Run an interactive Level 1 preliminary screening: role-specific questions, scored responses, and a pre-interview briefing.",
      },
      { property: "og:title", content: "L1 Screening — ResumeIQ" },
      {
        property: "og:description",
        content: "Agent-led preliminary screening with scored responses and interviewer briefing.",
      },
    ],
  }),
  component: Screening,
});

function hasBriefing(session: ScreeningSession | null): session is ScreeningSession & {
  briefing: ScreeningBriefing;
} {
  return Boolean(session && (session.briefing as ScreeningBriefing)?.summary);
}

function CandidatePicker({ onPick }: { onPick: (c: Candidate) => void }) {
  const { weights } = useAppState();
  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights).slice(0, 8), [weights]);

  return (
    <div className="card-surface p-6">
      <h2 className="text-base font-bold">Pick a candidate to screen</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        The agent reads their profile, the role requirements and any existing evaluation before it
        writes the questions.
      </p>
      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {ranked.map((c) => (
          <button
            key={c.id}
            onClick={() => onPick(c)}
            className="flex items-center gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-secondary/50"
          >
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-foreground">
              {c.initials}
            </span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold">{c.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                #{c.rank} · {c.title} · {c.years} yrs · match {c.score}
              </span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Screening() {
  const { candidate: candidateId, session: sessionParam } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const { weights, activeJobId, backendReady } = useAppState();

  const [session, setSession] = useState<ScreeningSession | null>(null);
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [starting, setStarting] = useState(false);
  const [priorSessions, setPriorSessions] = useState<{ session_id: string; status: string }[]>([]);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);
  const candidate = useMemo(
    () => ranked.find((c) => c.id === candidateId) ?? null,
    [ranked, candidateId],
  );

  // Resume by session id so a reload (or a link from the Copilot) picks the
  // conversation back up exactly where it stopped.
  useEffect(() => {
    if (!sessionParam) return;
    let cancelled = false;
    getScreeningSession(sessionParam)
      .then((s) => {
        if (!cancelled) setSession(s);
      })
      .catch(() => {
        if (!cancelled) toast.error("Could not load that screening session");
      });
    return () => {
      cancelled = true;
    };
  }, [sessionParam]);

  useEffect(() => {
    if (!candidateId || sessionParam) return;
    let cancelled = false;
    listScreeningSessions(candidateId)
      .then((rows) => {
        if (!cancelled) setPriorSessions(rows);
      })
      .catch(() => {
        if (!cancelled) setPriorSessions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId, sessionParam]);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [session]);

  const applySession = useCallback(
    (next: ScreeningSession) => {
      setSession(next);
      void navigate({
        search: (prev: Search) => ({ ...prev, session: next.session_id }),
        replace: true,
      });
    },
    [navigate],
  );

  async function start(target: Candidate) {
    if (!activeJobId) {
      toast.error("Screening needs the screening API — start the backend and reload.");
      return;
    }
    setStarting(true);
    try {
      const next = await startScreening({
        job_id: activeJobId,
        candidate: {
          id: target.id,
          name: target.name,
          title: target.title,
          years: target.years,
          score: target.score,
          education: target.education,
          skills: target.skills,
          certifications: target.certifications.map((c) => c.name),
          strengths: target.strengths,
          gaps: target.gaps,
          evidence: target.evidence,
        },
        question_count: 6,
      });
      applySession(next);
      toast.success(
        `Screening started — ${next.question_count} questions for ${next.candidate_name}`,
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not start screening");
    } finally {
      setStarting(false);
    }
  }

  async function send() {
    const text = answer.trim();
    if (!text || !session || busy) return;
    setBusy(true);
    try {
      const next = await answerScreeningQuestion(session.session_id, text);
      setAnswer("");
      applySession(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record that answer");
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  async function runAction(action: "skip" | "finish") {
    if (!session || busy) return;
    setBusy(true);
    try {
      const next =
        action === "skip"
          ? await skipScreeningQuestion(session.session_id)
          : await completeScreening(session.session_id);
      applySession(next);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const current = session?.current_question ?? null;
  const completed = session?.status === "completed";

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">L1 Preliminary Screening</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {session
              ? `${session.candidate_name} · ${session.job_title ?? "role"} · ${session.status.replace("_", " ")}`
              : "Agent-led first-round screening with scored answers and an interviewer briefing"}
          </p>
        </div>
        {session && !completed && (
          <Button
            variant="outline"
            className="shrink-0 rounded-xl"
            disabled={busy}
            onClick={() => void runAction("finish")}
          >
            <Square className="mr-2 h-3.5 w-3.5" /> End & brief
          </Button>
        )}
      </header>

      {!backendReady && (
        <div className="card-surface border-amber-300/60 p-4 text-sm text-muted-foreground">
          The screening API is not reachable at{" "}
          <code className="font-mono text-xs">{API_BASE || window.location.origin}</code>. Start the
          backend there (or point <code className="font-mono text-xs">VITE_API_BASE_URL</code> at
          it) — screening runs server-side so answers are scored and stored against the candidate's
          evaluation.
        </div>
      )}

      {!session && !candidate && <CandidatePicker onPick={(c) => void start(c)} />}

      {!session && candidate && (
        <div className="card-surface p-6">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-primary-soft text-sm font-bold text-primary-soft-foreground">
              {candidate.initials}
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-base font-bold">{candidate.name}</p>
              <p className="truncate text-xs text-muted-foreground">
                {candidate.title} · {candidate.years} yrs · match {candidate.score} ·{" "}
                {candidate.skills.join(", ")}
              </p>
            </div>
            <Button
              className="rounded-xl"
              disabled={starting || !activeJobId}
              onClick={() => void start(candidate)}
            >
              {starting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Generating questions…
                </>
              ) : (
                <>
                  <ClipboardCheck className="mr-2 h-4 w-4" /> Start screening
                </>
              )}
            </Button>
          </div>
          {priorSessions.length > 0 && (
            <p className="mt-4 text-xs text-muted-foreground">
              {priorSessions.length} earlier screening
              {priorSessions.length > 1 ? "s" : ""} for this candidate —{" "}
              <button
                className="font-semibold text-primary hover:underline"
                onClick={() =>
                  void navigate({
                    search: (prev: Search) => ({
                      ...prev,
                      session: priorSessions[0]!.session_id,
                    }),
                  })
                }
              >
                open the most recent
              </button>
              .
            </p>
          )}
        </div>
      )}

      {session && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div className="min-w-0 space-y-4">
            <div className="card-surface flex max-h-[560px] flex-col overflow-hidden">
              <div ref={transcriptRef} className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
                {session.turns.map((turn) => (
                  <div key={turn.question_id} className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {competencyLabel(turn.competency)}
                      </span>
                      {turn.citations && <Citations citations={turn.citations} />}
                    </div>
                    <p className="text-sm font-semibold">{turn.question}</p>
                    {turn.answer ? (
                      <p className="whitespace-pre-wrap rounded-xl bg-secondary/50 px-3 py-2 text-sm text-muted-foreground">
                        {turn.answer}
                      </p>
                    ) : (
                      <p className="text-xs italic text-muted-foreground">
                        {turn.skipped ? "Skipped" : "Not answered"}
                      </p>
                    )}
                    {turn.evaluation && (
                      <div className="flex flex-wrap items-center gap-2">
                        <RatingChip score={turn.evaluation.score} rating={turn.evaluation.rating} />
                        <span className="text-[11px] text-muted-foreground">
                          coverage {Math.round(turn.evaluation.coverage)} · depth{" "}
                          {Math.round(turn.evaluation.depth)} · clarity{" "}
                          {Math.round(turn.evaluation.clarity)}
                        </span>
                        <Citations citations={turn.evaluation.citations} label="Evidence" />
                        {turn.evaluation.notes.length > 0 && (
                          <p className="w-full text-xs text-muted-foreground">
                            {turn.evaluation.notes.join(" ")}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {current && (
                  <div className="space-y-2 rounded-xl border border-primary/30 bg-primary-soft/40 p-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-background px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                        {competencyLabel(current.competency)}
                      </span>
                      <Citations citations={current.citations} />
                    </div>
                    <p className="text-sm font-semibold">{current.question}</p>
                    {current.rationale && (
                      <p className="text-xs text-muted-foreground">{current.rationale}</p>
                    )}
                    {current.criteria.length > 0 && (
                      <ul className="mt-1 space-y-0.5">
                        {current.criteria.map((c) => (
                          <li key={c} className="text-[11px] text-muted-foreground">
                            • Looking for: {c}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>

              {!completed && (
                <div className="space-y-2 border-t p-3">
                  <ScreeningProgress session={session} />
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                    className="rounded-2xl border bg-background focus-within:border-primary/50"
                  >
                    <textarea
                      ref={inputRef}
                      value={answer}
                      onChange={(e) => setAnswer(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                      rows={3}
                      disabled={busy}
                      placeholder="Type the candidate's answer…"
                      className="max-h-40 min-h-[72px] w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
                    />
                    <div className="flex items-center justify-between gap-2 px-2 pb-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="rounded-xl text-xs"
                        disabled={busy}
                        onClick={() => void runAction("skip")}
                      >
                        <SkipForward className="mr-1.5 h-3.5 w-3.5" /> Skip
                      </Button>
                      <button
                        type="submit"
                        disabled={busy || !answer.trim()}
                        aria-label="Submit answer"
                        className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
                      >
                        {busy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <ArrowUp className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              )}
            </div>

            {hasBriefing(session) && (
              <div className="card-surface p-6">
                <BriefingPanel briefing={session.briefing} />
              </div>
            )}
          </div>

          <aside className="card-surface h-fit space-y-4 p-5 lg:sticky lg:top-24">
            <div>
              <h2 className="text-base font-bold">Live scorecard</h2>
              <p className="text-xs text-muted-foreground">
                {session.answered_count} of {session.question_count} answered
              </p>
            </div>
            <ScorecardPanel session={session} />
            {completed && (
              <div className="space-y-2 border-t pt-4">
                <p className="text-xs text-muted-foreground">
                  {session.evaluation_id
                    ? "Results were written back to this candidate's evaluation as screening evidence."
                    : "This candidate has no backend evaluation record, so results live on the session only."}
                </p>
                <Link
                  to="/candidates"
                  className={cn(
                    "inline-flex w-full items-center justify-center rounded-xl border px-3 py-2 text-xs font-semibold",
                    "hover:bg-secondary",
                  )}
                >
                  Back to ranking
                </Link>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
