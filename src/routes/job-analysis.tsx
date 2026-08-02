import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Plus, Sparkle, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";

export const Route = createFileRoute("/job-analysis")({
  head: () => ({
    meta: [
      { title: "Job Description Analysis — ResumeIQ" },
      {
        name: "description",
        content:
          "Paste a job description and turn it into editable, categorised screening requirements before ranking candidates.",
      },
      { property: "og:title", content: "Job Description Analysis — ResumeIQ" },
      {
        property: "og:description",
        content: "Turn a job description into editable screening requirements.",
      },
    ],
  }),
  component: JobAnalysis,
});

type Category = "Skills" | "Experience" | "Education" | "Certifications";
type Req = { id: string; category: Category; text: string; must: boolean };

const CATEGORIES: Category[] = ["Skills", "Experience", "Education", "Certifications"];

const SAMPLE: Req[] = [
  { id: "r1", category: "Skills", text: "Python (production services)", must: true },
  { id: "r2", category: "Skills", text: "AWS or Azure cloud deployment", must: true },
  { id: "r3", category: "Skills", text: "Kubernetes & container orchestration", must: false },
  { id: "r4", category: "Skills", text: "SQL and data modelling", must: true },
  { id: "r5", category: "Experience", text: "5+ years backend engineering", must: true },
  { id: "r6", category: "Experience", text: "Owned a service end-to-end in production", must: true },
  { id: "r7", category: "Experience", text: "Mentored junior engineers", must: false },
  { id: "r8", category: "Education", text: "BSc in Computer Science or equivalent", must: false },
  { id: "r9", category: "Certifications", text: "AWS Solutions Architect (nice to have)", must: false },
];

const PLACEHOLDER = `Paste the full job description here…

e.g. We're hiring a Senior Backend Engineer to own our data platform. You'll design Python services on AWS, work with Kubernetes…`;

function JobAnalysis() {
  const [jd, setJd] = useState("");
  const [reqs, setReqs] = useState<Req[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [draft, setDraft] = useState<Record<Category, string>>({
    Skills: "",
    Experience: "",
    Education: "",
    Certifications: "",
  });

  function analyze() {
    if (!jd.trim()) {
      toast.error("Paste a job description first");
      return;
    }
    setAnalyzing(true);
    window.setTimeout(() => {
      setReqs(SAMPLE);
      setAnalyzing(false);
      toast.success("Extracted 9 requirements across 4 categories");
    }, 1200);
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold sm:text-3xl">Job Description Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Extract screening criteria, then refine them before ranking candidates.
        </p>
      </header>

      <div className="card-surface p-5">
        <Textarea
          value={jd}
          onChange={(e) => setJd(e.target.value)}
          placeholder={PLACEHOLDER}
          className="min-h-[200px] resize-y rounded-xl text-sm"
        />
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <Button className="rounded-xl" onClick={analyze} disabled={analyzing}>
            <Wand2 className="mr-2 h-4 w-4" />
            {analyzing ? "Analyzing…" : "Analyze"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {jd.trim().split(/\s+/).filter(Boolean).length} words
          </p>
        </div>
      </div>

      {reqs.length > 0 && (
        <>
          <div className="card-surface flex items-start gap-3 p-5">
            <Sparkle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
            <p className="text-sm text-muted-foreground">
              This role leans heavily on cloud-native backend delivery. Six requirements were marked
              as must-haves; certifications were detected as optional signals only.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {CATEGORIES.map((cat) => (
              <div key={cat} className="card-surface p-5">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-base font-bold">{cat}</h2>
                  <span className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-semibold text-primary-soft-foreground">
                    {reqs.filter((r) => r.category === cat).length}
                  </span>
                </div>

                <ul className="mt-4 space-y-2">
                  {reqs
                    .filter((r) => r.category === cat)
                    .map((r) => (
                      <li
                        key={r.id}
                        className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-xl bg-secondary/60 px-3 py-2"
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
                            onClick={() =>
                              setReqs((prev) =>
                                prev.map((x) => (x.id === r.id ? { ...x, must: !x.must } : x)),
                              )
                            }
                            className={
                              r.must
                                ? "rounded-full bg-primary px-2 py-0.5 text-[10px] font-bold text-primary-foreground"
                                : "rounded-full bg-background px-2 py-0.5 text-[10px] font-bold text-muted-foreground"
                            }
                          >
                            {r.must ? "MUST" : "NICE"}
                          </button>
                          <button
                            aria-label="Remove requirement"
                            onClick={() => setReqs((prev) => prev.filter((x) => x.id !== r.id))}
                            className="grid h-7 w-7 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
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
                    placeholder={`Add ${cat.toLowerCase()} requirement`}
                    className="rounded-xl text-sm"
                  />
                  <Button type="submit" size="icon" variant="outline" className="shrink-0 rounded-xl">
                    <Plus className="h-4 w-4" />
                  </Button>
                </form>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
