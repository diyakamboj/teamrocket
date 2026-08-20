import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowUp, Loader2, Plus, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { analyzeJob } from "@/lib/api";
import {
  analyzeJobDescription,
  type ExtractedRequirement,
  type RequirementCategory,
} from "@/lib/job-analyzer";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/job-analysis")({
  validateSearch: (search: Record<string, unknown>): { highlight?: string } =>
    typeof search["highlight"] === "string" ? { highlight: search["highlight"] } : {},
  head: () => ({
    meta: [
      { title: "Job Description Analysis — ResumeIQ" },
      {
        name: "description",
        content:
          "Ask the job chat to extract skills, experience, education, or certifications into the sections below.",
      },
      { property: "og:title", content: "Job Description Analysis — ResumeIQ" },
      {
        property: "og:description",
        content:
          "Chat to extract job requirements into Skills, Experience, Education, Certifications.",
      },
    ],
  }),
  component: JobAnalysis,
});

const CATEGORIES: RequirementCategory[] = ["Skills", "Experience", "Education", "Certifications"];

const SUGGESTIONS = [
  "What skills are needed for a software engineer?",
  "What skills are needed for a plumber?",
  "Education requirements for a nurse",
  "Certifications for an electrician",
];

type ChatMsg = { role: "user" | "assistant"; text: string };

function requestedCategories(query: string): RequirementCategory[] | "all" {
  const lower = query.toLowerCase();
  const cats: RequirementCategory[] = [];
  if (/\bskill/.test(lower)) cats.push("Skills");
  if (/\bexperience|\byears?\b|\bseniority/.test(lower)) cats.push("Experience");
  if (/\beducation|\bdegree|\bdiploma|\bbachelor|\bmaster/.test(lower)) cats.push("Education");
  if (/\bcertif|\blicen[cs]e|\bcredential/.test(lower)) cats.push("Certifications");

  if (
    cats.length === 0 &&
    (/\banaly[sz]e|\bextract|\brequirements?\b|\ball\b|\beverything|\bbreak\s*down/.test(lower) ||
      /\bplumber|\bengineer|\bnurse|\bdeveloper|\bchef|\bdriver|\belectrician/.test(lower))
  ) {
    return "all";
  }
  if (cats.length === 0) return ["Skills"]; // default ask → skills only
  return cats;
}

function JobAnalysis() {
  const { highlight } = Route.useSearch();
  const sectionsRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const [reqs, setReqs] = useState<ExtractedRequirement[]>([]);
  const [detectedTitle, setDetectedTitle] = useState("");
  const [loading, setLoading] = useState(false);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMsg[]>([
    {
      role: "assistant",
      text: "Ask me about a role — e.g. “What skills are needed for a plumber?” I’ll fill only the sections you ask for below.",
    },
  ]);
  const [draft, setDraft] = useState<Record<RequirementCategory, string>>({
    Skills: "",
    Experience: "",
    Education: "",
    Certifications: "",
  });

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (!highlight) return;
    setReqs((prev) => {
      if (prev.some((r) => r.text.toLowerCase() === highlight.toLowerCase())) return prev;
      return [
        {
          id: `highlight-${highlight}`,
          category: "Skills",
          text: highlight,
          must: true,
        },
        ...prev,
      ];
    });
    sectionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [highlight]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(Math.max(el.scrollHeight, 48), 120)}px`;
  }, [input]);

  async function ask(text: string) {
    const query = text.trim();
    if (!query || loading) return;

    setMessages((m) => [...m, { role: "user", text: query }]);
    setInput("");
    setLoading(true);

    try {
      const local = analyzeJobDescription(query);
      const want = requestedCategories(query);
      const categories: RequirementCategory[] = want === "all" ? [...CATEGORIES] : want;

      // Keep other sections; replace only what the user asked for
      setReqs((prev) => {
        const kept = prev.filter((r) => !categories.includes(r.category));
        const next = local.requirements.filter((r) => categories.includes(r.category));
        return [...kept, ...next];
      });
      setDetectedTitle(local.title);

      try {
        // Draft analysis only — this screen is a JD playground, so it must not
        // persist a throwaway job (and therefore does not change the active job).
        const remote = await analyzeJob({
          title: local.title,
          description: query,
        });

        if (categories.includes("Skills") && remote.required_skills?.length) {
          const skillReqs: ExtractedRequirement[] = [
            ...remote.required_skills.map((skill, i) => ({
              id: `api-sk-m-${i}`,
              category: "Skills" as const,
              text: skill,
              must: true,
            })),
            ...(remote.nice_to_have_skills || []).map((skill, i) => ({
              id: `api-sk-n-${i}`,
              category: "Skills" as const,
              text: skill,
              must: false,
            })),
          ];
          setReqs((prev) => [...prev.filter((r) => r.category !== "Skills"), ...skillReqs]);
        }
        if (categories.includes("Experience") && remote.required_experience_years) {
          setReqs((prev) => [
            ...prev.filter((r) => r.category !== "Experience"),
            {
              id: `api-ex-${Date.now()}`,
              category: "Experience",
              text: `${remote.required_experience_years}+ years relevant experience`,
              must: true,
            },
          ]);
        }
        if (categories.includes("Education") && remote.education_requirements) {
          setReqs((prev) => [
            ...prev.filter((r) => r.category !== "Education"),
            {
              id: `api-ed-${Date.now()}`,
              category: "Education",
              text: remote.education_requirements!,
              must: false,
            },
          ]);
        }
        if (remote.title) setDetectedTitle(remote.title);
      } catch {
        // local fill is enough
      }

      const filled = categories.join(", ");
      const count = local.requirements.filter((r) => categories.includes(r.category)).length;
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          text: `Updated **${filled}** for **${local.title}** (${count} items). Check the sections below.`,
        },
      ]);
      toast.success(`Filled ${filled}`);
      requestAnimationFrame(() => {
        sectionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not analyze that request.";
      setMessages((m) => [...m, { role: "assistant", text: message }]);
    } finally {
      setLoading(false);
      textareaRef.current?.focus();
    }
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <header>
        <h1 className="text-2xl font-extrabold sm:text-3xl">Job Description Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Ask in the chat — sections below update only for what you ask (skills, education,
          experience, certifications).
          {detectedTitle ? ` Last role: ${detectedTitle}.` : ""}
        </p>
      </header>

      {/* Chatbox — only this triggers filling sections */}
      <section className="flex h-[320px] w-full flex-col overflow-hidden rounded-2xl border bg-card shadow-[var(--shadow-soft)]">
        <header className="flex items-center gap-3 border-b px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold">Job requirements chat</p>
            <p className="text-xs text-muted-foreground">
              Ask for skills, experience, education, or certifications
            </p>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-3">
          {messages.map((m, i) => (
            <div key={i} className="space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
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
            </div>
          ))}
          {loading && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Extracting into sections…
            </div>
          )}
        </div>

        {messages.length <= 1 && (
          <div className="flex flex-wrap gap-2 px-4 pb-2">
            {SUGGESTIONS.map((s) => (
              <button
                key={s}
                type="button"
                disabled={loading}
                onClick={() => void ask(s)}
                className="rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-40"
              >
                {s}
              </button>
            ))}
          </div>
        )}

        <div className="border-t p-3">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void ask(input);
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
                  void ask(input);
                }
              }}
              rows={2}
              disabled={loading}
              placeholder='Ask here… e.g. "What skills are needed for a plumber?"'
              className="max-h-28 min-h-[48px] w-full resize-none bg-transparent px-3.5 pt-3 pb-2 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-60"
            />
            <div className="flex items-center justify-between gap-2 px-2 pb-2">
              <p className="px-1.5 text-[11px] text-muted-foreground">
                Enter to send · sections update only for what you ask
              </p>
              <button
                type="submit"
                disabled={loading || !input.trim()}
                aria-label="Send"
                className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground disabled:opacity-40"
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

      {/* Bottom sections — filled only from chat asks */}
      <div ref={sectionsRef} className="space-y-3">
        <div>
          <h2 className="text-lg font-extrabold">Requirement sections</h2>
          <p className="text-sm text-muted-foreground">
            Empty until you ask in the chatbox above (e.g. skills only, or education only).
          </p>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          {CATEGORIES.map((cat) => {
            const items = reqs.filter((r) => r.category === cat);
            return (
              <div key={cat} className="card-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <h3 className="text-base font-bold">{cat}</h3>
                  <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-semibold text-primary-soft-foreground">
                    {items.length}
                  </span>
                </div>

                <ul className="mt-4 min-h-[72px] space-y-2">
                  {items.length === 0 ? (
                    <li className="rounded-xl border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
                      Ask for {cat.toLowerCase()} in the chatbox to fill this section
                    </li>
                  ) : (
                    items.map((r) => (
                      <li
                        key={r.id}
                        className={cn(
                          "grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2",
                          highlight &&
                            r.text.toLowerCase() === highlight.toLowerCase() &&
                            "ring-2 ring-primary",
                        )}
                      >
                        <input
                          value={r.text}
                          onChange={(e) =>
                            setReqs((prev) =>
                              prev.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)),
                            )
                          }
                          className="min-w-0 bg-transparent text-sm outline-none"
                        />
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              setReqs((prev) =>
                                prev.map((x) => (x.id === r.id ? { ...x, must: !x.must } : x)),
                              )
                            }
                            className={
                              r.must
                                ? "rounded-full bg-primary px-2 py-0.5 text-[11px] font-bold text-primary-foreground"
                                : "rounded-full bg-background px-2 py-0.5 text-[11px] font-bold text-muted-foreground"
                            }
                          >
                            {r.must ? "MUST" : "NICE"}
                          </button>
                          <button
                            type="button"
                            aria-label="Remove requirement"
                            onClick={() => setReqs((prev) => prev.filter((x) => x.id !== r.id))}
                            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))
                  )}
                </ul>

                <form
                  className="mt-3 flex items-center gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    const text = draft[cat].trim();
                    if (!text) return;
                    setReqs((prev) => [
                      ...prev,
                      { id: `${cat}-${Date.now()}`, category: cat, text, must: false },
                    ]);
                    setDraft((d) => ({ ...d, [cat]: "" }));
                  }}
                >
                  <Input
                    value={draft[cat]}
                    onChange={(e) => setDraft((d) => ({ ...d, [cat]: e.target.value }))}
                    placeholder={`Add ${cat.toLowerCase()} manually`}
                    className="rounded-xl text-sm"
                  />
                  <Button
                    type="submit"
                    size="icon"
                    variant="outline"
                    className="shrink-0 rounded-xl"
                  >
                    <Plus className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
