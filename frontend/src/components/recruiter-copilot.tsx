/**
 * Dashboard-wide Recruiter Copilot, opened from anywhere in the app shell.
 *
 * This deliberately duplicates the chat-engine shell from components/copilot.tsx
 * (CompareChat) rather than generalizing that component in place. CompareChat's
 * local-answer fast path (answerLocally) is deeply candidate-shortlist-shaped
 * and is exercised today only by compare.tsx; this panel also needs to answer
 * job-level questions (pipeline counts, stage breakdown, internal/external
 * split) with possibly zero candidates selected — a different data shape, not
 * a strict superset. Bolting job-awareness onto that branchy fast path would
 * risk regressing the one chat surface that already works. The trade-off is
 * ~150 lines of intentional UI duplication in exchange for zero changes (and
 * zero regression risk) to the working CompareChat/compare.tsx flow.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { askAgent, getAgentStatus, type AgentCitation } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { CANDIDATES, rankCandidates } from "@/lib/mock-data";
import { getJob, summarizeJobPipeline } from "@/lib/jobs-data";
import { cn } from "@/lib/utils";

const JOB_SUGGESTIONS = [
  "Summarize this job's pipeline",
  "Who should I move to interview next?",
  "What's the biggest skill gap right now?",
  "Who meets every must-have skill?",
];
const CANDIDATE_SUGGESTIONS = [
  "Give me a verdict on this candidate",
  "What must-have skills are they missing?",
  "How do they compare to the rest of the pool?",
];
const COMPARE_SUGGESTIONS = [
  "Compare the selected candidates",
  "Who is the stronger overall fit?",
  "What should I ask in interviews?",
];
const GENERAL_SUGGESTIONS = [
  "Which of my open jobs needs attention?",
  "Which job has the strongest candidate pool?",
  "What should I screen next?",
];

const TOOL_LABEL: Record<string, string> = {
  search_candidates: "Search",
  get_verdicts: "Verdicts",
  compare: "Compare",
  gap_summary: "Skill gaps",
  must_have_report: "Must-haves",
  clarify: "Clarify",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Msg = {
  role: "user" | "assistant";
  text: string;
  source?: string;
  citations?: AgentCitation[];
  tool?: string | null;
};

function buildJobBrief(jobId: string | null | undefined) {
  const job = getJob(jobId);
  if (!job) return null;
  const summary = summarizeJobPipeline(job.id);
  return {
    title: job.title,
    department: job.department,
    location: job.location,
    status: job.status,
    hiring_manager: job.hiringManager,
    pipeline_total: summary.total,
    by_stage: summary.byStage,
    internal_candidates: summary.internalCount,
    external_candidates: summary.externalCount,
    screening_progress_pct: summary.screeningProgressPct,
    average_score: summary.avgScore,
  };
}

function buildCandidatesBrief(ids: string[], blindMode: boolean) {
  if (ids.length === 0) return null;
  const ranked = rankCandidates(CANDIDATES, {
    skills: 40,
    experience: 25,
    education: 15,
    certifications: 10,
    projects: 10,
  });
  return ranked
    .filter((c) => ids.includes(c.id))
    .map((c) => ({
      id: c.id,
      name: blindMode ? `Candidate #${c.rank}` : c.name,
      rank: c.rank,
      overall_score: c.score,
      skill_score: c.categories.skills,
      experience_score: c.categories.experience,
      skills: c.skills,
      missing_skills: c.gaps,
      gaps: c.gaps,
      strengths: c.strengths.join("; "),
    }));
}

export function RecruiterCopilot() {
  const { copilotOpen, closeCopilot, copilotContext, activeJobId, backendReady, blindMode } =
    useAppState();

  const job = getJob(copilotContext?.jobId);
  const candidateIds = copilotContext?.candidateIds ?? [];
  const contextKey = `${copilotContext?.jobId ?? ""}|${candidateIds.join(",")}`;

  const introText = useMemo(() => {
    if (job && candidateIds.length > 0) {
      return `Ready to help with **${job.title}** and ${candidateIds.length} selected candidate${candidateIds.length > 1 ? "s" : ""}. Ask about fit, gaps, or next steps.`;
    }
    if (job) {
      return `Ready to help with **${job.title}**. Ask things like "Summarize this job's pipeline" or "Who should I move to interview next?"`;
    }
    return "Ask me about any of your open jobs, candidate pipelines, or screening priorities.";
  }, [job, candidateIds.length]);

  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", text: introText }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatbotConversationId, setChatbotConversationId] = useState<string | null>(null);
  const [chatSource, setChatSource] = useState<string>("connecting");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setMessages([{ role: "assistant", text: introText }]);
    setSessionId(null);
    setChatbotConversationId(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextKey]);

  useEffect(() => {
    if (!copilotOpen) return;
    getAgentStatus()
      .then((status) => {
        if (status.local_agent) setChatSource("local");
        else setChatSource("offline");
      })
      .catch(() => setChatSource("offline"));
  }, [copilotOpen]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 48), 140)}px`;
  }, [input]);

  async function send(text: string) {
    const query = text.trim();
    if (!query || loading) return;

    setMessages((m) => [...m, { role: "user", text: query }]);
    setInput("");
    setLoading(true);

    const jobBrief = buildJobBrief(copilotContext?.jobId);
    const candidatesBrief = buildCandidatesBrief(candidateIds, blindMode);
    const uuidIds = candidateIds.filter((id) => UUID_RE.test(id));
    const focusNames = (candidatesBrief ?? [])
      .map((c) => c.name)
      .filter((name) => !name.startsWith("Candidate #"));

    try {
      const result = await askAgent({
        query,
        job_id: activeJobId,
        session_id: sessionId,
        chatbot_conversation_id: chatbotConversationId,
        candidate_ids: uuidIds,
        focus_names: focusNames,
        context_candidates: candidatesBrief ?? [],
        job_title: jobBrief?.title ?? job?.title,
        blind_mode: blindMode,
      });

      setSessionId(result.session_id);
      if (result.chatbot_conversation_id) {
        setChatbotConversationId(result.chatbot_conversation_id);
      }
      if (result.source) setChatSource(result.source);

      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: result.response,
          source: result.source,
          citations: result.citations || [],
          tool: result.tool_used,
        },
      ]);
    } catch {
      const fallback = job
        ? `I have ${summarizeJobPipeline(job.id).total} candidates in the pipeline for **${job.title}**. Try asking about pipeline stages, or open a candidate and ask me to compare.`
        : "I couldn't reach the assistant backend just now. Try again in a moment, or ask from a specific job for more local context.";
      setMessages((m) => [...m, { role: "assistant", text: fallback, source: "copilot" }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  const statusLabel =
    chatSource === "fallback"
      ? "Deterministic fallback"
      : chatSource === "local"
        ? "Grounded agent"
        : chatSource === "offline"
          ? "Offline"
          : chatSource === "copilot"
            ? "Recruiter Copilot"
            : chatSource === "chatbot"
              ? "Grounded agent"
              : "Connecting…";

  const suggestions =
    candidateIds.length >= 2
      ? COMPARE_SUGGESTIONS
      : candidateIds.length === 1
        ? CANDIDATE_SUGGESTIONS
        : job
          ? JOB_SUGGESTIONS
          : GENERAL_SUGGESTIONS;

  return (
    <Sheet open={copilotOpen} onOpenChange={(open) => !open && closeCopilot()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 sm:max-w-md">
        <SheetHeader className="border-b pb-4 text-left">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" /> Recruiter Copilot
          </SheetTitle>
          <SheetDescription>
            {statusLabel}
            {!backendReady ? " · API optional" : ""}
            {job ? ` · ${job.title}` : ""}
            {candidateIds.length > 0 ? ` · ${candidateIds.length} selected` : ""}
            {blindMode ? " · Blind review" : ""}
          </SheetDescription>
        </SheetHeader>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto py-4">
          {messages.map((m, i) => (
            <div key={i} className="space-y-1">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                {m.role === "user" ? "You" : "Assistant"}
                {m.role === "assistant" && m.tool && TOOL_LABEL[m.tool] ? (
                  <span className="ml-2 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold normal-case tracking-normal">
                    {TOOL_LABEL[m.tool]}
                  </span>
                ) : null}
              </p>
              <div
                className={cn(
                  "whitespace-pre-wrap text-sm leading-relaxed",
                  m.role === "user" ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {m.text.split("**").map((part, j) =>
                  j % 2 ? (
                    <strong key={j} className="font-semibold text-foreground">
                      {part}
                    </strong>
                  ) : (
                    <span key={j}>{part}</span>
                  ),
                )}
              </div>
              {m.citations && m.citations.length > 0 && (
                <div className="mt-2 rounded-lg border bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
                  <p className="mb-1 font-semibold text-foreground">Resume evidence</p>
                  {m.citations.slice(0, 3).map((c, idx) => (
                    <p key={c.id || idx} className="truncate">
                      {c.title || c.id || "Citation"}
                      {c.snippet ? ` — ${c.snippet.slice(0, 72)}` : ""}
                    </p>
                  ))}
                </div>
              )}
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Thinking…
            </div>
          )}
        </div>

        {messages.length <= 1 && (
          <div className="flex flex-wrap gap-2 border-t pt-3">
            {suggestions.map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => send(s)}
                disabled={loading}
                className="rounded-full border bg-background px-3 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="border-t pt-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(input);
            }}
            className="rounded-2xl border bg-background shadow-sm focus-within:border-primary/50 focus-within:ring-2 focus-within:ring-primary/15"
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              rows={2}
              disabled={loading}
              placeholder={
                job ? `Ask about ${job.title}…` : "e.g. Which of my open jobs needs attention?"
              }
              className="max-h-36 min-h-[48px] w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-sm text-foreground caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <p className="px-1.5 text-[10px] text-muted-foreground">
                Enter to send · Shift+Enter for new line
              </p>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Send message"
                className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          </form>
        </div>
      </SheetContent>
    </Sheet>
  );
}
