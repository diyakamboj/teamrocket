import { useMemo, useState } from "react";
import { Bot, Send, X } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { CANDIDATES, rankCandidates } from "@/lib/mock-data";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

const SUGGESTIONS = [
  "Who has the most cloud experience?",
  "Compare the top 3 candidates",
  "Which candidates lack certifications?",
  "Summarise the qualification gaps in this pool",
];

type Msg = { role: "user" | "assistant"; text: string };

export function CopilotPanel() {
  const { copilotOpen, setCopilotOpen, weights } = useAppState();
  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      text: "Hi! I'm your Recruiter Copilot. Ask me anything about the current candidate pool.",
    },
  ]);
  const [input, setInput] = useState("");

  function answer(q: string): string {
    const lower = q.toLowerCase();
    const top = ranked.slice(0, 3);
    if (lower.includes("cloud")) {
      const cloud = ranked
        .filter((c) => c.skills.some((s) => ["AWS", "Azure", "Kubernetes", "Terraform"].includes(s)))
        .slice(0, 3);
      return `**${cloud.length ? cloud[0]!.name : "No one"}** leads on cloud depth. Strongest cloud profiles:\n\n${cloud
        .map((c) => `- ${c.name} — score ${c.score}, ${c.years} yrs, ${c.skills.join(", ")}`)
        .join("\n")}`;
    }
    if (lower.includes("compare") || lower.includes("top 3")) {
      return `Top 3 by current weighting:\n\n${top
        .map(
          (c) =>
            `- **#${c.rank} ${c.name}** (${c.score}) — skills ${c.categories.skills}, experience ${c.categories.experience}, education ${c.categories.education}`,
        )
        .join(
          "\n",
        )}\n\n${top[0]!.name} edges ahead on skills coverage; ${top[1]!.name} has broader project evidence.`;
    }
    if (lower.includes("certification")) {
      const weak = ranked.filter((c) => c.categories.certifications < 45).length;
      return `${weak} of ${ranked.length} candidates score under 45 on certifications. Consider lowering that weight or treating it as a nice-to-have.`;
    }
    if (lower.includes("gap")) {
      return `Across ${ranked.length} candidates the most common gaps are: limited Kubernetes depth, thin certification evidence, and few examples of regulated-industry work. Skills coverage is strongest for Python, SQL and TypeScript.`;
    }
    const match = ranked.find((c) => lower.includes(c.name.split(" ")[0]!.toLowerCase()));
    if (match) {
      return `**${match.name}** ranks #${match.rank} with a score of ${match.score}. Strengths: ${match.strengths[0]}. Gap: ${match.gaps[0]}.`;
    }
    return `Based on the current pool of ${ranked.length} candidates, the highest match is ${top[0]!.name} at ${top[0]!.score}. Try asking about a specific skill, candidate, or gap.`;
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
              Ask about the {ranked.length}-candidate pool
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
