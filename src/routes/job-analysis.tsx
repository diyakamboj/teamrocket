import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Info, Plus, Sparkle, Trash2, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { analyzeJob, saveJobRequirements, startScreening } from "@/lib/api/jobs";
import { useAppState } from "@/lib/app-state";
import { REQUIREMENT_CATEGORIES, type Requirement, type RequirementCategory } from "@/lib/types";

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

const PLACEHOLDER = `Paste the full job description here…

e.g. We're hiring a Senior Backend Engineer to own our data platform. You'll design Python services on AWS, work with Kubernetes…`;

type Draft = Record<RequirementCategory, string>;

const EMPTY_DRAFT: Draft = { Skills: "", Experience: "", Education: "", Certifications: "" };

function JobAnalysis() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { job, poolSize, capabilities, refreshCandidates } = useAppState();

  const [jd, setJd] = useState("");
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [reqs, setReqs] = useState<Requirement[]>([]);
  const [jobId, setJobId] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [screening, setScreening] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  // Load whatever job is already saved so edits survive navigation.
  useEffect(() => {
    if (!job || jobId === job.id) return;
    setJobId(job.id);
    setJd(job.description);
    setTitle(job.title);
    setSummary(job.summary);
    setReqs(job.requirements);
  }, [job, jobId]);

  async function analyze() {
    if (!jd.trim()) {
      toast.error("Paste a job description first");
      return;
    }
    setAnalyzing(true);
    try {
      const snapshot = await analyzeJob({ data: { description: jd } });
      if (!snapshot.job) throw new Error("No requirements could be extracted");
      setJobId(snapshot.job.id);
      setTitle(snapshot.job.title);
      setSummary(snapshot.job.summary);
      setReqs(snapshot.job.requirements);
      await queryClient.invalidateQueries({ queryKey: ["candidates"] });
      toast.success(
        `Extracted ${snapshot.job.requirements.length} requirements across ${
          new Set(snapshot.job.requirements.map((r) => r.category)).size
        } categories`,
      );
    } catch (error) {
      toast.error("Analysis failed", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setAnalyzing(false);
    }
  }

  async function saveAndScreen() {
    if (!jobId) return;
    setScreening(true);
    try {
      await saveJobRequirements({ data: { jobId, title, requirements: reqs } });
      await startScreening({ data: { jobId } });
      refreshCandidates();
      toast.success(`Screening ${poolSize} candidates…`, {
        description: "Ranking updates live on the candidates page.",
      });
      void navigate({ to: "/candidates" });
    } catch (error) {
      toast.error("Could not start screening", {
        description: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setScreening(false);
    }
  }

  const mustCount = reqs.filter((r) => r.must).length;

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold sm:text-3xl">Job Description Analysis</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Extract screening criteria, then refine them before ranking candidates.
        </p>
      </header>

      {!capabilities.chat && (
        <div className="card-surface flex items-start gap-3 border-warning/40 p-4">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">Azure OpenAI is not configured.</strong> Requirements
            are extracted with the offline keyword parser, which is noticeably rougher. Set{" "}
            <code className="rounded bg-secondary px-1">AZURE_OPENAI_ENDPOINT</code>,{" "}
            <code className="rounded bg-secondary px-1">AZURE_OPENAI_API_KEY</code> and{" "}
            <code className="rounded bg-secondary px-1">AZURE_OPENAI_DEPLOYMENT</code> in{" "}
            <code className="rounded bg-secondary px-1">.env</code>.
          </p>
        </div>
      )}

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
            {analyzing ? "Analyzing…" : reqs.length ? "Re-analyze" : "Analyze"}
          </Button>
          <p className="text-xs text-muted-foreground">
            {jd.trim().split(/\s+/).filter(Boolean).length} words
          </p>
        </div>
      </div>

      {reqs.length > 0 && (
        <>
          <div className="card-surface space-y-4 p-5">
            <div className="flex items-start gap-3">
              <Sparkle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1 space-y-3">
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  aria-label="Role title"
                  className="rounded-xl text-sm font-semibold"
                />
                <p className="text-sm text-muted-foreground">{summary}</p>
                <p className="text-xs text-muted-foreground">
                  {reqs.length} requirements · {mustCount} must-have ·{" "}
                  {poolSize} parsed resume{poolSize === 1 ? "" : "s"} ready to screen
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button
                className="rounded-xl"
                onClick={saveAndScreen}
                disabled={screening || poolSize === 0}
              >
                {screening ? "Starting…" : `Screen ${poolSize} candidates`}
              </Button>
              {poolSize === 0 && (
                <p className="text-xs text-muted-foreground">
                  Upload and parse some resumes first — the ranking runs against parsed resumes.
                </p>
              )}
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            {REQUIREMENT_CATEGORIES.map((cat) => (
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
                        <div className="min-w-0">
                          <input
                            value={r.text}
                            onChange={(e) =>
                              setReqs((prev) =>
                                prev.map((x) => (x.id === r.id ? { ...x, text: e.target.value } : x)),
                              )
                            }
                            className="w-full min-w-0 bg-transparent text-sm outline-none"
                          />
                          {r.keywords.length > 0 && (
                            <p className="truncate text-[11px] text-muted-foreground">
                              matches: {r.keywords.join(", ")}
                              {r.minYears ? ` · ${r.minYears}+ yrs` : ""}
                            </p>
                          )}
                        </div>
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
                      {
                        id: `${cat}-${Date.now()}`,
                        category: cat,
                        text,
                        must: false,
                        // Left empty so the server derives the search terms on save.
                        keywords: [],
                      },
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
