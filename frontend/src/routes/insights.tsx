import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
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
import { ArrowUpRight, Brain, FileCheck2, Gauge, Sparkle, Users } from "lucide-react";
import {
  CANDIDATES,
  EXPERIENCE_BREAKDOWN,
  SKILL_DISTRIBUTION,
  rankCandidates,
  scoreBuckets,
} from "@/lib/mock-data";
import { useAppState } from "@/lib/app-state";

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
    <div className="card-surface p-5 transition-shadow duration-300 hover:shadow-[var(--shadow-lift)]">
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
      <div className="h-[240px] w-full">{children}</div>
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

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0] ?? "";
  let bestCount = 0;
  for (const [v, c] of counts) {
    if (c > bestCount) {
      best = v;
      bestCount = c;
    }
  }
  return best;
}

function Insights() {
  const { weights } = useAppState();
  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);
  const avg = Math.round(ranked.reduce((s, c) => s + c.score, 0) / ranked.length);
  const buckets = useMemo(() => scoreBuckets(ranked), [ranked]);
  const roleTitle = useMemo(() => mostCommon(ranked.map((c) => c.title)), [ranked]);
  const seniorPlus = EXPERIENCE_BREAKDOWN[2]!.count + EXPERIENCE_BREAKDOWN[3]!.count;
  const scarceSkill = useMemo(
    () => SKILL_DISTRIBUTION.slice(0, 10).reduce((min, s) => (s.count < min.count ? s : min)),
    [],
  );

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Hiring Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">{roleTitle} · pipeline snapshot</p>
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

      <div className="grid gap-4 lg:grid-cols-[1fr_1.2fr]">
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

        <div className="card-surface p-6">
          <div className="flex items-center gap-2 text-primary-soft-foreground">
            <Sparkle className="h-4 w-4" />
            <span className="text-xs font-bold uppercase tracking-wide">AI insight</span>
          </div>
          <h2 className="mt-3 text-lg font-bold">Qualification gaps</h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            The pool is strong on core fundamentals — {SKILL_DISTRIBUTION[0]!.count} candidates
            show {SKILL_DISTRIBUTION[0]!.skill} evidence and {seniorPlus} are senior or above. The
            recurring shortfall is {scarceSkill.skill}: only {scarceSkill.count} candidates show
            evidence of it, and certification evidence is sparse across the board.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              "Consider lowering the certification weight — it is filtering out otherwise strong profiles.",
              `${scarceSkill.skill} appears mostly as transferable, not primary, experience.`,
              "Mid-level candidates outperform seniors on projects evidence.",
            ].map((t) => (
              <li key={t} className="flex gap-2 text-muted-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {t}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
