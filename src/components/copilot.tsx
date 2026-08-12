import { useState } from "react";
import { Bot, Loader2, Send, X } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { useAppState } from "@/lib/app-state";
import { copilotAsk } from "@/lib/api/jobs";
import type { CopilotResponse } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Compare the top 3 candidates",
  "Who meets every must-have?",
  "Which candidates lack certifications?",
  "Summarise the qualification gaps in this pool",
];

type Msg = {
  role: "user" | "assistant";
  text: string;
  citations?: CopilotResponse["citations"];
  engine?: CopilotResponse["engine"];
};

export function CopilotPanel() {
  const { copilotOpen, setCopilotOpen, job, weights, blindMode, candidates } =
    useAppState();
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hi! I'm your Recruiter Copilot. Ask me anything about the current candidate pool.",
    },
  ]);
  const [input, setInput] = useState("");

  const ask = useMutation({
    mutationFn: (question: string) =>
      copilotAsk({
        data: { jobId: job?.id ?? "", question, blind: blindMode, weights },
      }),
    onSuccess: (response) => {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: response.answer,
          citations: response.citations,
          engine: response.engine,
        },
      ]);
    },
    onError: (error: unknown) => {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text:
            error instanceof Error
              ? error.message
              : "The copilot couldn't answer right now. Try again in a moment.",
        },
      ]);
    },
  });

  function send(text: string) {
    const question = text.trim();
    if (!question || ask.isPending) return;
    setMessages((m) => [...m, { role: "user", text: question }]);
    setInput("");
    ask.mutate(question);
  }

  return (
    <>
      <button
        onClick={() => setCopilotOpen(!copilotOpen)}
        aria-label="Open Recruiter Copilot"
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-[var(--shadow-lift)] transition-transform hover:scale-105 active:scale-95"
      >
        {copilotOpen ? <X className="h-5 w-5" /> : <Bot className="h-6 w-6" />}
      </button>

      <div
        className={cn(
          "fixed inset-y-0 right-0 z-40 flex w-full max-w-md flex-col border-l bg-card transition-transform duration-300",
          copilotOpen ? "translate-x-0" : "translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 border-b px-5 py-4">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
            <Bot className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-bold">Recruiter Copilot</p>
            <p className="truncate text-xs text-muted-foreground">
              {candidates.length
                ? `Ask about the ${candidates.length}-candidate pool`
                : "No screened candidates yet"}
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.map((m, i) => (
            <div
              key={i}
              className={cn(
                "flex",
                m.role === "user" ? "justify-end" : "justify-start",
              )}
            >
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.text
                  .split("**")
                  .map((part, j) =>
                    j % 2 ? (
                      <strong key={j}>{part}</strong>
                    ) : (
                      <span key={j}>{part}</span>
                    ),
                  )}
                {m.citations && m.citations.length > 0 && (
                  <div className="mt-3 space-y-1 border-t border-muted-foreground/20 pt-2 text-xs text-muted-foreground">
                    <p className="font-semibold">Evidence</p>
                    {m.citations.map((e) => (
                      <p key={e.id} title={`"${e.quote}" — ${e.source}`}>
                        • {e.claim}{" "}
                        <span className="italic">
                          ({e.source}, {e.provenance})
                        </span>
                      </p>
                    ))}
                  </div>
                )}
                {m.engine && (
                  <span
                    className={cn(
                      "mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-medium",
                      m.engine === "agent"
                        ? "bg-primary-soft text-primary-soft-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {m.engine === "agent" ? "LLM agent" : "Offline rules"}
                  </span>
                )}
              </div>
            </div>
          ))}
          {ask.isPending && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span>{blindMode ? "Answering (blind)…" : "Answering…"}</span>
            </div>
          )}
        </div>

        <div className="border-t px-5 py-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                disabled={ask.isPending}
                className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary-soft-foreground transition-colors hover:bg-accent disabled:opacity-50"
              >
                {s}
              </button>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about candidates…"
              className="rounded-xl"
              disabled={ask.isPending}
            />
            <Button
              type="submit"
              size="icon"
              className="shrink-0 rounded-xl"
              disabled={ask.isPending}
            >
              {ask.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
