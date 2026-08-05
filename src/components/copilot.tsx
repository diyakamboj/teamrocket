import { useMemo, useState } from "react";
import { Bot, Send, X } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { rankCandidates } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Compare the top 3 candidates",
  "Who meets every must-have?",
  "Which candidates lack certifications?",
  "Summarise the qualification gaps in this pool",
];

type Msg = { role: "user" | "assistant"; text: string };

export function CopilotPanel() {
  const { copilotOpen, setCopilotOpen, weights, candidates } = useAppState();
  const ranked = useMemo(() => rankCandidates(candidates, weights), [candidates, weights]);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hi! I'm your Recruiter Copilot. Ask me anything about the current candidate pool.",
    },
  ]);
  const [input, setInput] = useState("");

  function answer(q: string): string {
    if (ranked.length === 0) {
      return "There is no ranked pool yet. Upload resumes, analyze a job description, then run screening — I answer from the real scored candidates.";
    }

    const lower = q.toLowerCase();
    const top = ranked.slice(0, 3);

    if (lower.includes("compare") || lower.includes("top 3")) {
      return `Top ${top.length} by current weighting:\n\n${top
        .map(
          (c) =>
            `- **#${c.rank} ${c.name}** (${c.score}) — skills ${c.categories.skills}, experience ${c.categories.experience}, education ${c.categories.education}`,
        )
        .join("\n")}`;
    }

    if (lower.includes("certification")) {
      const weak = ranked.filter((c) => c.categories.certifications < 45).length;
      return `${weak} of ${ranked.length} candidates score under 45 on certifications. Consider lowering that weight or treating it as a nice-to-have.`;
    }

    if (lower.includes("must") || lower.includes("requirement")) {
      const full = ranked.filter((c) => c.mustHavesTotal > 0 && c.mustHavesMet === c.mustHavesTotal);
      return full.length
        ? `${full.length} candidate${full.length === 1 ? "" : "s"} meet every must-have:\n\n${full
            .slice(0, 5)
            .map((c) => `- **${c.name}** (${c.score})`)
            .join("\n")}`
        : "No candidate currently meets every must-have requirement. Loosening a must-have on the job description page will widen the shortlist.";
    }

    if (lower.includes("gap")) {
      const counts = new Map<string, number>();
      for (const c of ranked) for (const g of c.gaps) counts.set(g, (counts.get(g) ?? 0) + 1);
      const commonGaps = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
      return commonGaps.length
        ? `Most common gaps across ${ranked.length} candidates:\n\n${commonGaps
            .map(([gap, n]) => `- ${gap} (${n})`)
            .join("\n")}`
        : `No gaps were recorded for the current pool of ${ranked.length} candidates.`;
    }

    const byName = ranked.find((c) => lower.includes(c.name.split(" ")[0]!.toLowerCase()));
    if (byName) {
      return `**${byName.name}** ranks #${byName.rank} with a score of ${byName.score}.${
        byName.strengths[0] ? ` Strength: ${byName.strengths[0]}.` : ""
      }${byName.gaps[0] ? ` Gap: ${byName.gaps[0]}.` : ""}`;
    }

    // Fall back to treating the question as a skill lookup.
    const term = lower.match(/[a-z][a-z0-9+#.]{2,}/g)?.find((t) =>
      ranked.some((c) => c.skills.some((s) => s.toLowerCase().includes(t))),
    );
    if (term) {
      const withSkill = ranked
        .filter((c) => c.skills.some((s) => s.toLowerCase().includes(term)))
        .slice(0, 5);
      return `${withSkill.length} candidate${withSkill.length === 1 ? "" : "s"} show ${term}:\n\n${withSkill
        .map((c) => `- **${c.name}** — score ${c.score}, ${c.years} yrs`)
        .join("\n")}`;
    }

    return `Across ${ranked.length} scored candidates the highest match is **${top[0]!.name}** at ${top[0]!.score}. Ask about a specific skill, candidate, must-haves or gaps.`;
  }

  function send(text: string) {
    if (!text.trim()) return;
    setMessages((m) => [...m, { role: "user", text }, { role: "assistant", text: answer(text) }]);
    setInput("");
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
              {ranked.length
                ? `Ask about the ${ranked.length}-candidate pool`
                : "No screened candidates yet"}
            </p>
          </div>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {messages.map((m, i) => (
            <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm",
                  m.role === "user"
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-secondary-foreground",
                )}
              >
                {m.text.split("**").map((part, j) =>
                  j % 2 ? (
                    <strong key={j}>{part}</strong>
                  ) : (
                    <span key={j}>{part}</span>
                  ),
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="border-t px-5 py-4">
          <div className="mb-3 flex flex-wrap gap-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                onClick={() => send(s)}
                className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary-soft-foreground transition-colors hover:bg-accent"
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
            />
            <Button type="submit" size="icon" className="shrink-0 rounded-xl">
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      </div>
    </>
  );
}
