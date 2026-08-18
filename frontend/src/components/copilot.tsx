import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowUp, Loader2, Sparkles } from "lucide-react";
import { askAgent, getAgentStatus, type AgentCitation } from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import type { Candidate } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Which candidate has more experience?",
  "Who is the strongest overall fit?",
  "Compare their skill gaps side by side",
  "What should I ask in interviews?",
];

type Msg = {
  role: "user" | "assistant";
  text: string;
  source?: string;
  citations?: AgentCitation[];
};

export type CompareChatCandidate = Pick<
  Candidate,
  | "id"
  | "name"
  | "rank"
  | "title"
  | "years"
  | "level"
  | "education"
  | "score"
  | "categories"
  | "skills"
  | "strengths"
  | "gaps"
>;

type CompareChatProps = {
  candidates: CompareChatCandidate[];
  blindMode?: boolean;
  className?: string;
};

function displayName(c: CompareChatCandidate, blindMode: boolean) {
  return blindMode ? `Candidate #${c.rank}` : c.name;
}

function buildCandidateBrief(candidates: CompareChatCandidate[], blindMode: boolean) {
  return candidates.map((c) => ({
    id: c.id,
    name: displayName(c, blindMode),
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

/** Answer common comparison questions from the selected shortlist. */
function answerLocally(
  query: string,
  candidates: CompareChatCandidate[],
  blindMode: boolean,
): string | null {
  if (candidates.length === 0) {
    return "Add 2–3 candidates from Ranking first, then I can compare experience, skills, and fit.";
  }

  const lower = query.toLowerCase();
  const label = (c: CompareChatCandidate) => displayName(c, blindMode);

  const byYears = [...candidates].sort((a, b) => b.years - a.years);
  const byScore = [...candidates].sort((a, b) => b.score - a.score);
  const bySkills = [...candidates].sort((a, b) => b.categories.skills - a.categories.skills);
  const byExpScore = [...candidates].sort(
    (a, b) => b.categories.experience - a.categories.experience,
  );

  if (
    lower.includes("experience") ||
    lower.includes("expirence") ||
    lower.includes("years") ||
    lower.includes("senior")
  ) {
    const top = byYears[0]!;
    const lines = byYears.map(
      (c) =>
        `- **${label(c)}**: ${c.years} years (${c.level}) · experience score ${c.categories.experience}`,
    );
    return `**${label(top)}** has the most experience with **${top.years} years** (${top.level}).\n\n${lines.join("\n")}`;
  }

  if (lower.includes("skill")) {
    if (lower.includes("gap")) {
      return candidates
        .map((c) => `**${label(c)}** gaps:\n${c.gaps.map((g) => `  • ${g}`).join("\n")}`)
        .join("\n\n");
    }
    const top = bySkills[0]!;
    const lines = bySkills.map(
      (c) => `- **${label(c)}**: skills score ${c.categories.skills} · ${c.skills.join(", ")}`,
    );
    return `**${label(top)}** leads on skills coverage (score ${top.categories.skills}).\n\n${lines.join("\n")}`;
  }

  if (
    lower.includes("strongest") ||
    lower.includes("best fit") ||
    lower.includes("overall") ||
    lower.includes("who should") ||
    lower.includes("recommend")
  ) {
    const top = byScore[0]!;
    const lines = byScore.map(
      (c) => `- **#${c.rank} ${label(c)}** — overall ${c.score} · ${c.years} yrs · ${c.title}`,
    );
    return `**${label(top)}** is the strongest overall fit at **${top.score}**.\n\n${lines.join("\n")}\n\nMain trade-off for ${label(top)}: ${top.gaps[0] ?? "none noted"}.`;
  }

  if (lower.includes("interview") || lower.includes("ask")) {
    return candidates
      .map((c) => {
        const focus = c.gaps[0] ?? "depth of recent ownership";
        return `**${label(c)}** — probe: ${focus}. Also ask about ${c.skills[0] ?? "their strongest stack"} in production.`;
      })
      .join("\n\n");
  }

  if (lower.includes("education") || lower.includes("degree")) {
    return candidates
      .map((c) => `- **${label(c)}**: ${c.education} (education score ${c.categories.education})`)
      .join("\n");
  }

  if (lower.includes("certif")) {
    const lines = [...candidates]
      .sort((a, b) => b.categories.certifications - a.categories.certifications)
      .map((c) => `- **${label(c)}**: certification score ${c.categories.certifications}`);
    return `Certification strength on this shortlist:\n\n${lines.join("\n")}`;
  }

  if (lower.includes("compare") || lower.includes("trade") || lower.includes("difference")) {
    return candidates
      .map((c) => {
        return (
          `**${label(c)}** (${c.score})\n` +
          `• Experience: ${c.years} yrs · score ${c.categories.experience}\n` +
          `• Skills: ${c.skills.join(", ")}\n` +
          `• Strength: ${c.strengths[0]}\n` +
          `• Gap: ${c.gaps[0]}`
        );
      })
      .join("\n\n");
  }

  // Soft match: if user mentions a candidate name, summarize them
  const mentioned = candidates.find((c) => lower.includes(c.name.split(" ")[0]!.toLowerCase()));
  if (mentioned) {
    return (
      `**${label(mentioned)}** ranks #${mentioned.rank} with score ${mentioned.score}.\n` +
      `• ${mentioned.years} years experience (${mentioned.level})\n` +
      `• Skills: ${mentioned.skills.join(", ")}\n` +
      `• Strength: ${mentioned.strengths[0]}\n` +
      `• Gap: ${mentioned.gaps[0]}`
    );
  }

  return null;
}

export function CompareChat({ candidates, blindMode = false, className }: CompareChatProps) {
  const { activeJobId, backendReady } = useAppState();
  const names = useMemo(
    () => candidates.map((c) => displayName(c, blindMode)),
    [candidates, blindMode],
  );

  const intro =
    candidates.length > 0
      ? `Ready to compare **${names.join("**, **")}**. Ask things like “Which candidate has more experience?” or “Who is the best fit?”`
      : "Select 2–3 candidates from Ranking, then ask comparison questions here.";

  const [messages, setMessages] = useState<Msg[]>([{ role: "assistant", text: intro }]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [chatbotConversationId, setChatbotConversationId] = useState<string | null>(null);
  const [chatSource, setChatSource] = useState<string>("connecting");
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const namesKey = names.join("|");

  useEffect(() => {
    setMessages([{ role: "assistant", text: intro }]);
    setSessionId(null);
    setChatbotConversationId(null);
    // Reset thread when the compared shortlist changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [namesKey]);

  useEffect(() => {
    getAgentStatus()
      .then((status) => {
        if (status.local_agent) setChatSource("local");
        else setChatSource("offline");
      })
      .catch(() => setChatSource("offline"));
  }, []);

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

    const local = answerLocally(query, candidates, blindMode);
    if (local) {
      setMessages((m) => [...m, { role: "assistant", text: local, source: "compare" }]);
      setChatSource("compare");
      setLoading(false);
      textareaRef.current?.focus();
      return;
    }

    const brief = buildCandidateBrief(candidates, blindMode);

    try {
      const result = await askAgent({
        query,
        job_id: activeJobId,
        session_id: sessionId,
        chatbot_conversation_id: chatbotConversationId,
        candidate_ids: candidates.map((c) => c.id).filter((id) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id),
        ),
        focus_names: blindMode ? [] : candidates.map((c) => c.name),
        context_candidates: brief,
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
        },
      ]);
    } catch {
      // Fallback summary if API is down
      const fallback =
        candidates.length > 0
          ? answerLocally("compare them", candidates, blindMode) ||
            `I have ${candidates.length} candidates loaded. Try asking: “Which candidate has more experience?”`
          : "Add candidates to compare first, then ask again.";
      setMessages((m) => [...m, { role: "assistant", text: fallback, source: "compare" }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  const statusLabel =
    chatSource === "fallback"
      ? "Deterministic fallback"
      : chatSource === "compare"
        ? "Shortlist-aware"
        : chatSource === "local"
          ? "Grounded agent"
          : chatSource === "offline"
            ? "Offline"
            : "Connecting…";

  return (
    <section
      className={cn(
        "flex h-[340px] w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-soft)]",
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
          <Sparkles className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">Comparison Chat</p>
          <p className="truncate text-[11px] text-muted-foreground">
            {statusLabel}
            {!backendReady ? " · API optional" : ""}
            {candidates.length > 0 ? ` · ${candidates.length} selected` : " · no selection yet"}
          </p>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
        {messages.map((m, i) => (
          <div key={i} className="space-y-1">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {m.role === "user" ? "You" : "Assistant"}
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
                <p className="mb-1 font-semibold text-foreground">Sources</p>
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
        <div className="flex flex-wrap gap-2 px-4 pb-2">
          {SUGGESTIONS.map((s) => (
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

      <div className="relative z-10 border-t bg-card p-3">
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
            autoFocus
            placeholder="e.g. Which candidate has more experience?"
            className="pointer-events-auto relative z-10 max-h-36 min-h-[48px] w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-sm text-foreground caret-foreground outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60"
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
    </section>
  );
}
