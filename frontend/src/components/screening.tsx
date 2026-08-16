import { ClipboardCheck, FileText, Gauge, Link2, MessageSquareQuote, Target } from "lucide-react";
import type {
  ScreeningBriefing,
  ScreeningCitation,
  ScreeningSession,
  ScreeningScorecard,
} from "@/lib/api";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

const RATING_CLASS: Record<string, string> = {
  strong: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300",
  adequate: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
  weak: "bg-rose-100 text-rose-800 dark:bg-rose-500/15 dark:text-rose-300",
};

const SOURCE_ICON: Record<string, typeof FileText> = {
  resume: FileText,
  job_requirement: Target,
  evaluation: Gauge,
  screening: MessageSquareQuote,
};

export const COMPETENCY_LABELS: Record<string, string> = {
  technical_depth: "Technical depth",
  technical_gap: "Skill gap probe",
  problem_solving: "Problem solving",
  behavioral: "Behavioural",
  communication: "Communication",
  role_fit: "Role fit",
};

export function competencyLabel(competency: string) {
  return COMPETENCY_LABELS[competency] ?? competency.replace(/_/g, " ");
}

export function RatingChip({
  score,
  rating,
  className,
}: {
  score: number;
  rating: string;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums",
        RATING_CLASS[rating] ?? RATING_CLASS["weak"],
        className,
      )}
    >
      {Math.round(score)}
      <span className="font-medium opacity-80">{rating}</span>
    </span>
  );
}

/** Where a question or conclusion came from — resume, requirement, or answer. */
export function Citations({
  citations,
  label = "Why this",
}: {
  citations: ScreeningCitation[];
  label?: string;
}) {
  if (!citations || citations.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger className="inline-flex items-center gap-1 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground transition-colors hover:text-foreground">
        <Link2 className="h-3 w-3" aria-hidden="true" />
        {label} ({citations.length})
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2.5">
        {citations.map((c, i) => {
          const Icon = SOURCE_ICON[c.source] ?? FileText;
          return (
            <div key={`${c.label}-${i}`} className="flex gap-2">
              <Icon
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                  {c.label}
                </p>
                <p className="mt-0.5 text-xs leading-relaxed">{c.detail}</p>
              </div>
            </div>
          );
        })}
      </PopoverContent>
    </Popover>
  );
}

export function ScreeningProgress({ session }: { session: ScreeningSession }) {
  const total = session.question_count || 1;
  const done = Math.min(total, session.turns.length);
  return (
    <div className="min-w-0">
      <div className="flex items-center justify-between text-[11px] text-muted-foreground">
        <span>
          {session.status === "completed"
            ? `Screening complete · ${session.answered_count} answered`
            : `Question ${Math.min(done + 1, total)} of ${total}`}
        </span>
        <span className="tabular-nums">{Math.round((done / total) * 100)}%</span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div
          className="h-full rounded-full bg-primary transition-[width] duration-500"
          style={{ width: `${(done / total) * 100}%` }}
        />
      </div>
    </div>
  );
}

function isScorecard(value: unknown): value is ScreeningScorecard {
  return Boolean(value && typeof value === "object" && "overall_score" in value);
}

export function ScorecardPanel({ session }: { session: ScreeningSession }) {
  const scorecard = isScorecard(session.scorecard) ? session.scorecard : null;
  if (!scorecard || scorecard.answered === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        Scores appear here as answers are recorded — each one traced back to what was said.
      </p>
    );
  }

  const categories = Object.entries(scorecard.categories);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <span className="text-3xl font-extrabold tabular-nums">
          {Math.round(scorecard.overall_score)}
        </span>
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {scorecard.recommendation.replace(/_/g, " ")}
          </p>
          <p className="text-xs text-muted-foreground">{scorecard.recommendation_reason}</p>
        </div>
      </div>

      <div className="space-y-2">
        {categories.map(([name, bucket]) => (
          <div key={name} className="min-w-0">
            <div className="flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate capitalize text-muted-foreground">
                {name.replace(/_/g, " ")}
              </span>
              <RatingChip score={bucket.score} rating={bucket.rating} />
            </div>
            <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${bucket.score}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function BriefingList({
  title,
  items,
}: {
  title: string;
  items: { point: string; citations: ScreeningCitation[] }[];
}) {
  if (!items || items.length === 0) return null;
  return (
    <div>
      <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">{title}</p>
      <ul className="mt-2 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex flex-wrap items-start gap-2 text-sm">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 flex-1 text-muted-foreground">{item.point}</span>
            <Citations citations={item.citations} label="Evidence" />
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BriefingPanel({ briefing }: { briefing: ScreeningBriefing }) {
  const background = briefing.background;
  const performance = briefing.screening_performance;

  return (
    <div className="space-y-6">
      <div>
        <div className="flex items-center gap-2 text-primary">
          <ClipboardCheck className="h-4 w-4" />
          <span className="text-xs font-bold uppercase tracking-wide">Pre-interview briefing</span>
        </div>
        <p className="mt-2 text-sm leading-relaxed">{briefing.summary}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-xl bg-secondary/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Background
          </p>
          <p className="mt-2 text-sm font-semibold">{background.name}</p>
          <p className="text-xs text-muted-foreground">
            {[background.title, `${background.years_experience} yrs`, background.education]
              .filter(Boolean)
              .join(" · ")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            Applying for {background.applying_for}
            {background.match_score != null
              ? ` · profile match ${Math.round(background.match_score)}/100`
              : ""}
          </p>
          {background.matched_requirements.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Meets:</span>{" "}
              {background.matched_requirements.join(", ")}
            </p>
          )}
          {background.unmatched_requirements.length > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              <span className="font-semibold text-foreground">Missing:</span>{" "}
              {background.unmatched_requirements.join(", ")}
            </p>
          )}
        </div>

        <div className="rounded-xl bg-secondary/50 p-4">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Screening performance
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-2xl font-extrabold tabular-nums">
              {Math.round(performance.overall_score)}
            </span>
            <span className="text-xs font-semibold uppercase text-muted-foreground">
              {performance.recommendation.replace(/_/g, " ")}
            </span>
          </div>
          <ul className="mt-2 space-y-1">
            {performance.by_category.map((c) => (
              <li key={c.category} className="flex items-center justify-between gap-2 text-xs">
                <span className="truncate text-muted-foreground">{c.label}</span>
                <RatingChip score={c.score} rating={c.rating} />
              </li>
            ))}
          </ul>
        </div>
      </div>

      <BriefingList title="Strengths" items={briefing.strengths} />
      <BriefingList title="Weaknesses" items={briefing.weaknesses} />
      <BriefingList title="Concerns" items={briefing.concerns} />

      {briefing.skill_gaps.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Skill gaps
          </p>
          <div className="mt-2 space-y-2">
            {briefing.skill_gaps.map((gap) => (
              <div
                key={gap.skill}
                className="flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm"
              >
                <span className="font-semibold">{gap.skill}</span>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 text-[11px] font-bold",
                    gap.status === "probed"
                      ? "bg-secondary text-secondary-foreground"
                      : "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300",
                  )}
                >
                  {gap.status}
                </span>
                <span className="min-w-0 flex-1 text-xs text-muted-foreground">{gap.finding}</span>
                <Citations citations={gap.citations} label="Source" />
              </div>
            ))}
          </div>
        </div>
      )}

      {briefing.recommended_areas.length > 0 && (
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Explore in the interview
          </p>
          <div className="mt-2 space-y-3">
            {briefing.recommended_areas.map((area, i) => (
              <div key={i} className="rounded-xl border p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold">{area.area}</p>
                  <Citations citations={area.citations} label="Why" />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{area.why}</p>
                <p className="mt-2 text-sm">“{area.suggested_question}”</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/** Compact screening state for the Copilot chat thread. */
export function ScreeningInlineStatus({ session }: { session: ScreeningSession }) {
  const scorecard = isScorecard(session.scorecard) ? session.scorecard : null;
  return (
    <div className="mt-2 space-y-2 rounded-xl border bg-secondary/40 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-bold">L1 screening · {session.candidate_name}</p>
        {scorecard && scorecard.answered > 0 && (
          <RatingChip
            score={scorecard.overall_score}
            rating={
              scorecard.overall_score >= 72
                ? "strong"
                : scorecard.overall_score >= 48
                  ? "adequate"
                  : "weak"
            }
          />
        )}
      </div>
      <ScreeningProgress session={session} />
    </div>
  );
}
