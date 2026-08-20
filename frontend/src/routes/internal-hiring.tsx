import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Briefcase, Loader2, Search, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnclassifiedRoles } from "@/components/unclassified-roles";
import {
  JobGrid,
  StatTile,
  WorkspaceHeader,
  countInStage,
  countTopMatches,
  useJobWorkspace,
  useWorkspaceTotals,
  useUnclassifiedJobs,
} from "@/components/hiring-workspace";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import {
  fetchCandidatesFromBackend,
  getInternalMatches,
  type AgentEvaluationSummary,
  type BackendCandidate,
} from "@/lib/api";

export const Route = createFileRoute("/internal-hiring")({
  head: () => ({
    meta: [
      { title: "Internal Hiring — ResumeIQ" },
      {
        name: "description",
        content:
          "Open internal roles, bench employee auto-matching, and internal candidate progression.",
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
  const [activeTab, setActiveTab] = useState<"active" | "bench" | "insights">("active");
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

  const tabs = [
    { id: "active" as const, label: `Active internal jobs (${jobs.length})` },
    { id: "bench" as const, label: `Bench employees (${bench.length})` },
    { id: "insights" as const, label: "Internal analytics" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <WorkspaceHeader
        eyebrow="Internal Talent Marketplace & Bench Sourcing"
        icon={<Briefcase className="h-4 w-4" />}
        title="Internal Hiring"
        subtitle="Manage open internal roles, bench employee auto-matching, and internal candidate progression."
        createLabel="Create internal job"
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "active" && (
        <>
          <UnclassifiedRoles
            jobs={unclassified.jobs}
            onClassified={unclassified.refresh}
          />

          <JobGrid
            jobs={jobs}
            loading={loading}
            error={error}
            emptyMessage="No jobs have internal candidates yet. Mark candidates as internal to see them here."
            metrics={(job) => [
              { label: "Internal candidates", value: job.pipeline.length },
              { label: "Top matches", value: countTopMatches(job), tone: "text-primary" },
              {
                label: "In interview",
                value: countInStage(job, ["interviewing", "interviewed"]),
                tone: "text-success",
              },
            ]}
          />
        </>
      )}

      {activeTab === "bench" && (
        <div className="space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                placeholder="Search bench employees by name or skill…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="rounded-lg pl-9 text-xs"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              {filteredBench.length} bench resource{filteredBench.length === 1 ? "" : "s"} available
            </span>
          </div>

          {benchLoading ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading bench pool…
            </p>
          ) : filteredBench.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-foreground">
              No candidates are currently marked as being on the bench.
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {filteredBench.map((emp) => {
                const days = daysOnBench(emp.bench_since);
                const matches = matchesFor.get(emp.id) ?? [];
                return (
                  <Card key={emp.id} className="card-surface">
                    <CardContent className="p-5">
                      <div className="flex flex-wrap items-start justify-between gap-4">
                        <div className="flex min-w-0 items-start gap-4">
                          <div className="rounded-lg border border-primary/20 bg-primary-soft p-2.5 text-primary-soft-foreground">
                            <Users className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-3">
                              <h3 className="text-base font-bold">{emp.name}</h3>
                              {days !== null && (
                                <Badge className="border-warning/40 bg-warning/15 text-xs font-semibold text-warning-foreground dark:text-warning">
                                  {days} day{days === 1 ? "" : "s"} on bench
                                </Badge>
                              )}
                            </div>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {[emp.title, emp.location].filter(Boolean).join(" • ") ||
                                "No role recorded"}
                            </p>

                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {emp.skills.slice(0, 10).map((sk, i) => (
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

                        <div className="space-y-2 text-right">
                          <span className="block text-xs font-medium text-muted-foreground">
                            AI matched opportunities
                          </span>
                          {matches.length === 0 ? (
                            <span className="block text-xs text-muted-foreground">
                              No matching open roles
                            </span>
                          ) : (
                            matches.map((m) => (
                              <div
                                key={m.jobTitle}
                                className="flex items-center justify-end gap-2"
                              >
                                <span className="text-xs font-semibold">{m.jobTitle}</span>
                                <Badge className="border-success/30 bg-success/15 text-xs font-bold text-success">
                                  {m.score}% match
                                </Badge>
                              </div>
                            ))
                          )}

                          <Button
                            size="sm"
                            onClick={() => setSelectedCandidateId(emp.id)}
                            className="mt-2 rounded-lg text-xs"
                          >
                            View bench profile →
                          </Button>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === "insights" && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="Internal candidates"
            value={String(totals.candidates)}
            hint={`Across ${jobs.length} role${jobs.length === 1 ? "" : "s"} with internal applicants.`}
          />
          <StatTile
            label="Bench pool"
            value={String(bench.length)}
            hint="Employees currently marked as available for redeployment."
          />
          <StatTile
            label="Top-quality matches"
            value={String(totals.topMatches)}
            hint="Internal candidates scoring 85% or higher against a role."
          />
        </div>
      )}

      <CandidateDetailModal
        candidateId={selectedCandidateId}
        jobId={jobs[0]?.job_id ?? null}
        isOpen={selectedCandidateId !== null}
        onClose={() => setSelectedCandidateId(null)}
      />
    </div>
  );
}
