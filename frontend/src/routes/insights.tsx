import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
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
import { toast } from "sonner";
import { useAppState } from "@/lib/app-state";
import {
  decideJdRecommendation,
  getDashboardDistribution,
  getDashboardInsights,
  getJdOptimization,
  type DashboardDistribution,
  type DashboardInsights,
  type JDOptimizationResponse,
  type JDRecommendation,
} from "@/lib/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { StatCard } from "@/components/stat-card";
import { ChartCard } from "@/components/chart-card";
import {
  experienceBreakdown,
  rankCandidates,
  scoreBuckets,
  skillDistribution,
} from "@/lib/candidates";
import { useCandidatePool } from "@/lib/use-candidate-pool";

export const Route = createFileRoute("/insights")({
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
  component: Insights,
});

const PIPELINE_STAGES = [
  "screened",
  "interviewing",
  "interviewed",
  "selected",
  "hired",
  "rejected",
] as const;

const SOURCE_LABELS: Record<string, string> = {
  internal: "Internal",
  external: "External",
};

const tooltipStyle = {
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
};

const CLASSIFICATION_META: Record<
  JDRecommendation["classification"],
  { label: string; icon: typeof CircleAlert; className: string }
> = {
  too_strict: {
    label: "Too Strict",
    icon: TrendingDown,
    className: "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
  },
  low_signal: {
    label: "Low Signal",
    icon: CircleAlert,
    className: "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
  },
  under_filtered: {
    label: "Under-filtered",
    icon: TrendingUp,
    className: "bg-success/10 text-success dark:bg-success/15 dark:text-success",
  },
  balanced: {
    label: "Balanced",
    icon: BadgeCheck,
    className: "bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary",
  },
  insufficient_data: {
    label: "Insufficient Data",
    icon: CircleAlert,
    className: "bg-secondary text-muted-foreground",
  },
};

function classificationPriority(value: JDRecommendation["classification"]) {
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

function dictChart(
  values: Record<string, number> | undefined,
  order: readonly string[],
  labels?: Record<string, string>,
) {
  return order.map((key) => ({
    key,
    label: labels?.[key] ?? key.replaceAll("_", " "),
    count: values?.[key] ?? 0,
  }));
}

function Insights() {
  const navigate = useNavigate();
  const { weights, activeJobId, backendReady, setActiveJobId } = useAppState();
  const { candidates: pool } = useCandidatePool();
  const ranked = useMemo(() => rankCandidates(pool, weights), [pool, weights]);
  const avg = ranked.length
    ? Math.round(ranked.reduce((s, c) => s + c.score, 0) / ranked.length)
    : 0;
  const buckets = useMemo(() => scoreBuckets(ranked), [ranked]);
  const skillCounts = useMemo(() => skillDistribution(pool), [pool]);
  const levelCounts = useMemo(() => experienceBreakdown(pool), [pool]);
  const [insights, setInsights] = useState<DashboardInsights | null>(null);
  const [distribution, setDistribution] = useState<DashboardDistribution | null>(null);
  const [optimization, setOptimization] = useState<JDOptimizationResponse | null>(null);
  const [modifyingId, setModifyingId] = useState<string | null>(null);
  const [modifyNote, setModifyNote] = useState("");
  const [pendingId, setPendingId] = useState<string | null>(null);

  async function reloadAnalytics() {
    if (!backendReady || !activeJobId) return;
    const [nextInsights, nextOptimization, nextDistribution] = await Promise.all([
      getDashboardInsights(activeJobId),
      getJdOptimization(activeJobId),
      getDashboardDistribution(activeJobId),
    ]);
    setInsights(nextInsights);
    setOptimization(nextOptimization);
    setDistribution(nextDistribution);
  }

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!backendReady || !activeJobId) {
        setInsights(null);
        setOptimization(null);
        setDistribution(null);
        return;
      }

      try {
        const [nextInsights, nextOptimization, nextDistribution] = await Promise.all([
          getDashboardInsights(activeJobId),
          getJdOptimization(activeJobId),
          getDashboardDistribution(activeJobId),
        ]);
        if (cancelled) return;
        setInsights(nextInsights);
        setOptimization(nextOptimization);
        setDistribution(nextDistribution);
      } catch {
        if (!cancelled) {
          setInsights(null);
          setOptimization(null);
          setDistribution(null);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [activeJobId, backendReady]);

  const recommendations = useMemo(
    () =>
      [...(optimization?.recommendations ?? [])].sort(
        (a, b) =>
          classificationPriority(a.classification) - classificationPriority(b.classification) ||
          a.coverage_pct - b.coverage_pct,
      ),
    [optimization],
  );
  const feed = useMemo(
    () => recommendations.filter((item) => item.status === "pending"),
    [recommendations],
  );
  const coverageData = useMemo(
    () => [...recommendations].sort((a, b) => a.coverage_pct - b.coverage_pct),
    [recommendations],
  );
  const pipelineData = useMemo(
    () => dictChart(distribution?.pipeline_progression ?? insights?.pipeline_progression, PIPELINE_STAGES),
    [distribution, insights],
  );
  const sourceData = useMemo(
    () =>
      dictChart(
        distribution?.candidate_sources ?? insights?.candidate_sources,
        ["internal", "external"],
        SOURCE_LABELS,
      ),
    [distribution, insights],
  );
  const summary = optimization?.summary?.trim() ?? "";
  const emptyReason = optimization?.empty_reason;
  const emptyFeed = feed.length === 0;
  const topFlag = insights?.jd_top_flag as JDRecommendation["classification"] | null | undefined;

  async function decide(
    item: JDRecommendation,
    status: "accepted" | "rejected" | "modified",
    note?: string,
  ) {
    if (!activeJobId) return;
    setPendingId(item.id);
    try {
      await decideJdRecommendation(activeJobId, item.id, {
        status,
        ...(note === undefined ? {} : { note }),
      });
      await reloadAnalytics();
      if (status === "rejected") {
        toast.success(`Dismissed ${item.skill}`);
      } else {
        setActiveJobId(activeJobId);
        await navigate({ to: "/job-analysis", search: { highlight: item.skill } });
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that decision");
    } finally {
      setPendingId(null);
      setModifyingId(null);
      setModifyNote("");
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Hiring Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {optimization?.job_title || "Senior Backend Engineer"} · pipeline snapshot
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
        <StatCard
          icon={Users}
          label="Evaluated candidates"
          value={String(insights?.evaluated_candidates ?? ranked.length)}
          delta="job-scoped"
        />
        <StatCard
          icon={Gauge}
          label="Average match score"
          value={`${insights?.average_score ?? avg}`}
          delta="across pool"
        />
        <StatCard
          icon={Brain}
          label={`Top skill · ${insights?.top_skills?.[0]?.skill ?? skillCounts[0]?.skill ?? "—"}`}
          value={`${insights?.top_skills?.[0]?.count ?? skillCounts[0]?.count ?? 0}`}
          delta="candidates"
        />
        <StatCard
          icon={FileCheck2}
          label="Candidates in store"
          value={String(insights?.total_candidates ?? pool.length)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Skill distribution" subtitle="Candidates per detected skill (this job)">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={(insights?.top_skills?.length ? insights.top_skills : skillCounts).slice(0, 10)}>
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
            <BarChart data={distribution?.score_distribution?.length ? distribution.score_distribution : buckets}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="bucket" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]}>
                {(distribution?.score_distribution ?? buckets).map((_, i) => (
                  <Cell key={i} fill={i >= 3 ? "var(--chart-1)" : "var(--chart-2)"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Experience levels" subtitle="Seniority breakdown of evaluated candidates">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={
                distribution?.experience_levels
                  ? Object.entries(distribution.experience_levels).map(([level, count]) => ({ level, count }))
                  : levelCounts
              }
              layout="vertical"
            >
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

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Pipeline progression" subtitle="Hiring-process stage, not score buckets">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={pipelineData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis
                type="category"
                dataKey="label"
                width={90}
                tick={{ fontSize: 11 }}
                stroke="var(--muted-foreground)"
              />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" radius={[0, 8, 8, 0]} fill="var(--chart-1)" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Candidate sources" subtitle="Internal vs external evaluated candidates">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={sourceData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)" }} />
              <Bar dataKey="count" radius={[8, 8, 0, 0]} fill="var(--chart-2)" />
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
                  "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold",
                  CLASSIFICATION_META[topFlag].className,
                )}
              >
                {CLASSIFICATION_META[topFlag].label}
              </span>
            ) : null}
            <span className="rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
              {feed.length} pending
            </span>
          </div>
        </div>

        <h2 className="mt-3 text-lg font-bold">Recommendations</h2>

        {summary ? <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{summary}</p> : null}

        {emptyFeed ? (
          <div className="mt-4 rounded-xl border border-dashed px-4 py-5 text-center text-sm text-muted-foreground">
            {emptyReason === "no_required_skills"
              ? "Visit Job Description Analysis first to extract requirements."
              : emptyReason === "no_evaluations" || recommendations.length === 0
                ? "Run some candidates through screening to see recommendations."
                : "No pending recommendations — prior decisions are saved."}
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {feed.map((item) => {
              const meta = CLASSIFICATION_META[item.classification];
              const Icon = meta.icon;
              const dropOff = Number(item.supporting_data["low_score_without_skill_pct"] ?? 0);
              return (
                <div key={item.id} className="rounded-2xl border bg-background/70 p-4 shadow-sm">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.skill}</p>
                      <p className="mt-1 text-xs tabular-nums text-muted-foreground">
                        {item.candidates_matching}/{item.total_candidates} candidates (
                        {item.coverage_pct.toFixed(1)}%)
                        {item.total_candidates >= 10 ? ` · ${dropOff.toFixed(0)}% low-score without it` : ""}
                      </p>
                    </div>
                    <span
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-bold",
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

                  <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
                    {item.suggested_modification}
                  </p>

                  {modifyingId === item.id ? (
                    <form
                      className="mt-3 flex flex-col gap-2 sm:flex-row"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void decide(item, "modified", modifyNote.trim() || undefined);
                      }}
                    >
                      <Input
                        value={modifyNote}
                        onChange={(event) => setModifyNote(event.target.value)}
                        placeholder="Note the intended JD change"
                        className="rounded-xl text-sm"
                      />
                      <div className="flex gap-2">
                        <Button type="submit" size="sm" className="rounded-xl" disabled={pendingId === item.id}>
                          Save & edit JD
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="rounded-xl"
                          onClick={() => {
                            setModifyingId(null);
                            setModifyNote("");
                          }}
                        >
                          Cancel
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl"
                        disabled={pendingId === item.id}
                        onClick={() => void decide(item, "accepted")}
                      >
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl"
                        disabled={pendingId === item.id}
                        onClick={() => void decide(item, "rejected")}
                      >
                        Reject
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl"
                        disabled={pendingId === item.id}
                        onClick={() => {
                          setModifyingId(item.id);
                          setModifyNote("");
                        }}
                      >
                        Modify
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
