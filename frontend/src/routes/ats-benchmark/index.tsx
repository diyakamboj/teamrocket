import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Gauge, Loader2, RefreshCw, Scale, ScanSearch, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreRing } from "@/components/score-ring";
import { useAppState } from "@/lib/app-state";
import {
  getAtsBenchmark,
  getJobPipeline,
  listJobPipelines,
  runAtsBenchmark,
  type AtsBenchmark,
  type AtsVerdict,
  type JobPipelineSummary,
  type PipelineCandidate,
} from "@/lib/api";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/ats-benchmark/")({
  head: () => ({
    meta: [
      { title: "ATS Benchmark Baseline Scoring — ResumeIQ" },
      {
        name: "description",
        content:
          "Dual-scoring framework: a standard ATS keyword-matching baseline with an LLM semantic evaluation layered on top.",
      },
      { property: "og:title", content: "ATS Benchmark Baseline Scoring — ResumeIQ" },
      {
        property: "og:description",
        content: "Compare keyword-only ATS scoring against AI semantic fit evaluation.",
      },
    ],
  }),
  component: AtsBenchmarkPage,
});

const VERDICT_META: Record<AtsVerdict, { label: string; description: string; className: string }> =
  {
    semantic_stronger: {
      label: "AI found a stronger fit",
      description:
        "The candidate scores meaningfully higher on semantic fit than on literal keyword matches — a keyword-only ATS would likely have under-ranked or filtered this candidate out.",
      className: "bg-success/10 text-success dark:bg-success/15 dark:text-success",
    },
    keyword_stronger: {
      label: "Keyword score runs hot",
      description:
        "The keyword baseline is notably higher than the semantic assessment — worth a closer look at whether the resume is keyword-optimized without matching depth of experience.",
      className: "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
    },
    aligned: {
      label: "Signals aligned",
      description: "The keyword baseline and semantic assessment are roughly in agreement.",
      className: "bg-secondary text-secondary-foreground",
    },
    no_keyword_baseline: {
      label: "No keyword baseline",
      description:
        "This job lists no required or nice-to-have skills, so the keyword scan had nothing to look for. Add skills to the job to get an ATS baseline worth comparing against.",
      className: "bg-secondary text-foreground dark:bg-secondary dark:text-muted-foreground",
    },
    semantic_unavailable: {
      label: "Semantic score unavailable",
      description:
        "The AI evaluation did not return a usable score for this run, so there is nothing to compare the keyword baseline against. Re-run to try again.",
      className: "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
    },
  };

/** Tolerate a verdict the UI does not know yet rather than crashing on it. */
function verdictMeta(verdict: AtsVerdict) {
  return (
    VERDICT_META[verdict] ?? {
      label: String(verdict).replace(/_/g, " "),
      description: "",
      className: "bg-secondary text-secondary-foreground",
    }
  );
}

function num(value: string | number | null | undefined): number {
  if (value == null) return 0;
  return typeof value === "number" ? value : Number(value);
}

/** A score that may legitimately not exist -- null stays null rather than
 *  collapsing to 0, which would render as a real "0%" result. */
function maybeNum(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Placeholder for a half of the benchmark that was not produced. */
function AbsentScore({ note }: { note: string }) {
  return (
    <div className="flex h-[88px] w-[88px] flex-col items-center justify-center rounded-full border-2 border-dashed border-border text-center">
      <span className="text-lg font-bold text-muted-foreground">—</span>
      <span className="px-1 text-[9px] leading-tight text-muted-foreground">{note}</span>
    </div>
  );
}

function AtsBenchmarkPage() {
  const { setViewingCandidateId, setViewingJobId } = useAppState();
  const [jobs, setJobs] = useState<JobPipelineSummary[]>([]);
  const [loadingJobs, setLoadingJobs] = useState(true);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const [candidates, setCandidates] = useState<PipelineCandidate[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const [benchmark, setBenchmark] = useState<AtsBenchmark | null>(null);
  const [loadingBenchmark, setLoadingBenchmark] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    listJobPipelines()
      .then((rows) => {
        setJobs(rows);
        setSelectedJobId((current) => current ?? rows[0]?.job_id ?? null);
      })
      .catch(() => setJobs([]))
      .finally(() => setLoadingJobs(false));
  }, []);

  useEffect(() => {
    if (!selectedJobId) return;
    setLoadingCandidates(true);
    setSelectedCandidateId(null);
    setBenchmark(null);
    getJobPipeline(selectedJobId, "all")
      .then((rows) => {
        setCandidates(rows);
        setSelectedCandidateId(rows[0]?.candidate_id ?? null);
      })
      .catch(() => setCandidates([]))
      .finally(() => setLoadingCandidates(false));
  }, [selectedJobId]);

  useEffect(() => {
    if (!selectedJobId || !selectedCandidateId) return;
    setLoadingBenchmark(true);
    getAtsBenchmark(selectedCandidateId, selectedJobId)
      .then(setBenchmark)
      .finally(() => setLoadingBenchmark(false));
  }, [selectedJobId, selectedCandidateId]);

  // Broadcast the in-view candidate/job to the global Copilot context (additive —
  // page-local selection state above stays the source of truth for this page's UI).
  useEffect(() => {
    setViewingJobId(selectedJobId);
  }, [selectedJobId, setViewingJobId]);

  useEffect(() => {
    setViewingCandidateId(selectedCandidateId);
  }, [selectedCandidateId, setViewingCandidateId]);

  const selectedCandidate = candidates.find((c) => c.candidate_id === selectedCandidateId);

  async function handleRun() {
    if (!selectedJobId || !selectedCandidateId) return;
    setRunning(true);
    try {
      const result = await runAtsBenchmark(selectedCandidateId, selectedJobId);
      setBenchmark(result);
      toast.success("ATS benchmark computed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not run ATS benchmark");
    } finally {
      setRunning(false);
    }
  }

  const delta = useMemo(() => (benchmark ? maybeNum(benchmark.score_delta) : null), [benchmark]);
  const keywordScore = useMemo(
    () => (benchmark ? maybeNum(benchmark.keyword_score) : null),
    [benchmark],
  );
  const semanticScore = useMemo(
    () => (benchmark ? maybeNum(benchmark.semantic_score) : null),
    [benchmark],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold sm:text-3xl">ATS Benchmark Baseline Scoring</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          A standard keyword-matching ATS baseline, with an LLM semantic evaluation layered on top —
          so you can see where the two disagree.
        </p>
      </header>

      <div className="grid gap-6 lg:grid-cols-[280px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <div className="card-surface p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Job
            </p>
            {loadingJobs ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading jobs…
              </div>
            ) : jobs.length === 0 ? (
              <p className="text-sm text-muted-foreground">No jobs yet.</p>
            ) : (
              <div className="space-y-1">
                {jobs.map((job) => (
                  <button
                    key={job.job_id}
                    onClick={() => setSelectedJobId(job.job_id)}
                    className={cn(
                      "w-full rounded-xl px-3 py-2 text-left text-sm transition-colors",
                      job.job_id === selectedJobId
                        ? "bg-primary-soft text-primary-soft-foreground"
                        : "hover:bg-secondary",
                    )}
                  >
                    <p className="truncate font-semibold">{job.title}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {job.total_candidates} candidates
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="card-surface p-4">
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Candidate
            </p>
            {loadingCandidates ? (
              <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading candidates…
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">No candidates for this job yet.</p>
            ) : (
              <div className="max-h-[420px] space-y-1 overflow-y-auto pr-1">
                {candidates.map((c) => (
                  <button
                    key={c.candidate_id}
                    onClick={() => setSelectedCandidateId(c.candidate_id)}
                    className={cn(
                      "w-full rounded-xl px-3 py-2 text-left text-sm transition-colors",
                      c.candidate_id === selectedCandidateId
                        ? "bg-primary-soft text-primary-soft-foreground"
                        : "hover:bg-secondary",
                    )}
                  >
                    <p className="truncate font-semibold">{c.candidate_name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      ATS score {c.overall_score != null ? Math.round(c.overall_score) : "—"}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </div>
        </aside>

        <div className="min-w-0 space-y-6">
          {!selectedCandidate ? (
            <div className="card-surface p-10 text-center text-sm text-muted-foreground">
              Pick a job and candidate to run the ATS benchmark.
            </div>
          ) : (
            <>
              <div className="card-surface flex flex-wrap items-center justify-between gap-4 p-5">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{selectedCandidate.candidate_name}</p>
                  <p className="truncate text-sm text-muted-foreground">
                    {jobs.find((j) => j.job_id === selectedJobId)?.title}
                  </p>
                </div>
                <Button onClick={() => void handleRun()} disabled={running} className="rounded-xl">
                  {running ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : benchmark ? (
                    <RefreshCw className="mr-2 h-4 w-4" />
                  ) : (
                    <Scale className="mr-2 h-4 w-4" />
                  )}
                  {benchmark ? "Re-run benchmark" : "Run ATS benchmark"}
                </Button>
              </div>

              {loadingBenchmark ? (
                <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" /> Checking for an existing benchmark…
                </div>
              ) : !benchmark ? (
                <div className="card-surface p-10 text-center">
                  <Scale className="mx-auto h-8 w-8 text-muted-foreground" />
                  <h2 className="mt-3 text-lg font-bold">No benchmark yet</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Run it to compare a keyword-matching ATS baseline against an LLM semantic
                    evaluation for this candidate.
                  </p>
                </div>
              ) : (
                <>
                  <div className="card-surface p-6">
                    <div className="flex flex-col items-center gap-6 sm:flex-row sm:justify-center">
                      <div className="flex flex-col items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          <ScanSearch className="h-3.5 w-3.5" /> ATS keyword baseline
                        </span>
                        {keywordScore === null ? (
                          <AbsentScore note="job lists no skills" />
                        ) : (
                          <ScoreRing value={Math.round(keywordScore)} size={88} />
                        )}
                      </div>

                      <div className="flex flex-col items-center gap-1 text-muted-foreground">
                        <ArrowRight className="h-5 w-5" />
                        <span
                          className={cn(
                            "text-sm font-bold tabular-nums",
                            delta !== null && delta > 0 && "text-success dark:text-success",
                            delta !== null && delta < 0 && "text-destructive dark:text-destructive",
                            delta === null && "text-muted-foreground",
                          )}
                        >
                          {delta === null ? (
                            "no delta"
                          ) : (
                            <>
                              {delta > 0 ? "+" : ""}
                              {delta.toFixed(1)} pts
                            </>
                          )}
                        </span>
                      </div>

                      <div className="flex flex-col items-center gap-2">
                        <span className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          <Sparkles className="h-3.5 w-3.5" /> AI semantic score
                        </span>
                        {semanticScore === null ? (
                          <AbsentScore note="not returned" />
                        ) : (
                          <ScoreRing value={Math.round(semanticScore)} size={88} />
                        )}
                      </div>
                    </div>

                    <div className="mt-6 flex justify-center">
                      <Badge
                        className={cn(
                          "border-transparent px-3 py-1 text-xs font-semibold",
                          verdictMeta(benchmark.verdict).className,
                        )}
                      >
                        {verdictMeta(benchmark.verdict).label}
                      </Badge>
                    </div>
                    <p className="mx-auto mt-2 max-w-xl text-center text-xs text-muted-foreground">
                      {verdictMeta(benchmark.verdict).description}
                    </p>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="card-surface p-5">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Matched keywords
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {benchmark.matched_keywords.length === 0 ? (
                          <span className="text-sm text-muted-foreground">None</span>
                        ) : (
                          benchmark.matched_keywords.map((k) => (
                            <span
                              key={k}
                              className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary-soft-foreground"
                            >
                              {k}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                    <div className="card-surface p-5">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Missing keywords
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {benchmark.missing_keywords.length === 0 ? (
                          <span className="text-sm text-muted-foreground">None</span>
                        ) : (
                          benchmark.missing_keywords.map((k) => (
                            <span
                              key={k}
                              className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground"
                            >
                              {k}
                            </span>
                          ))
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="card-surface p-5">
                    <div className="flex items-center gap-2">
                      <Gauge className="h-4 w-4 text-muted-foreground" />
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Semantic rationale
                      </p>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">
                      {benchmark.semantic_rationale}
                    </p>
                  </div>

                  {benchmark.equivalent_terms.length > 0 && (
                    <div className="card-surface p-5">
                      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                        Equivalent terms a keyword scan would miss
                      </p>
                      <div className="mt-3 space-y-2">
                        {benchmark.equivalent_terms.map((term, i) => (
                          <div
                            key={i}
                            className="flex items-center gap-3 rounded-xl border px-3 py-2 text-sm"
                          >
                            <span className="font-semibold">{term.resume_term}</span>
                            <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                            <span className="text-muted-foreground">{term.jd_keyword}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
