import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  ArrowUpRight,
  BadgeCheck,
  Brain,
  CircleAlert,
  FileCheck2,
  Gauge,
  Sparkle,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";
import { useAppState } from "@/lib/app-state";
import {
  getDashboardInsights,
  getJdOptimization,
  type DashboardInsights,
  type JDOptimizationResponse,
  type JDSuggestion,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import {
  CANDIDATES,
  EXPERIENCE_BREAKDOWN,
  SKILL_DISTRIBUTION,
  rankCandidates,
  scoreBuckets,
} from "@/lib/mock-data";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Hiring Insights — ResumeIQ" },
      {
        name: "description",
        content:
          "Live hiring insights: candidate volume, average match score, skill distribution and AI-detected qualification gaps.",
      },
      { property: "og:title", content: "Hiring Insights — ResumeIQ" },
      {
        property: "og:description",
        content: "Candidate volume, match scores, skill distribution and AI qualification gaps.",
      },
    ],
  }),
  component: Dashboard,
});

function StatCard({
  icon: Icon,
  label,
  value,
  delta,
}: {
  icon: typeof Users;
  label: string;
  value: string;
  delta: string;
}) {
  return (
    <div className="card-surface p-5 transition-shadow duration-300 hover:shadow-(--shadow-lift)">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <Icon className="h-5 w-5" />
        </span>
        <span className="inline-flex items-center gap-0.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
          <ArrowUpRight className="h-3 w-3" /> {delta}
        </span>
      </div>
      <p className="mt-4 text-3xl font-extrabold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-sm text-muted-foreground">{label}</p>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card-surface p-5">
      <h2 className="text-base font-bold">{title}</h2>
      <p className="mb-4 text-xs text-muted-foreground">{subtitle}</p>
      <div className="h-60 w-full">{children}</div>
    </div>
  );
}

const tooltipStyle = {
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
};

const CLASSIFICATION_META: Record<
  JDSuggestion["classification"],
  { label: string; icon: typeof CircleAlert; className: string }
> = {
  too_strict: {
    label: "Too Strict",
    icon: TrendingDown,
    className: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  },
  low_signal: {
    label: "Low Signal",
    icon: CircleAlert,
    className: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  },
  under_filtered: {
    label: "Under-filtered",
    icon: TrendingUp,
    className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  },
  balanced: {
    label: "Balanced",
    icon: BadgeCheck,
    className: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  },
  insufficient_data: {
    label: "Insufficient Data",
    icon: CircleAlert,
    className: "bg-secondary text-muted-foreground",
  },
};

function classificationPriority(value: JDSuggestion["classification"]) {
  switch (value) {
    case "too_strict":
      return 0;
    case "under_filtered":
      return 1;
    case "low_signal":
      return 2;
    case "insufficient_data":
      return 3;
    default:
      return 4;
  }
}

function Dashboard() {
  const { weights, activeJobId, backendReady, setActiveJobId } = useAppState();
  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);
  const avg = Math.round(ranked.reduce((s, c) => s + c.score, 0) / ranked.length);
  const buckets = useMemo(() => scoreBuckets(ranked), [ranked]);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [optimization, setOptimization] = useState<JDOptimizationResponse | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!backendReady || !activeJobId) {
        setInsights(null);
        setOptimization(null);
        return;
      }

      try {
        const [nextInsights, nextOptimization] = await Promise.all([
          getDashboardInsights(activeJobId),
          getJdOptimization(activeJobId),
        ]);
        if (cancelled) return;
        setInsights(nextInsights);
        setOptimization(nextOptimization);
      } catch {
        if (!cancelled) {
          setInsights(null);
          setOptimization(null);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeJobId, backendReady]);

  const suggestions = useMemo(
    () =>
      [...(optimization?.suggestions ?? [])].sort(
        (a, b) =>
          classificationPriority(a.classification) - classificationPriority(b.classification) ||
          a.coverage_pct - b.coverage_pct,
      ),
    [optimization],
  );
  const coverageData = useMemo(
    () => [...suggestions].sort((a, b) => a.coverage_pct - b.coverage_pct),
    [suggestions],
  );
  const summary = optimization?.summary?.trim() ?? "";
  const needsJobAnalysis = summary.toLowerCase().startsWith("analyze the job description first");
  const emptySuggestions = suggestions.length === 0;
  const topFlag = insights?.jd_top_flag as JDSuggestion["classification"] | null | undefined;

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Hiring Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Senior Backend Engineer · pipeline snapshot
          </p>
        </div>
        <Link
          to="/candidates"
          className="shrink-0 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          View ranking
        </Link>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Users} label="Total candidates" value={String(ranked.length)} delta="12%" />
        <StatCard icon={Gauge} label="Average match score" value={`${avg}`} delta="4 pts" />
        <StatCard
          icon={Brain}
          label={`Top skill · ${SKILL_DISTRIBUTION[0]!.skill}`}
          value={`${SKILL_DISTRIBUTION[0]!.count}`}
          delta="8%"
        />
        <StatCard icon={FileCheck2} label="Resumes processed" value="1,486" delta="230 today" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Skill distribution" subtitle="Candidates per detected skill">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={SKILL_DISTRIBUTION.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="skill" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="var(--chart-1)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Score distribution" subtitle="Candidates per match-score band">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={buckets}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                {buckets.map((_, i) => (
                  <Cell key={i} fill={i >= 3 ? "var(--chart-1)" : "var(--chart-2)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Experience levels" subtitle="Seniority breakdown of the pool">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={EXPERIENCE_BREAKDOWN} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis
                type="category"
                dataKey="level"
                width={70}
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
              />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" radius={[0, 8, 8, 0]} fill="var(--chart-1)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Requirement coverage" subtitle="Coverage % per requirement, sorted ascending">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={coverageData} layout="vertical" margin={{ left: 8, right: 12 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
              <XAxis
                type="number"
                domain={[0, 100]}
                tickFormatter={(value) => `${value}%`}
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
              />
              <YAxis
                type="category"
                dataKey="skill"
                width={120}
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value, name) => [
                  `${Number(value).toFixed(1)}%`,
                  name === "coverage_pct" ? "Coverage" : String(name),
                ]}
                labelFormatter={(label) => String(label)}
                cursor={{ fill: "var(--muted)" }}
              />
              <Bar dataKey="coverage_pct" radius={[0, 8, 8, 0]}>
                {coverageData.map((item) => (
                  <Cell
                    key={item.skill}
                    fill={
                      item.classification === "too_strict"
                        ? "var(--chart-4)"
                        : item.classification === "under_filtered"
                          ? "var(--chart-1)"
                          : item.classification === "low_signal"
                            ? "var(--chart-2)"
                            : item.classification === "insufficient_data"
                              ? "var(--muted)"
                              : "var(--chart-3)"
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="card-surface p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-primary-soft-foreground">
            <Sparkle className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wide">AI insight</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {topFlag ? (
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                  CLASSIFICATION_META[topFlag].className,
                )}
              >
                {CLASSIFICATION_META[topFlag].label}
              </span>
            ) : null}
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-[11px] font-semibold text-muted-foreground">
              {insights?.jd_suggestions_count ?? suggestions.length} suggestions
            </span>
          </div>
        </div>

        <h2 className="mt-3 text-lg font-bold">JD Optimization</h2>

        {summary ? <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{summary}</p> : null}

        {emptySuggestions ? (
          <div className="mt-4 rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            {needsJobAnalysis
              ? "Visit Job Description Analysis first to extract requirements."
              : "Run some candidates through screening to see JD suggestions."}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {suggestions.map((item) => {
              const meta = CLASSIFICATION_META[item.classification];
              const Icon = meta.icon;
              return (
                <div key={item.skill} className="rounded-2xl border bg-background/70 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.skill}</p>
                      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                        {item.candidates_matching}/{item.total_candidates} candidates ({item.coverage_pct.toFixed(1)}%)
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[10px] font-bold",
                        meta.className,
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {meta.label}
                    </span>
                  </div>

                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary/70">
                    <div
                      className="h-full rounded-full bg-primary"
                      style={{ width: `${Math.min(100, Math.max(0, item.coverage_pct))}%` }}
                    />
                  </div>

                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{item.suggestion}</p>

                  <Link
                    to="/job-analysis"
                    onClick={() => setActiveJobId(activeJobId)}
                    className="mt-3 inline-flex items-center gap-1 rounded-full bg-primary-soft px-3 py-1.5 text-xs font-semibold text-primary-soft-foreground transition-opacity hover:opacity-90"
                  >
                    Review in Job Description
                    <ArrowUpRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}