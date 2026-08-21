import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Globe,
  Zap,
  Users,
  Loader2,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import {
  fetchCandidatesFromBackend,
  getJobPipeline,
  listBench,
  listJobPipelines,
  type JobPipelineSummary,
  type PipelineCandidate,
} from "@/lib/api";
import { GuidedFlow } from "@/components/guided-flow";
import { ProductName } from "@/components/product-name";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — ResumeIQ" },
      {
        name: "description",
        content:
          "Live view of every internal and external hiring pipeline: open roles, candidate volume, and top matches.",
      },
    ],
  }),
  component: DashboardPage,
});

/** A job plus the candidate rows backing its counters. */
type JobWithPipeline = JobPipelineSummary & { pipeline: PipelineCandidate[] };

const TOP_MATCH_SCORE = 85;

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

function DashboardPage() {
  const session = getSession();
  const [jobs, setJobs] = useState<JobWithPipeline[]>([]);
  // The candidate pool, counted from the same source the Candidates page
  // uses. Deriving this from pipelines made the dashboard disagree with
  // every other screen.
  const [poolSize, setPoolSize] = useState(0);
  // Bench count comes from the bench endpoint for the same reason: derived
  // from pipelines it missed anyone not yet scored against a job.
  const [benchSize, setBenchSize] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    listJobPipelines()
      .then(async (summaries) =>
        Promise.all(
          summaries.map(async (job) => ({
            ...job,
            pipeline: await getJobPipeline(job.job_id, "all").catch(() => []),
          })),
        ),
      )
      .then((rows) => {
        if (cancelled) return;
        setJobs(rows);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load hiring data");
        setLoading(false);
      });

    fetchCandidatesFromBackend()
      .then((candidates) => {
        if (!cancelled) setPoolSize(candidates.length);
      })
      .catch(() => {
        if (!cancelled) setPoolSize(0);
      });

    listBench()
      .then((people) => {
        if (!cancelled) setBenchSize(people.length);
      })
      .catch(() => {
        if (!cancelled) setBenchSize(0);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => {
    // Deduplicate by candidate: a person evaluated against three roles appears
    // in three pipelines, and summing those made the tiles report more
    // candidates than exist. Counts are of people, not of pipeline rows.
    const all = Array.from(
      new Map(jobs.flatMap((j) => j.pipeline).map((c) => [String(c.candidate_id), c])).values(),
    );
    const internal = jobs.filter((j) => (j.sourcing_mode || "both") === "internal" || (j.sourcing_mode || "both") === "both");
    const external = jobs.filter((j) => (j.sourcing_mode || "both") === "external" || (j.sourcing_mode || "both") === "both");
    const topMatches = all.filter((c) => (c.overall_score ?? 0) >= TOP_MATCH_SCORE);
    const readyForInterview = all.filter(
      (c) => c.stage === "interviewing" || c.stage === "interviewed",
    );

    return {
      openRoles: jobs.filter((j) => j.status === "open").length,
      totalJobs: jobs.length,
      internalRoles: internal.length,
      externalRoles: external.length,
      totalCandidates: poolSize,
      inPipeline: all.length,
      // Same deduplication for the internal/external split.
      internalCandidates: all.filter((c) => c.source === "internal").length,
      externalCandidates: all.filter((c) => c.source !== "internal").length,
      topMatches: topMatches.length,
      readyForInterview: readyForInterview.length,
      benchPool: benchSize,
    };
  }, [jobs, poolSize, benchSize]);

  const internalJobs = jobs
    .filter((j) => (j.sourcing_mode || "both") === "internal" || (j.sourcing_mode || "both") === "both")
    .slice(0, 5);
  const externalJobs = jobs
    .filter((j) => (j.sourcing_mode || "both") === "external" || (j.sourcing_mode || "both") === "both")
    .slice(0, 5);


  function topMatchesFor(job: JobWithPipeline): number {
    return job.pipeline.filter((c) => (c.overall_score ?? 0) >= TOP_MATCH_SCORE).length;
  }

  function benchFor(job: JobWithPipeline): number {
    return job.pipeline.filter((c) => c.employment_status === "bench").length;
  }

  const metrics = [
    {
      label: "Open roles",
      val: `${stats.openRoles} Role${stats.openRoles === 1 ? "" : "s"}`,
      sub: `${stats.internalRoles} Internal • ${stats.externalRoles} External`,

      icon: Briefcase,
      color: "text-primary",
    },
    {
      label: "People in your pool",
      val: `${stats.totalCandidates}`,
      sub: `${stats.internalCandidates} internal • ${stats.externalCandidates} external`,
      icon: Users,
      color: "text-muted-foreground",
    },
    {
      label: "Strong matches",
      val: `${stats.topMatches}`,
      sub: `Scored ${TOP_MATCH_SCORE} or higher`,
      icon: Sparkles,
      color: "text-success",
    },
    {
      label: "Interviewing now",
      val: `${stats.readyForInterview}`,
      sub: "In or past an interview",
      icon: CheckCircle2,
      color: "text-warning",
    },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <header className="flex flex-col justify-between gap-4 border-b border-border pb-6 md:flex-row md:items-center">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Sparkles className="h-4 w-4" /> Your hiring overview
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            {greeting()}, {session?.name?.split(" ")[0] ?? "there"} 👋
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Loading your roles…"
              : error
                ? `Could not load your roles: ${error}`
                : "Add a role, add résumés, then review who fits. Everything else is done for you."}
          </p>
        </div>
      </header>

      <GuidedFlow />

      <div className="stagger grid grid-cols-2 gap-4 md:grid-cols-4">
        {metrics.map((m) => (
          <Card key={m.label} className="card-surface lift spotlight">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">{m.label}</span>
                <m.icon className={`h-4 w-4 ${m.color}`} />
              </div>
              <div className="mt-2 text-xl font-extrabold">
                {loading ? <Loader2 className="h-5 w-5 animate-spin" /> : m.val}
              </div>
              <div className="mt-0.5 text-xs text-muted-foreground">{m.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Internal hiring */}
        <Card className="card-surface flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-primary/20 bg-primary-soft p-2 text-primary-soft-foreground">
                    <Briefcase className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">Hiring from inside</CardTitle>
                    <CardDescription className="text-xs">
                      Roles you are filling with people already at the company.
                    </CardDescription>
                  </div>
                </div>
                <Link
                  to="/internal-hiring"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  See all
                </Link>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 p-5">
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-center text-xs">
                <div>
                  <span className="block text-[11px] font-semibold uppercase text-muted-foreground">
                    Roles
                  </span>
                  <span className="text-sm font-bold">{internalJobs.length}</span>
                </div>
                <div>
                  <span className="block text-[11px] font-semibold uppercase text-muted-foreground">
                    Bench Pool
                  </span>
                  <span className="text-sm font-bold text-primary">{stats.benchPool}</span>
                </div>
                <div>
                  <span className="block text-[11px] font-semibold uppercase text-muted-foreground">
                    Internal Candidates
                  </span>
                  <span className="text-sm font-bold text-success">
                    {stats.internalCandidates}
                  </span>
                </div>
              </div>

              <div className="space-y-2">
                {loading ? (
                  <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading roles…
                  </p>
                ) : internalJobs.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    No roles with internal candidates yet.
                  </p>
                ) : (
                  internalJobs.map((job) => (
                    <Link key={job.job_id} to="/jobs/$jobId" params={{ jobId: String(job.job_id) }}>

                      <div className="group flex items-center justify-between rounded-lg border border-border p-3 transition-all hover:border-primary hover:shadow-xs">
                        <div>
                          <div className="text-xs font-semibold group-hover:text-primary">
                            {job.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{job.internal_candidates} internal</span>
                            <span className="font-medium text-primary">
                              👥 {benchFor(job)} bench
                            </span>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs font-medium">
                          Open Job →
                        </Badge>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </div>

          <div className="border-t border-border p-4">
            <Link to="/internal-hiring">
              <Button variant="outline" className="w-full rounded-xl text-xs font-semibold">
                Go to Internal Mobility Workspace →
              </Button>
            </Link>
          </div>
        </Card>

        {/* External hiring */}
        <Card className="card-surface flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-border pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="rounded-lg border border-primary/20 bg-primary-soft p-2 text-primary-soft-foreground">
                    <Globe className="h-4 w-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base font-semibold">Hiring from outside</CardTitle>
                    <CardDescription className="text-xs">
                      Roles you are filling with applicants from outside the company.
                    </CardDescription>
                  </div>
                </div>
                <Link
                  to="/external-hiring"
                  className="text-xs font-semibold text-primary hover:underline"
                >
                  See all
                </Link>
              </div>
            </CardHeader>

            <CardContent className="space-y-4 p-5">
              <div className="grid grid-cols-3 gap-2 rounded-lg border border-border bg-secondary/40 p-3 text-center text-xs">
                <div>
                  <span className="block text-[11px] font-semibold uppercase text-muted-foreground">
                    Roles
                  </span>
                  <span className="text-sm font-bold">{externalJobs.length}</span>
                </div>
                <div>
                  <span className="block text-[11px] font-semibold uppercase text-muted-foreground">
                    Applicants
                  </span>
                  <span className="text-sm font-bold text-primary">
                    {stats.externalCandidates}
                  </span>
                </div>
                <div>
                  <span className="block text-[11px] font-semibold uppercase text-muted-foreground">
                    Top Matches
                  </span>
                  <span className="text-sm font-bold text-success">{stats.topMatches}</span>
                </div>
              </div>

              <div className="space-y-2">
                {loading ? (
                  <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading roles…
                  </p>
                ) : externalJobs.length === 0 ? (
                  <p className="py-4 text-center text-xs text-muted-foreground">
                    No roles with external applicants yet.
                  </p>
                ) : (
                  externalJobs.map((job) => (
                    <Link key={job.job_id} to="/jobs/$jobId" params={{ jobId: String(job.job_id) }}>

                      <div className="group flex items-center justify-between rounded-lg border border-border p-3 transition-all hover:border-primary hover:shadow-xs">
                        <div>
                          <div className="text-xs font-semibold group-hover:text-primary">
                            {job.title}
                          </div>
                          <div className="mt-0.5 flex items-center gap-3 text-xs text-muted-foreground">
                            <span>{job.external_candidates} applicants</span>
                            <span className="font-medium text-success">
                              🟢 {topMatchesFor(job)} top matches
                            </span>
                          </div>
                        </div>
                        <Badge variant="outline" className="text-xs font-medium">
                          Open Job →
                        </Badge>
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </CardContent>
          </div>

          <div className="border-t border-border p-4">
            <Link to="/external-hiring">
              <Button variant="outline" className="w-full rounded-xl text-xs font-semibold">
                Go to External Sourcing Workspace →
              </Button>
            </Link>
          </div>
        </Card>
      </div>

      <Card className="card-surface">
        <CardHeader className="border-b border-border pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-warning" />
              <div>
                <CardTitle className="text-base font-semibold">What needs your attention</CardTitle>
                <CardDescription className="text-xs">
                  Suggestions waiting on a yes or no from you.
                </CardDescription>
              </div>
            </div>
            <Link to="/actions">
              <Button size="sm" variant="ghost" className="text-xs font-semibold text-primary">
                View all actions →
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-5">
          <p className="text-sm text-muted-foreground">
            The Actions Center analyses every open job for JD calibration warnings, internal bench
            matches, and candidates awaiting readiness assessment.
          </p>
          <Link to="/actions">
            <Button className="mt-4 rounded-xl text-xs font-semibold">
              Open Actions Center →
            </Button>
          </Link>
        </CardContent>
      </Card>

    </div>
  );
}
