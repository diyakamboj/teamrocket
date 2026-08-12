import { useQuery } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ChevronDown,
  EyeOff,
  Search,
  SlidersHorizontal,
  Sparkle,
} from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { explainCandidate } from "@/lib/api/jobs";
import {
  DEFAULT_WEIGHTS,
  rankCandidates,
  type ScoreCategory,
} from "@/lib/types";
import { MiniBar, ScoreRing } from "@/components/score-ring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/candidates")({
  // The header search navigates here with ?q= — surface it so the filter below
  // can initialise from it (and any other query key is quietly dropped). `q` is
  // optional so pre-existing `to="/candidates"` links don't need a search param.
  validateSearch: (search: Record<string, unknown>): { q?: string } => ({
    q: typeof search["q"] === "string" ? search["q"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Candidate Ranking — ResumeIQ" },
      {
        name: "description",
        content:
          "Rank hundreds of candidates by weighted match score, with blind review mode, filters and evidence-backed explanations.",
      },
      { property: "og:title", content: "Candidate Ranking — ResumeIQ" },
      {
        property: "og:description",
        content:
          "Weighted candidate ranking with blind review and evidence-backed explanations.",
      },
    ],
  }),
  component: Candidates,
});

const LEVELS = ["All", "Junior", "Mid", "Senior", "Lead"] as const;
const PAGE_SIZE = 12;
const WEIGHT_KEYS: ScoreCategory[] = [
  "skills",
  "experience",
  "education",
  "certifications",
  "projects",
];

function Candidates() {
  const {
    candidates,
    candidatesLoading,
    job,
    run,
    poolSize,
    weights,
    setWeights,
    blindMode,
    setBlindMode,
    compareIds,
    toggleCompare,
    loadDemoData,
  } = useAppState();
  const { q } = Route.useSearch();
  const [query, setQuery] = useState(q ?? "");
  // Keep the filter in sync with the header's /candidates?q= navigation.
  useEffect(() => setQuery(q ?? ""), [q]);
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("All");
  const [skill, setSkill] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [mustOnly, setMustOnly] = useState(false);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [explainId, setExplainId] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const ranked = useMemo(
    () => rankCandidates(candidates, weights),
    [candidates, weights],
  );

  const allSkills = useMemo(
    () =>
      [...new Set(candidates.flatMap((c) => c.skills))].sort((a, b) =>
        a.localeCompare(b),
      ),
    [candidates],
  );

  const filtered = useMemo(
    () =>
      ranked.filter(
        (c) =>
          c.score.overall >= minScore &&
          (level === "All" || c.level === level) &&
          (skill === "All" || c.skills.includes(skill)) &&
          (!mustOnly ||
            (c.mustHaves.total > 0 && c.mustHaves.met === c.mustHaves.total)) &&
          (query === "" ||
            c.contact.name.toLowerCase().includes(query.toLowerCase()) ||
            c.title.toLowerCase().includes(query.toLowerCase()) ||
            c.skills.some((s) =>
              s.toLowerCase().includes(query.toLowerCase()),
            )),
      ),
    [ranked, minScore, level, skill, mustOnly, query],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  if (!job || (candidates.length === 0 && !run?.running)) {
    return (
      <EmptyState
        hasJob={Boolean(job)}
        poolSize={poolSize}
        loading={candidatesLoading}
        onDemo={loadDemoData}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">
            Candidate Ranking
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} of {candidates.length} candidates match your
            filters · scored against {job.title}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {compareIds.length > 0 && (
            <Link
              to="/compare"
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Compare ({compareIds.length})
            </Link>
          )}
          <Button
            variant="outline"
            className="rounded-xl"
            onClick={() => setPanelOpen((p) => !p)}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" /> Weights
          </Button>
        </div>
      </header>

      {run?.running && (
        <div className="card-surface flex items-center gap-3 p-4">
          <span className="h-2 w-2 animate-pulse rounded-full bg-primary" />
          <p className="text-sm text-muted-foreground">
            Screening in progress — {run.scored} of {run.total} scored,{" "}
            {run.aiAnalyzed} with full AI analysis. Results appear as they land.
          </p>
        </div>
      )}
      {run?.error && (
        <div className="card-surface border-destructive/40 p-4 text-sm text-destructive">
          Screening failed: {run.error}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="min-w-0 space-y-4">
          <div className="card-surface grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
            <div className="relative min-w-0">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setPage(1);
                }}
                placeholder="Search name, role, skill"
                className="rounded-xl pl-9"
              />
            </div>
            <select
              value={level}
              onChange={(e) => {
                setLevel(e.target.value as (typeof LEVELS)[number]);
                setPage(1);
              }}
              className="h-9 min-w-0 rounded-xl border bg-background px-3 text-sm"
            >
              {LEVELS.map((l) => (
                <option key={l} value={l}>
                  {l === "All" ? "All experience levels" : l}
                </option>
              ))}
            </select>
            <select
              value={skill}
              onChange={(e) => {
                setSkill(e.target.value);
                setPage(1);
              }}
              className="h-9 min-w-0 rounded-xl border bg-background px-3 text-sm"
            >
              <option value="All">All skills</option>
              {allSkills.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="min-w-0">
              <p className="mb-1 text-[11px] text-muted-foreground">
                Min score: {minScore}
              </p>
              <Slider
                value={[minScore]}
                max={100}
                step={5}
                onValueChange={(v) => {
                  setMinScore(v[0] ?? 0);
                  setPage(1);
                }}
              />
            </div>
          </div>

          <label className="flex w-fit cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={mustOnly}
              onChange={(e) => {
                setMustOnly(e.target.checked);
                setPage(1);
              }}
              className="h-3.5 w-3.5 rounded border-border"
            />
            Only candidates meeting every must-have
          </label>

          <div className="card-surface divide-y overflow-hidden">
            <div className="hidden grid-cols-[52px_minmax(0,1fr)_92px_minmax(0,1.3fr)_44px] items-center gap-4 px-5 py-3 text-[11px] font-bold uppercase tracking-wide text-muted-foreground md:grid">
              <span>Rank</span>
              <span>Candidate</span>
              <span>Score</span>
              <span>Category breakdown</span>
              <span />
            </div>

            {rows.map((c) => {
              const isOpen = expanded === c.id;
              const displayName = blindMode
                ? `Candidate #${c.rank}`
                : c.contact.name;
              return (
                <div
                  key={c.id}
                  className="transition-colors hover:bg-secondary/40"
                >
                  <div className="grid grid-cols-[52px_minmax(0,1fr)_92px] items-center gap-4 px-5 py-4 md:grid-cols-[52px_minmax(0,1fr)_92px_minmax(0,1.3fr)_44px]">
                    <span className="text-sm font-extrabold tabular-nums text-muted-foreground">
                      #{c.rank}
                    </span>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-foreground">
                        {blindMode ? "??" : c.initials}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">
                          {displayName}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.title} · {c.years} yrs ·{" "}
                          {blindMode ? c.level : c.contact.location}
                          {c.mustHaves.total > 0 && (
                            <>
                              {" · "}
                              <span
                                className={cn(
                                  "font-semibold",
                                  c.mustHaves.met === c.mustHaves.total
                                    ? "text-success"
                                    : "text-muted-foreground",
                                )}
                              >
                                {c.mustHaves.met}/{c.mustHaves.total} must-haves
                              </span>
                            </>
                          )}
                        </p>
                      </div>
                    </div>
                    <ScoreRing value={c.score.overall} />
                    <div className="hidden grid-cols-2 gap-x-4 gap-y-1.5 md:grid">
                      <MiniBar label="Skills" value={c.categories.skills} />
                      <MiniBar
                        label="Experience"
                        value={c.categories.experience}
                      />
                      <MiniBar
                        label="Education"
                        value={c.categories.education}
                      />
                      <MiniBar
                        label="Certs"
                        value={c.categories.certifications}
                      />
                    </div>
                    <button
                      onClick={() => setExpanded(isOpen ? null : c.id)}
                      aria-label="Toggle explanation"
                      className="hidden h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary md:grid"
                    >
                      <ChevronDown
                        className={cn(
                          "h-4 w-4 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 px-5 pb-4 md:hidden">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl"
                      onClick={() => setExpanded(isOpen ? null : c.id)}
                    >
                      {isOpen ? "Hide" : "Why this rank?"}
                    </Button>
                  </div>

                  {isOpen && (
                    <div className="space-y-4 border-t bg-secondary/30 px-5 py-5">
                      {c.summary && (
                        <p className="flex items-start gap-2 text-sm">
                          <Sparkle className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                          <span>{c.summary}</span>
                        </p>
                      )}

                      <div className="grid gap-4 md:grid-cols-3">
                        {(
                          [
                            ["Strengths", c.strengths],
                            ["Gaps", c.gaps],
                            ["Transferable skills", c.transferable],
                          ] as const
                        ).map(([title, items]) => (
                          <div key={title}>
                            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                              {title}
                            </p>
                            <ul className="mt-2 space-y-1.5 text-sm">
                              {items.length ? (
                                items.map((t) => (
                                  <li
                                    key={t}
                                    className="flex gap-2 text-muted-foreground"
                                  >
                                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                    {t}
                                  </li>
                                ))
                              ) : (
                                <li className="text-muted-foreground">—</li>
                              )}
                            </ul>
                          </div>
                        ))}
                      </div>

                      {/* Per-category signal breakdown — how keyword/semantic/AI contributed */}
                      <div>
                        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                          Score breakdown
                        </p>
                        <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                          {c.score.categories.map(
                            ({ category, value, signals }) => (
                              <div
                                key={category}
                                className="rounded-lg bg-background/60 px-2.5 py-2 text-xs"
                              >
                                <div className="flex items-center justify-between">
                                  <span className="font-semibold capitalize">
                                    {category}
                                  </span>
                                  <span className="tabular-nums font-bold">
                                    {value}
                                  </span>
                                </div>
                                <div className="mt-0.5 flex flex-wrap gap-x-3 text-muted-foreground">
                                  <span>keyword {signals.keyword}</span>
                                  <span>semantic {signals.semantic}</span>
                                  <span>ai {signals.ai ?? "—"}</span>
                                </div>
                              </div>
                            ),
                          )}
                        </div>
                      </div>

                      {job.requirements.length > 0 && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            Requirement coverage
                          </p>
                          <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                            {job.requirements.map((r) => {
                              const verdict = c.requirements.find(
                                (v) => v.requirementId === r.id,
                              );
                              const status = verdict?.status ?? "missing";
                              return (
                                <div
                                  key={r.id}
                                  className="flex items-start gap-2 rounded-lg bg-background/60 px-2.5 py-1.5 text-xs"
                                  title={verdict?.evidence}
                                >
                                  <span
                                    className={cn(
                                      "mt-1 h-2 w-2 shrink-0 rounded-full",
                                      status === "met"
                                        ? "bg-success"
                                        : status === "partial"
                                          ? "bg-warning"
                                          : "bg-destructive/60",
                                    )}
                                  />
                                  <span className="min-w-0">
                                    <span className="font-medium">
                                      {r.text}
                                    </span>
                                    {r.must && (
                                      <span className="ml-1 text-[10px] font-bold text-primary">
                                        MUST
                                      </span>
                                    )}
                                    {verdict?.evidence && (
                                      <span className="block truncate text-muted-foreground">
                                        {verdict.evidence}
                                      </span>
                                    )}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}

                      {c.evidence.length > 0 && (
                        <div>
                          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                            Evidence
                          </p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            {c.evidence.map((e) => (
                              <span
                                key={e.id}
                                title={`“${e.quote}” · Source: ${e.source}`}
                                className="rounded-full bg-primary-soft px-3 py-1 text-[11px] font-medium text-primary-soft-foreground"
                              >
                                {e.claim}
                                <span className="ml-1.5 text-[10px] font-bold uppercase opacity-70">
                                  {e.provenance}
                                </span>
                              </span>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="flex flex-wrap items-center gap-3">
                        <Button
                          size="sm"
                          variant={explainId === c.id ? "default" : "outline"}
                          className="rounded-xl"
                          onClick={() =>
                            setExplainId(explainId === c.id ? null : c.id)
                          }
                        >
                          <Sparkle className="mr-1.5 h-3.5 w-3.5" />
                          {explainId === c.id
                            ? "Hide evidence trace"
                            : "Explain score"}
                        </Button>
                        <Button
                          size="sm"
                          variant={
                            compareIds.includes(c.id) ? "default" : "outline"
                          }
                          className="rounded-xl"
                          onClick={() => toggleCompare(c.id)}
                        >
                          {compareIds.includes(c.id)
                            ? "Selected for comparison"
                            : "Add to comparison"}
                        </Button>
                        <p className="text-[11px] text-muted-foreground">
                          {c.aiAnalyzed
                            ? "Scored with keyword + semantic + AI analysis"
                            : "Scored with keyword + semantic signals only"}{" "}
                          · source: {c.fileName}
                        </p>
                      </div>

                      {explainId === c.id && (
                        <ExplainTrace candidateId={c.id} jobId={job.id} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {rows.length === 0 && (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                No candidates match these filters.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Page {current} of {pageCount}
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={current === pageCount}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </div>

        {panelOpen && (
          <aside className="card-surface h-fit space-y-5 p-5 lg:sticky lg:top-24">
            <div>
              <h2 className="text-base font-bold">Score weights</h2>
              <p className="text-xs text-muted-foreground">
                Re-ranks the list instantly
              </p>
            </div>

            {WEIGHT_KEYS.map((key) => (
              <div key={key}>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold capitalize">{key}</span>
                  <span className="tabular-nums text-muted-foreground">
                    {weights[key]}%
                  </span>
                </div>
                <Slider
                  value={[weights[key]]}
                  max={100}
                  step={5}
                  onValueChange={(v) =>
                    setWeights({ ...weights, [key]: v[0] ?? 0 })
                  }
                />
              </div>
            ))}

            <Button
              variant="outline"
              size="sm"
              className="w-full rounded-xl"
              onClick={() => setWeights(DEFAULT_WEIGHTS)}
            >
              Reset weights
            </Button>

            <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 p-3">
              <div className="flex min-w-0 items-center gap-2">
                <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">Blind review</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    Hides names & contact info
                  </p>
                </div>
              </div>
              <Switch checked={blindMode} onCheckedChange={setBlindMode} />
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

/** Evidence trace served by the per-candidate explain endpoint (P4/P5). */
function ExplainTrace({
  candidateId,
  jobId,
}: {
  candidateId: string;
  jobId: string;
}) {
  const query = useQuery({
    queryKey: ["explain", candidateId],
    queryFn: () => explainCandidate({ data: { candidateId, jobId } }),
  });

  if (query.isLoading) {
    return (
      <p className="text-xs text-muted-foreground">Loading evidence trace…</p>
    );
  }
  if (query.isError) {
    return <p className="text-xs text-destructive">{String(query.error)}</p>;
  }
  const data = query.data;
  if (!data) return null;

  return (
    <div className="space-y-4 rounded-xl bg-background/60 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Evidence trace
        </p>
        <p className="text-xs text-muted-foreground">
          Overall{" "}
          <span className="font-bold text-foreground">
            {data.score.overall}
          </span>
          {data.score.aiAnalyzed ? " · AI-influenced" : ""}
        </p>
      </div>
      {data.evidence.length > 0 ? (
        <div className="space-y-2">
          {data.evidence.map((e) => (
            <div
              key={e.id}
              className="rounded-lg border border-border/60 bg-background px-3 py-2 text-xs"
            >
              <p className="font-semibold">{e.claim}</p>
              <p className="mt-0.5 text-muted-foreground">“{e.quote}”</p>
              <p className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">
                {e.provenance} · {e.source} · confidence{" "}
                {Math.round(e.confidence * 100)}%
              </p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          No citable evidence was captured for this candidate.
        </p>
      )}
    </div>
  );
}

function EmptyState({
  hasJob,
  poolSize,
  loading,
  onDemo,
}: {
  hasJob: boolean;
  poolSize: number;
  loading: boolean;
  onDemo: () => void;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <div className="card-surface p-10 text-center">
        <h1 className="text-2xl font-extrabold">Candidate Ranking</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {loading
            ? "Loading…"
            : !hasJob
              ? "Analyze a job description first — candidates are ranked against its requirements."
              : poolSize === 0
                ? "No parsed resumes yet. Upload a batch, then run screening from the job description page."
                : "Requirements are ready. Run screening from the job description page to rank this pool."}
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link
            to="/upload"
            className="inline-flex rounded-xl border px-4 py-2.5 text-sm font-semibold"
          >
            Upload resumes
          </Link>
          <Link
            to="/job-analysis"
            className="inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Job description
          </Link>
          <button
            onClick={onDemo}
            aria-label="Load demo data"
            className="inline-flex rounded-xl border border-primary/40 px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:bg-primary-soft"
          >
            Try the demo
          </button>
        </div>
      </div>
    </div>
  );
}
