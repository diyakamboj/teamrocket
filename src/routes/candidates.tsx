import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ChevronDown, EyeOff, Search, SlidersHorizontal } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { ALL_SKILLS, CANDIDATES, DEFAULT_WEIGHTS, rankCandidates } from "@/lib/mock-data";
import { MiniBar, ScoreRing } from "@/components/score-ring";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/candidates")({
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
        content: "Weighted candidate ranking with blind review and evidence-backed explanations.",
      },
    ],
  }),
  component: Candidates,
});

const LEVELS = ["All", "Junior", "Mid", "Senior", "Lead"] as const;
const PAGE_SIZE = 12;
const WEIGHT_KEYS = ["skills", "experience", "education", "certifications", "projects"] as const;

function Candidates() {
  const { weights, setWeights, blindMode, setBlindMode, compareIds, toggleCompare } = useAppState();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("All");
  const [skill, setSkill] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState(true);

  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);

  const filtered = useMemo(
    () =>
      ranked.filter(
        (c) =>
          c.score >= minScore &&
          (level === "All" || c.level === level) &&
          (skill === "All" || c.skills.includes(skill)) &&
          (query === "" ||
            c.name.toLowerCase().includes(query.toLowerCase()) ||
            c.title.toLowerCase().includes(query.toLowerCase()) ||
            c.skills.some((s) => s.toLowerCase().includes(query.toLowerCase()))),
      ),
    [ranked, minScore, level, skill, query],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Candidate Ranking</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {filtered.length} candidates match your filters
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
              {ALL_SKILLS.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="min-w-0">
              <p className="mb-1 text-[11px] text-muted-foreground">Min score: {minScore}</p>
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
              const displayName = blindMode ? `Candidate #${c.rank}` : c.name;
              return (
                <div key={c.id} className="transition-colors hover:bg-secondary/40">
                  <div className="grid grid-cols-[52px_minmax(0,1fr)_92px] items-center gap-4 px-5 py-4 md:grid-cols-[52px_minmax(0,1fr)_92px_minmax(0,1.3fr)_44px]">
                    <span className="text-sm font-extrabold tabular-nums text-muted-foreground">
                      #{c.rank}
                    </span>
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-foreground">
                        {blindMode ? "??" : c.initials}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{displayName}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {c.title} · {c.years} yrs · {blindMode ? c.level : c.location}
                        </p>
                      </div>
                    </div>
                    <ScoreRing value={c.score} />
                    <div className="hidden grid-cols-2 gap-x-4 gap-y-1.5 md:grid">
                      <MiniBar label="Skills" value={c.categories.skills} />
                      <MiniBar label="Experience" value={c.categories.experience} />
                      <MiniBar label="Education" value={c.categories.education} />
                      <MiniBar label="Certs" value={c.categories.certifications} />
                    </div>
                    <button
                      onClick={() => setExpanded(isOpen ? null : c.id)}
                      aria-label="Toggle explanation"
                      className="hidden h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary md:grid"
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
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
                              {items.map((t) => (
                                <li key={t} className="flex gap-2 text-muted-foreground">
                                  <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                                  {t}
                                </li>
                              ))}
                            </ul>
                          </div>
                        ))}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {c.evidence.map((e, i) => (
                          <span
                            key={i}
                            className="rounded-full bg-primary-soft px-3 py-1 text-[11px] font-medium text-primary-soft-foreground"
                          >
                            {e.skill} — {e.detail} | Source: {e.source}
                          </span>
                        ))}
                      </div>
                      <Button
                        size="sm"
                        variant={compareIds.includes(c.id) ? "default" : "outline"}
                        className="rounded-xl"
                        onClick={() => toggleCompare(c.id)}
                      >
                        {compareIds.includes(c.id) ? "Selected for comparison" : "Add to comparison"}
                      </Button>
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
              <p className="text-xs text-muted-foreground">Re-ranks the list instantly</p>
            </div>

            {WEIGHT_KEYS.map((key) => (
              <div key={key}>
                <div className="mb-2 flex items-center justify-between text-xs">
                  <span className="font-semibold capitalize">{key}</span>
                  <span className="tabular-nums text-muted-foreground">{weights[key]}%</span>
                </div>
                <Slider
                  value={[weights[key]]}
                  max={100}
                  step={5}
                  onValueChange={(v) => setWeights({ ...weights, [key]: v[0] ?? 0 })}
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
