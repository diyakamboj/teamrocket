import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Briefcase, Loader2, PlusCircle, Search, Upload, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { UnclassifiedRoles } from "@/components/unclassified-roles";
import { HiringFlow, StepActions, type FlowStep } from "@/components/hiring-flow";
import {
  JobGrid,
  StatTile,
  countInStage,
  countTopMatches,
  useJobWorkspace,
  useWorkspaceTotals,
  useUnclassifiedJobs,
} from "@/components/hiring-workspace";
import { openCreateJob } from "@/lib/app-events";
import {
  fetchCandidatesFromBackend,
  getInternalMatches,
  type AgentEvaluationSummary,
  type BackendCandidate,
} from "@/lib/api";

export const Route = createFileRoute("/internal-hiring")({
  head: () => ({
    meta: [
      { title: "Hiring from inside — ResumeIQ" },
      {
        name: "description",
        content:
          "Open a role for people already at the company, match the bench, and move them forward.",
      },
    ],
  }),
  component: InternalHiringPage,
});

function skillName(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const name = record["skill"] ?? record["name"];
    if (typeof name === "string") return name;
  }
  return String(entry ?? "");
}

function daysOnBench(benchSince: string | null | undefined): number | null {
  if (!benchSince) return null;
  const started = new Date(benchSince).getTime();
  if (Number.isNaN(started)) return null;
  return Math.max(0, Math.round((Date.now() - started) / 86_400_000));
}

function InternalHiringPage() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  const { jobs, loading, error } = useJobWorkspace("internal");
  const totals = useWorkspaceTotals(jobs);
  const unclassified = useUnclassifiedJobs();

  const [bench, setBench] = useState<BackendCandidate[]>([]);
  const [benchLoading, setBenchLoading] = useState(true);
  const [matchesByJob, setMatchesByJob] = useState<Record<string, AgentEvaluationSummary[]>>({});

  // The bench pool is every internal candidate the backend has flagged as
  // available, not a curated list.
  useEffect(() => {
    let cancelled = false;
    fetchCandidatesFromBackend()
      .then((all) => {
        if (cancelled) return;
        setBench(all.filter((c) => c.employment_status === "bench"));
        setBenchLoading(false);
      })
      .catch(() => {
        if (!cancelled) setBenchLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Which open roles the marketplace matches each bench employee to.
  useEffect(() => {
    if (jobs.length === 0) return;
    let cancelled = false;
    void Promise.all(
      jobs.map(
        async (job) =>
          [job.job_id, await getInternalMatches(job.job_id, true).catch(() => [])] as const,
      ),
    ).then((entries) => {
      if (!cancelled) setMatchesByJob(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [jobs]);

  const matchesFor = useMemo(() => {
    const byCandidate = new Map<string, { jobTitle: string; score: number }[]>();
    for (const job of jobs) {
      for (const match of matchesByJob[job.job_id] ?? []) {
        const id = match.candidate.candidate_id;
        if (!id) continue;
        const list = byCandidate.get(id) ?? [];
        list.push({ jobTitle: job.title, score: Math.round(match.candidate.score ?? 0) });
        byCandidate.set(id, list);
      }
    }
    return byCandidate;
  }, [jobs, matchesByJob]);

  const filteredBench = bench.filter((e) => {
    const q = searchQuery.toLowerCase();
    return (
      !q ||
      e.name.toLowerCase().includes(q) ||
      e.skills.some((s) => skillName(s).toLowerCase().includes(q))
    );
  });

  const people = jobs.reduce((sum, job) => sum + job.pipeline.length, 0);
  const scored = jobs.reduce(
    (sum, job) => sum + job.pipeline.filter((p) => p.overall_score != null).length,
    0,
  );
  const advanced = jobs.reduce(
    (sum, job) => sum + countInStage(job, ["interviewing", "interviewed", "selected", "hired"]),
    0,
  );

  const steps: FlowStep[] = [
    {
      id: "role",
      title: "Open the role",
      blurb: "Describe the job you want to fill with someone already at the company.",
      done: jobs.length > 0,
      summary: jobs.length > 0 ? `${jobs.length} open` : undefined,
      body: (
        <>
          <UnclassifiedRoles jobs={unclassified.jobs} onClassified={unclassified.refresh} />
          <JobGrid
            jobs={jobs}
            loading={loading}
            error={error}
            emptyMessage="No internal roles yet. Create one to start matching people to it."
            metrics={(job) => [
              { label: "People considered", value: job.pipeline.length },
              { label: "Strong matches", value: countTopMatches(job), tone: "text-primary" },
              {
                label: "Interviewing",
                value: countInStage(job, ["interviewing", "interviewed"]),
                tone: "text-success",
              },
            ]}
          />
          <StepActions>
            <Button onClick={openCreateJob} className="press-fx ripple">
              <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Create a role
            </Button>
          </StepActions>
        </>
      ),
    },
    {
      id: "people",
      title: "Find people for it",
      blurb: "Pick from employees already free, or add someone by uploading their résumé.",
      done: people > 0 || bench.length > 0,
      summary: bench.length > 0 ? `${bench.length} on the bench` : undefined,
      body: (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search available employees by name or skill…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="rounded-lg pl-9 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {filteredBench.length} available now
            </span>
          </div>

          {benchLoading ? (
            <p className="flex items-center justify-center gap-2 py-8 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading who is available…
            </p>
          ) : filteredBench.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              Nobody is marked as available right now. You can still add someone by uploading their
              résumé to this role.
            </p>
          ) : (
            <div className="stagger grid grid-cols-1 gap-3">
              {filteredBench.map((emp) => {
                const days = daysOnBench(emp.bench_since);
                const matches = matchesFor.get(emp.id) ?? [];
                return (
                  <Card key={emp.id} className="card-surface lift spotlight">
                    <CardContent className="p-4">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="rounded-lg border border-primary/20 bg-primary-soft p-2 text-primary-soft-foreground">
                            <Users className="h-4 w-4" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <h3 className="text-sm font-semibold">{emp.name}</h3>
                              {days !== null && (
                                <Badge className="border-warning/40 bg-warning/15 text-xs font-semibold text-warning-foreground dark:text-warning">
                                  Free for {days} day{days === 1 ? "" : "s"}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {[emp.current_assignment, emp.location].filter(Boolean).join(" • ") ||
                                "Role not recorded"}
                            </p>
                            <div className="mt-2 flex flex-wrap gap-1.5">
                              {emp.skills.slice(0, 8).map((sk, i) => (
                                <Badge
                                  key={`${skillName(sk)}-${i}`}
                                  variant="outline"
                                  className="text-xs"
                                >
                                  {skillName(sk)}
                                </Badge>
                              ))}
                            </div>
                          </div>
                        </div>

                        <div className="space-y-1.5 text-right">
                          <span className="block text-xs font-medium text-muted-foreground">
                            Roles they suit
                          </span>
                          {matches.length === 0 ? (
                            <span className="block text-xs text-muted-foreground">
                              No matching open roles
                            </span>
                          ) : (
                            matches.map((m) => (
                              <div key={m.jobTitle} className="flex items-center justify-end gap-2">
                                <span className="text-xs font-semibold">{m.jobTitle}</span>
                                <Badge className="border-success/30 bg-success/15 text-xs font-bold text-success">
                                  {m.score}% match
                                </Badge>
                              </div>
                            ))
                          )}
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => setSelectedCandidateId(emp.id)}
                            className="press-fx mt-1 rounded-lg text-xs"
                          >
                            View profile
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <StepActions>
            <Link to="/upload">
              <Button variant="outline" className="press-fx">
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Add someone by résumé
              </Button>
            </Link>
          </StepActions>
        </div>
      ),
    },
    {
      id: "review",
      title: "See who fits",
      blurb: "Each person is scored against the role, with the evidence behind it.",
      done: scored > 0,
      summary: scored > 0 ? `${totals.topMatches} strong` : undefined,
      body: (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile
              label="People considered"
              value={String(totals.candidates)}
              hint="Across your internal roles."
            />
            <StatTile label="Available now" value={String(bench.length)} hint="Between assignments." />
            <StatTile
              label="Strong matches"
              value={String(totals.topMatches)}
              hint="Scoring 85 or higher."
            />
          </div>
          <StepActions>
            <Link to="/candidates">
              <Button variant="outline" className="press-fx">
                Review everyone
              </Button>
            </Link>
          </StepActions>
        </>
      ),
    },
    {
      id: "advance",
      title: "Move them forward",
      blurb: "Advance the ones who pass through the role's interview rounds.",
      done: advanced > 0,
      summary: advanced > 0 ? `${advanced} in progress` : undefined,
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            {advanced > 0
              ? `${advanced} person${advanced === 1 ? "" : "s"} are in or past an interview.`
              : "Open a role to move people through its rounds on the board."}
          </p>
          <StepActions>
            {jobs[0] && (
              <Link to="/jobs/$jobId" params={{ jobId: String(jobs[0].job_id) }}>
                <Button variant="outline" className="press-fx">
                  Open the board
                </Button>
              </Link>
            )}
          </StepActions>
        </>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="border-b border-border pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Briefcase className="h-4 w-4" /> Hiring from inside
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">
          Fill a role with someone already here
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Four steps, in order. Each one ticks itself off as you go — you can open any of them at
          any time.
        </p>
      </header>

      <HiringFlow steps={steps} />

      <CandidateDetailModal
        candidateId={selectedCandidateId}
        jobId={jobs[0]?.job_id ?? null}
        isOpen={selectedCandidateId !== null}
        onClose={() => setSelectedCandidateId(null)}
      />
    </div>
  );
}
