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
import { rankCandidates, scoreBuckets, type Candidate } from "@/lib/types";
import { useAppState } from "@/lib/app-state";

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
  delta?: string;
}) {
  return (
    <div className="card-surface p-5 transition-shadow duration-300 hover:shadow-[var(--shadow-lift)]">
      <div className="flex items-start justify-between gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
          <Icon className="h-5 w-5" />
        </span>
        {delta && (
          <span className="inline-flex items-center gap-0.5 rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
            <ArrowUpRight className="h-3 w-3" /> {delta}
          </span>
        )}
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

function skillDistribution(candidates: Candidate[]) {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    for (const skill of new Set(candidate.skills)) {
      counts.set(skill, (counts.get(skill) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([skill, count]) => ({ skill, count }))
    .sort((a, b) => b.count - a.count);
}

function experienceBreakdown(candidates: Candidate[]) {
  return (["Junior", "Mid", "Senior", "Lead"] as const).map((level) => ({
    level,
    count: candidates.filter((c) => c.level === level).length,
  }));
}

function Dashboard() {
  const { weights, candidates, job, counts, poolSize } = useAppState();
  const ranked = useMemo(() => rankCandidates(candidates, weights), [candidates, weights]);
  const buckets = useMemo(() => scoreBuckets(ranked), [ranked]);
  const skills = useMemo(() => skillDistribution(ranked), [ranked]);
  const levels = useMemo(() => experienceBreakdown(ranked), [ranked]);

  const avg = ranked.length
    ? Math.round(ranked.reduce((sum, c) => sum + c.score, 0) / ranked.length)
    : 0;
  const fullMustHaves = ranked.filter(
    (c) => c.mustHavesTotal > 0 && c.mustHavesMet === c.mustHavesTotal,
  ).length;

  if (ranked.length === 0) {
    return (
      <div className="mx-auto max-w-3xl space-y-6">
        <header>
          <h1 className="text-2xl font-extrabold sm:text-3xl">Hiring Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Insights appear once a batch has been parsed and screened against a job description.
          </p>
        </header>
        <div className="grid gap-4 sm:grid-cols-3">
          <StatCard icon={FileCheck2} label="Resumes uploaded" value={String(counts.total)} />
          <StatCard icon={Users} label="Parsed & ready" value={String(poolSize)} />
          <StatCard icon={Brain} label="Requirements set" value={String(job?.requirements.length ?? 0)} />
        </div>
        <div className="card-surface p-6 text-sm text-muted-foreground">
          <p>
            Start by uploading resumes, then paste a job description and run screening to populate
            this dashboard.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link to="/upload" className="rounded-xl border px-4 py-2.5 text-sm font-semibold">
              Upload resumes
            </Link>
            <Link
              to="/job-analysis"
              className="rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Job description
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const topSkill = skills[0];
  const seniorPlus = levels[2]!.count + levels[3]!.count;
  const thinCertifications = ranked.filter((c) => c.categories.certifications < 45).length;
  const commonGap = mostCommonGap(ranked);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Hiring Insights</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {job?.title ?? "Current role"} · pipeline snapshot
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
        <StatCard icon={Users} label="Ranked candidates" value={String(ranked.length)} />
        <StatCard icon={Gauge} label="Average match score" value={String(avg)} />
        <StatCard
          icon={Brain}
          label={topSkill ? `Top skill · ${topSkill.skill}` : "Top skill"}
          value={topSkill ? String(topSkill.count) : "—"}
        />
        <StatCard
          icon={FileCheck2}
          label="Meet every must-have"
          value={String(fullMustHaves)}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ChartCard title="Skill distribution" subtitle="Candidates per detected skill">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={skills.slice(0, 10)}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
              <XAxis dataKey="skill" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" />
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" allowDecimals={false} />
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
              <YAxis tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" allowDecimals={false} />
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
            <BarChart data={levels} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="var(--muted-foreground)" allowDecimals={false} />
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
            {topSkill
              ? `${topSkill.count} of ${ranked.length} candidates show ${topSkill.skill} evidence`
              : "No skills were detected in this pool"}
            , and {seniorPlus} {seniorPlus === 1 ? "is" : "are"} senior or above.{" "}
            {fullMustHaves === 0
              ? "No candidate currently meets every must-have requirement."
              : `${fullMustHaves} candidate${fullMustHaves === 1 ? "" : "s"} meet every must-have requirement.`}
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              commonGap && `Most common gap: ${commonGap}`,
              thinCertifications > ranked.length / 2 &&
                `${thinCertifications} candidates score under 45 on certifications — consider lowering that weight.`,
              `${ranked.filter((c) => c.aiAnalyzed).length} of ${ranked.length} candidates received the full AI analysis pass.`,
            ]
              .filter((t): t is string => Boolean(t))
              .map((t) => (
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

function mostCommonGap(candidates: Candidate[]): string | undefined {
  const counts = new Map<string, number>();
  for (const candidate of candidates) {
    for (const gap of candidate.gaps) counts.set(gap, (counts.get(gap) ?? 0) + 1);
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  return top && top[1] > 1 ? `${top[0]} (${top[1]} candidates)` : top?.[0];
}
