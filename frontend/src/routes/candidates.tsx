import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Calendar,
  Check,
  ChevronDown,
  EyeOff,
  Loader2,
  Search,
  SlidersHorizontal,
  Trophy,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useAppState } from "@/lib/app-state";
import { allSkills, DEFAULT_WEIGHTS, rankCandidates, type Candidate } from "@/lib/candidates";
import { useCandidatePool } from "@/lib/use-candidate-pool";
import {
  listJobPipelines,
  submitCandidateDecision,
  type CandidateDecisionKind,
  type InterviewSlot,
  type JobPipelineSummary,
} from "@/lib/api";
import { MiniBar } from "@/components/score-ring";
import { AtsScoreBadge } from "@/components/ats-score-badge";
import { CandidateInterviewSection } from "@/components/interview-card";
import { CandidateScreeningSection } from "@/components/screening";
import { CandidateRoleActions } from "@/components/candidate-role-actions";
import { CurrentRoleButton, SourceBadge } from "@/components/source-badge";
import { ShareCandidateButton } from "@/components/share-candidate-button";
import { Button } from "@/components/ui/button";




import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

type DecisionState =
  | { status: "sending" }
  | {
      status: "done";
      decision: CandidateDecision;
      source: "live" | "mock";
      slots: InterviewSlot[];
      error?: string | null | undefined;
    };

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
  // Global search sends the recruiter here with the candidate it matched, so
  // the result lands on that person rather than on the top of an unfiltered
  // list they then have to scan by hand.
  validateSearch: (search: Record<string, unknown>): { focus?: string | undefined } => {
    const raw = search["focus"];
    return typeof raw === "string" && raw ? { focus: raw } : {};
  },
  component: Candidates,
});

const LEVELS = ["All", "Junior", "Mid", "Senior", "Lead"] as const;
const PAGE_SIZE = 12;
const WEIGHT_KEYS = ["skills", "experience", "education", "certifications", "projects"] as const;
const CATEGORY_LABELS: Record<(typeof WEIGHT_KEYS)[number], string> = {
  skills: "skills",
  experience: "experience",
  education: "education",
  certifications: "certifications",
  projects: "project work",
};

/** One-line, always-visible reason for a candidate's rank — the strongest
 * scoring category plus the top gap (if any), so recruiters don't have to
 * expand each row to see why someone landed where they did. */
function rankReason(c: Candidate, allRows: Candidate[]): string {
  const topCategory = WEIGHT_KEYS.reduce(
    (best, key) => (c.categories[key] > c.categories[best] ? key : best),
    "skills",
  );
  const topValue = c.categories[topCategory];
  const strengthPart = `strong ${CATEGORY_LABELS[topCategory]} (${topValue})`;

  const gapPart = c.gaps.length > 0 ? c.gaps[0] : null;

  const idx = allRows.findIndex((r) => r.id === c.id);
  const prev = idx > 0 ? allRows[idx - 1] : undefined;
  const behindPrev = prev ? prev.score - c.score : null;
  const positionPart =
    behindPrev !== null && behindPrev > 0
      ? `${behindPrev.toFixed(0)} pts behind #${c.rank - 1}`
      : null;

  return [strengthPart, gapPart, positionPart].filter(Boolean).join(" · ");
}

/**
 * What a recruiter can do to a candidate, mirroring the backend's
 * CANDIDATE_DECISIONS. Each carries the wording of the email that goes out,
 * so the confirmation step says exactly what will be sent.
 */
type CandidateDecision = CandidateDecisionKind;

const DECISIONS: Record<
  CandidateDecision,
  { label: string; done: string; confirm: string; icon: typeof Check; tone: string; doneTone: string }
> = {
  advanced: {
    label: "Advance",
    done: "Advanced to next round",
    confirm: "Send next-round invitation",
    icon: ArrowRight,
    tone: "border-primary/30 text-primary hover:bg-primary/10 dark:border-primary/30 dark:text-primary dark:hover:bg-primary/10",
    doneTone: "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary",
  },
  approved: {
    label: "Select",
    done: "Selected",
    confirm: "Send selection",
    icon: Check,
    tone: "border-success/40 text-success hover:bg-success/10 dark:border-success/40 dark:text-success dark:hover:bg-success/10",
    doneTone: "bg-success/10 text-success dark:bg-success/15 dark:text-success",
  },
  hired: {
    label: "Hire",
    done: "Hired",
    confirm: "Send offer",
    icon: Trophy,
    tone: "border-primary/40 text-primary hover:bg-primary-soft dark:border-primary/30 dark:text-primary dark:hover:bg-primary/10",
    doneTone: "bg-primary-soft text-primary dark:bg-primary/15 dark:text-primary",
  },
  rejected: {
    label: "Reject",
    done: "Rejected",
    confirm: "Send rejection",
    icon: X,
    tone: "border-destructive/30 text-destructive hover:bg-destructive/10 dark:border-destructive/30 dark:text-destructive dark:hover:bg-destructive/10",
    doneTone: "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
  },
};

function DecisionControls({
  candidate,
  state,
  onDecide,
  blindMode,
  displayName,
}: {
  candidate: Candidate;
  state: DecisionState | undefined;
  onDecide: (decision: CandidateDecision) => void;
  blindMode: boolean;
  displayName: string;
}) {
  const [pending, setPending] = useState<CandidateDecision | null>(null);

  if (state?.status === "sending") {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-xl bg-secondary px-3 py-1.5 text-xs font-semibold text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending email…
      </span>
    );
  }

  if (state?.status === "done") {
    const meta = DECISIONS[state.decision];
    const Icon = meta.icon;
    return (
      <span
        className={cn(
          "animate-pop inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold",
          meta.doneTone,
        )}
      >
        <Icon className="h-3.5 w-3.5" />
        {meta.done} — email {state.source === "mock" ? "logged (mock)" : "sent"}
      </span>
    );
  }

  if (pending) {
    return (
      <div className="animate-fade flex flex-wrap items-center gap-2 text-xs">
        <span className="text-muted-foreground">
          {DECISIONS[pending].confirm} email to {blindMode ? displayName : candidate.email}?
        </span>
        <Button
          size="sm"
          className="rounded-xl"
          onClick={() => {
            onDecide(pending);
            setPending(null);
          }}
        >
          Confirm
        </Button>
        <Button size="sm" variant="ghost" className="rounded-xl" onClick={() => setPending(null)}>
          Cancel
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {(Object.keys(DECISIONS) as CandidateDecision[]).map((key) => {
        const meta = DECISIONS[key];
        const Icon = meta.icon;
        return (
          <Button
            key={key}
            size="sm"
            variant="outline"
            className={cn("rounded-xl", meta.tone)}
            onClick={() => setPending(key)}
          >
            <Icon className="mr-1.5 h-3.5 w-3.5" /> {meta.label}
          </Button>
        );
      })}
    </div>
  );
}

function Candidates() {

  const {
    weights,
    setWeights,
    resetWeights,
    blindMode,
    setBlindMode,
    compareIds,
    toggleCompare,
    setViewingCandidateId,
    activeJobId,
    refreshPool,
  } = useAppState();
  const { focus } = Route.useSearch();
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState<(typeof LEVELS)[number]>("All");
  const [skill, setSkill] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [page, setPage] = useState(1);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [roleOptions, setRoleOptions] = useState<JobPipelineSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    listJobPipelines()
      .then((rows) => !cancelled && setRoleOptions(rows))
      .catch(() => !cancelled && setRoleOptions([]));
    return () => {
      cancelled = true;
    };
  }, []);

  // Open and scroll to the candidate global search sent us to. Runs when the
  // id changes rather than on every render so it does not fight the user
  // scrolling away afterwards.
  useEffect(() => {
    if (!focus) return;
    setExpanded(focus);
    const row = document.getElementById(`candidate-row-${focus}`);
    row?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [focus]);
  const [panelOpen, setPanelOpen] = useState(true);
  const [decisions, setDecisions] = useState<Record<string, DecisionState>>({});

  // Candidates and their per-category scores both come from the backend
  // scoring pipeline; only the weighting of those categories is re-applied
  // locally so the sliders stay responsive.
  const { candidates: pool, loading: poolLoading, error: poolError } = useCandidatePool();
  const ranked = useMemo(() => rankCandidates(pool, weights), [pool, weights]);
  const skillOptions = useMemo(() => allSkills(pool), [pool]);


  async function handleDecision(candidate: Candidate, decision: CandidateDecision) {
    setDecisions((d) => ({ ...d, [candidate.id]: { status: "sending" } }));
    try {
      const result = await submitCandidateDecision({
        candidate_id: candidate.id,
        name: candidate.name,
        email: candidate.email,
        decision,
        job_title: candidate.title,
      });
      setDecisions((d) => ({
        ...d,
        [candidate.id]: {
          status: "done",
          decision: result.decision,
          source: result.email_source,
          slots: result.calendar_slots,
          error: result.email_error,
        },
      }));
      if (result.email_sent) {
        const label = blindMode ? `Candidate #${candidate.rank}` : candidate.name;
        toast.success(
          `${DECISIONS[decision].done} — email ${result.email_source === "mock" ? "logged (mock — configure SMTP to send for real)" : `sent to ${label}`}`,
        );
      } else {
        toast.error(`Email failed to send: ${result.email_error ?? "unknown error"}`);
      }
    } catch (error) {
      setDecisions((d) => {
        const next = { ...d };
        delete next[candidate.id];
        return next;
      });
      toast.error(error instanceof Error ? error.message : "Could not submit decision");
    }
  }

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
    <div className="mx-auto flow max-w-7xl">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Review candidates</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {poolLoading
              ? "Scoring candidates against the active job…"
              : poolError
                ? `Could not load candidates: ${poolError}`
                : `${filtered.length} candidates match your filters`}
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
          <Button variant="outline" className="rounded-xl" onClick={() => setPanelOpen((p) => !p)}>
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
              {skillOptions.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <div className="min-w-0">
              <p className="mb-1 text-xs text-muted-foreground">Min score: {minScore}</p>
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
            <div className="hidden grid-cols-[52px_minmax(0,1fr)_148px_minmax(0,1.4fr)_44px] items-center gap-4 px-5 py-3 text-xs font-bold uppercase tracking-wide text-muted-foreground md:grid">
              <span>Rank</span>
              <span>Candidate</span>
              <span>ATS score</span>
              <span>Category scores</span>
              <span />
            </div>

            {focus && blindMode && (
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-warning/10 px-5 py-3 text-xs dark:bg-warning/10">
                <span className="text-warning dark:text-warning">
                  Blind review is on, so names and contact details are hidden — the
                  candidate you searched for is shown as a number.
                </span>
                <button
                  type="button"
                  onClick={() => setBlindMode(false)}
                  className="shrink-0 rounded-lg border border-warning/40 px-2.5 py-1 font-semibold text-warning transition-colors hover:bg-warning/15 dark:border-warning/40 dark:text-warning dark:hover:bg-warning/20"
                >
                  Show names
                </button>
              </div>
            )}

            {rows.map((c) => {
              const isOpen = expanded === c.id;
              const displayName = blindMode ? `Candidate #${c.rank}` : c.name;
              return (
                <div
                  key={c.id}
                  id={`candidate-row-${c.id}`}
                  className={cn(
                    "animate-fade transition-colors hover:bg-secondary/40",
                    focus === c.id && "bg-primary/5 ring-1 ring-inset ring-primary/30",
                  )}
                >
                  <div className="grid grid-cols-[52px_minmax(0,1fr)_148px] items-center gap-4 px-5 py-4 md:grid-cols-[52px_minmax(0,1fr)_148px_minmax(0,1.4fr)_44px]">
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
                        <p className="truncate text-xs text-primary-soft-foreground/80">
                          {rankReason(c, rows)}
                        </p>
                      </div>
                    </div>
                    <AtsScoreBadge score={c.score} size={52} />
                    <div className="hidden grid-cols-2 gap-x-4 gap-y-1.5 md:grid">
                      <MiniBar label="Skills" value={c.categories.skills} />
                      <MiniBar label="Experience" value={c.categories.experience} />
                      <MiniBar label="Education" value={c.categories.education} />
                      <MiniBar label="Projects" value={c.categories.projects} />
                    </div>
                    <button
                      onClick={() => {
                        setExpanded(isOpen ? null : c.id);
                        setViewingCandidateId(isOpen ? null : c.id);
                      }}
                      aria-label="Toggle explanation"
                      className="hidden h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary md:grid"
                    >
                      <ChevronDown
                        className={cn("h-4 w-4 transition-transform", isOpen && "rotate-180")}
                      />
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 px-5 pb-4">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="rounded-xl md:hidden"
                      onClick={() => {
                        setExpanded(isOpen ? null : c.id);
                        setViewingCandidateId(isOpen ? null : c.id);
                      }}
                    >
                      {isOpen ? "Hide" : "Why this rank?"}
                    </Button>
                    <SourceBadge
                      source={c.origin}
                      currentAssignment={c.currentAssignment ?? null}
                      onBench={c.employmentStatus === "bench"}
                    />
                    {c.origin === "internal" && (
                      <CurrentRoleButton
                        currentAssignment={c.currentAssignment ?? null}
                        onBench={c.employmentStatus === "bench"}
                      />
                    )}
                    <CandidateRoleActions
                      candidateId={c.id}
                      candidateName={blindMode ? displayName : c.name}
                      currentJobId={c.jobId ?? null}
                      source={c.origin}
                      employmentStatus={c.employmentStatus ?? null}
                      jobs={roleOptions}
                      onChanged={refreshPool}
                    />
                    <div className="ml-auto">
                      <ShareCandidateButton
                        candidateId={c.id}
                        candidateName={blindMode ? displayName : c.name}
                        jobId={activeJobId}
                      />
                      <DecisionControls
                        candidate={c}
                        state={decisions[c.id]}
                        onDecide={(decision) => void handleDecision(c, decision)}
                        blindMode={blindMode}
                        displayName={displayName}
                      />
                    </div>
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
                            className="rounded-full bg-primary-soft px-3 py-1 text-xs font-medium text-primary-soft-foreground"
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
                        {compareIds.includes(c.id)
                          ? "Selected for comparison"
                          : "Add to comparison"}
                      </Button>

                      {(() => {
                        const state = decisions[c.id];
                        if (
                          state?.status !== "done" ||
                          state.decision !== "approved" ||
                          state.slots.length === 0
                        ) {
                          return null;
                        }
                        return (
                          <div>
                            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                              Interview slots included in the email
                            </p>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {state.slots.map((s: InterviewSlot) => (
                                <a
                                  key={s.outlook_url}
                                  href={s.outlook_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1.5 rounded-full border bg-background px-3 py-1 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-foreground"
                                >
                                  <Calendar className="h-3 w-3" /> {s.label}
                                </a>
                              ))}
                            </div>
                          </div>
                        );
                      })()}


                      <CandidateInterviewSection
                        candidateId={c.id}
                        candidateName={blindMode ? displayName : c.name}
                        candidateEmail={c.email}
                      />

                      <CandidateScreeningSection
                        candidateId={c.id}
                        candidateName={blindMode ? displayName : c.name}
                      />
                    </div>
                  )}
                </div>
              );
            })}

            {rows.length === 0 && (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                {poolLoading ? (
                  <span className="inline-flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Loading ranked candidates…
                  </span>
                ) : poolError ? (
                  `Could not load ranked candidates — ${poolError}`
                ) : (
                  "No candidates match these filters."
                )}
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
                  <p className="truncate text-xs text-muted-foreground">
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
