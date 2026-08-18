import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
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
  Briefcase,
  Columns3,
  EyeOff,
  FileCheck2,
  FileText,
  Gauge,
  Search,
  SlidersHorizontal,
  Sparkle,
  Sparkles,
  Trophy,
  UploadCloud,
  Users,
} from "lucide-react";
import {
  BASELINE_RESUMES_PROCESSED,
  CANDIDATES,
  DEFAULT_WEIGHTS,
  EXPERIENCE_BREAKDOWN,
  SKILL_DISTRIBUTION,
  rankCandidates,
  scoreBuckets,
} from "@/lib/mock-data";
import { useAppState } from "@/lib/app-state";
import {
  JOBS,
  JOB_STATUS_LABEL,
  summarizeJobPipeline,
  totalCandidatesInPipelines,
  type JobStatus,
} from "@/lib/jobs-data";
import { JobCard } from "@/components/job-card";
import { WeightsEditor } from "@/components/weights-editor";
import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Recruiter Dashboard — ResumeIQ" },
      {
        name: "description",
        content:
          "Your recruiting workspace: active jobs, hiring pipelines, candidate counts and one-click access to screening, comparison and the Recruiter Copilot.",
      },
      { property: "og:title", content: "Recruiter Dashboard — ResumeIQ" },
      {
        property: "og:description",
        content: "Active jobs, hiring pipelines and quick actions for the full screening workflow.",
      },
    ],
  }),
  component: Dashboard,
});

const JOB_FILTERS = ["All", "Active", "On hold", "Closed"] as const;
const HIRING_VIEWS = [
  { id: "all", label: "All hiring" },
  { id: "internal", label: "Internal" },
  { id: "external", label: "External" },
] as const;

function isActiveStatus(status: JobStatus) {
  return status === "open" || status === "interviewing" || status === "offer_stage";
}

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

type QuickAction =
  | {
      kind: "link";
      to: "/upload" | "/job-analysis" | "/candidates" | "/compare";
      search?: { job: string } | undefined;
      icon: typeof Users;
      label: string;
      hint: string;
    }
  | { kind: "button"; onClick: () => void; icon: typeof Users; label: string; hint: string };

function QuickActionTile({ action }: { action: QuickAction }) {
  const Icon = action.icon;
  const body = (
    <>
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0">
        <p className="truncate text-sm font-bold">{action.label}</p>
        <p className="truncate text-xs text-muted-foreground">{action.hint}</p>
      </div>
    </>
  );
  const className =
    "card-surface flex w-full items-center gap-3 p-4 text-left transition-shadow duration-200 hover:shadow-[var(--shadow-lift)]";

  if (action.kind === "link") {
    return action.search ? (
      <Link to={action.to} search={action.search} className={className}>
        {body}
      </Link>
    ) : (
      <Link to={action.to} className={className}>
        {body}
      </Link>
    );
  }
  return (
    <button type="button" onClick={action.onClick} className={className}>
      {body}
    </button>
  );
}

const tooltipStyle = {
  borderRadius: 14,
  border: "1px solid var(--border)",
  background: "var(--popover)",
  color: "var(--popover-foreground)",
  fontSize: 12,
};

function Dashboard() {
  const {
    weights,
    setWeights,
    blindMode,
    setBlindMode,
    compareIds,
    openCopilot,
    selectedJobId,
    counts,
  } = useAppState();
  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);
  const avg = Math.round(ranked.reduce((s, c) => s + c.score, 0) / ranked.length);
  const buckets = useMemo(() => scoreBuckets(ranked), [ranked]);

  const [jobFilter, setJobFilter] = useState<(typeof JOB_FILTERS)[number]>("All");
  const [hiringView, setHiringView] = useState<(typeof HIRING_VIEWS)[number]["id"]>("all");
  const [jobQuery, setJobQuery] = useState("");

  const jobSummaries = useMemo(
    () => new Map(JOBS.map((job) => [job.id, summarizeJobPipeline(job.id, ranked)])),
    [ranked],
  );

  const filteredJobs = useMemo(
    () =>
      JOBS.filter((job) => {
        if (jobFilter === "Active" && !isActiveStatus(job.status)) return false;
        if (jobFilter === "On hold" && job.status !== "on_hold") return false;
        if (jobFilter === "Closed" && job.status !== "closed") return false;
        if (jobQuery && !job.title.toLowerCase().includes(jobQuery.toLowerCase())) return false;
        const summary = jobSummaries.get(job.id)!;
        if (hiringView === "internal" && summary.internalCount === 0) return false;
        if (hiringView === "external" && summary.externalCount === 0) return false;
        return true;
      }),
    [jobFilter, jobQuery, hiringView, jobSummaries],
  );

  const activeJobsCount = JOBS.filter((j) => isActiveStatus(j.status)).length;
  const candidatesInPipeline = useMemo(() => totalCandidatesInPipelines(ranked), [ranked]);

  const quickActions: QuickAction[] = [
    {
      kind: "link",
      to: "/upload",
      search: selectedJobId ? { job: selectedJobId } : undefined,
      icon: UploadCloud,
      label: "Upload resumes",
      hint: "Bulk-parse new candidates",
    },
    {
      kind: "link",
      to: "/job-analysis",
      search: selectedJobId ? { job: selectedJobId } : undefined,
      icon: FileText,
      label: "Analyze a JD",
      hint: "Extract skills & requirements",
    },
    {
      kind: "link",
      to: "/candidates",
      search: selectedJobId ? { job: selectedJobId } : undefined,
      icon: Trophy,
      label: "View rankings",
      hint: "Full candidate ranking",
    },
    {
      kind: "link",
      to: "/compare",
      icon: Columns3,
      label: "Compare candidates",
      hint: compareIds.length > 0 ? `${compareIds.length} selected` : "Select candidates first",
    },
    {
      kind: "button",
      onClick: () => openCopilot({ jobId: selectedJobId }),
      icon: Sparkles,
      label: "Recruiter Copilot",
      hint: "Ask about jobs & candidates",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Recruiter Dashboard</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {activeJobsCount} active {activeJobsCount === 1 ? "role" : "roles"} ·{" "}
            {candidatesInPipeline} candidates across your pipelines
          </p>
        </div>
        <Button
          className="shrink-0 rounded-xl"
          onClick={() => openCopilot({ jobId: selectedJobId })}
        >
          <Sparkles className="mr-2 h-4 w-4" /> Ask Copilot
        </Button>
      </header>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          icon={Briefcase}
          label="Active jobs"
          value={String(activeJobsCount)}
          delta={`${JOBS.length} total`}
        />
        <StatCard
          icon={Users}
          label="Candidates in pipeline"
          value={String(candidatesInPipeline)}
          delta="12%"
        />
        <StatCard icon={Gauge} label="Average match score" value={`${avg}`} delta="4 pts" />
        <StatCard
          icon={FileCheck2}
          label="Resumes processed"
          value={String(BASELINE_RESUMES_PROCESSED + counts.completed)}
          delta={counts.completed > 0 ? `${counts.completed} today` : "no uploads today"}
        />
      </div>

      <section aria-labelledby="quick-actions-heading" className="space-y-3">
        <h2
          id="quick-actions-heading"
          className="text-sm font-bold uppercase tracking-wide text-muted-foreground"
        >
          Quick actions
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {quickActions.map((action) => (
            <QuickActionTile key={action.label} action={action} />
          ))}

          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="card-surface flex w-full items-center gap-3 p-4 text-left transition-shadow duration-200 hover:shadow-[var(--shadow-lift)]"
              >
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                  <SlidersHorizontal className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">Adjust score weights</p>
                  <p className="truncate text-xs text-muted-foreground">Re-rank instantly</p>
                </div>
              </button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-80">
              <WeightsEditor
                weights={weights}
                setWeights={setWeights}
                onReset={() => setWeights(DEFAULT_WEIGHTS)}
              />
            </PopoverContent>
          </Popover>

          <div className="card-surface flex w-full items-center gap-3 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
              <EyeOff className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-bold">Blind review mode</p>
              <p className="truncate text-xs text-muted-foreground">
                {blindMode ? "Enabled — names hidden" : "Hides names & contact info"}
              </p>
            </div>
            <Switch checked={blindMode} onCheckedChange={setBlindMode} />
          </div>
        </div>
      </section>

      <section aria-labelledby="active-jobs-heading" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="active-jobs-heading"
            className="text-sm font-bold uppercase tracking-wide text-muted-foreground"
          >
            Active jobs &amp; hiring pipeline
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={jobQuery}
                onChange={(e) => setJobQuery(e.target.value)}
                placeholder="Search jobs"
                className="h-8 w-40 rounded-xl pl-8 text-xs"
              />
            </div>
            <div className="flex gap-1 rounded-xl bg-secondary p-1">
              {HIRING_VIEWS.map((view) => (
                <button
                  key={view.id}
                  onClick={() => setHiringView(view.id)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                    hiringView === view.id
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {view.label}
                </button>
              ))}
            </div>
            <div className="flex gap-1 rounded-xl bg-secondary p-1">
              {JOB_FILTERS.map((f) => (
                <button
                  key={f}
                  onClick={() => setJobFilter(f)}
                  className={cn(
                    "rounded-lg px-2.5 py-1 text-xs font-semibold transition-colors",
                    jobFilter === f
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        </div>

        {filteredJobs.length === 0 ? (
          <EmptyState
            icon={Briefcase}
            title="No jobs match these filters"
            description="Try a different status filter or clear your search to see all active roles."
            action={{
              label: "Clear filters",
              onClick: () => {
                setJobFilter("All");
                setHiringView("all");
                setJobQuery("");
              },
            }}
          />
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredJobs.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                summary={jobSummaries.get(job.id)!}
                onAskCopilot={() => openCopilot({ jobId: job.id })}
              />
            ))}
          </div>
        )}
      </section>

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
            The pool is strong on core engineering fundamentals — {SKILL_DISTRIBUTION[0]!.count}{" "}
            candidates show {SKILL_DISTRIBUTION[0]!.skill} evidence and{" "}
            {EXPERIENCE_BREAKDOWN[2]!.count + EXPERIENCE_BREAKDOWN[3]!.count} are senior or above.
            The recurring shortfall is production-grade cloud infrastructure: only{" "}
            {SKILL_DISTRIBUTION.find((s) => s.skill === "Kubernetes")?.count ?? 0} candidates show
            Kubernetes ownership, and certification evidence is sparse across the board.
          </p>
          <ul className="mt-4 space-y-2 text-sm">
            {[
              "Consider lowering the certification weight — it is filtering out otherwise strong profiles.",
              "Terraform and Kafka appear mostly as transferable, not primary, experience.",
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
    </div>
  );
}
