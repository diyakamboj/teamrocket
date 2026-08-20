import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  ArrowLeft,
  Check,
  ChevronRight,
  Loader2,
  PlusCircle,
  Search,
  Upload,
  UserPlus,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { UnclassifiedRoles } from "@/components/unclassified-roles";
import { openCreateJob } from "@/lib/app-events";
import {
  fetchCandidatesFromBackend,
  getInternalMatches,
  moveCandidateToRole,
  type BackendCandidate,
} from "@/lib/api";
import {
  countInStage,
  countTopMatches,
  useJobWorkspace,
  useUnclassifiedJobs,
  type JobWithPipeline,
} from "@/components/hiring-workspace";
import { cn } from "@/lib/utils";

/**
 * Role first, then people.
 *
 * Showing open roles and the whole available pool side by side asked the
 * recruiter to hold the join in their head: a person listed "no matching
 * open roles" while a role sat directly above them, because the match was
 * computed against every role rather than the one being filled. Picking the
 * role first makes every number below it mean one thing — how this person
 * fits *this* job — and makes "add them" a single unambiguous action.
 */

function skillName(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const name = record["skill"] ?? record["name"];
    if (typeof name === "string") return name;
  }
  return String(entry ?? "");
}

export function HiringWorkspaceFlow({
  source,
  copy,
}: {
  source: "internal" | "external";
  copy: {
    /** e.g. "employees already at the company" */
    population: string;
    rolesTitle: string;
    rolesBlurb: string;
    peopleTitle: string;
    peopleBlurb: string;
    emptyRoles: string;
    emptyPeople: string;
  };
}) {
  const { jobs, loading, error, refresh } = useJobWorkspace(source);
  const unclassified = useUnclassifiedJobs();

  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [pool, setPool] = useState<BackendCandidate[]>([]);
  const [poolLoading, setPoolLoading] = useState(true);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [query, setQuery] = useState("");
  const [adding, setAdding] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [justAdded, setJustAdded] = useState<string[]>([]);

  const selectedJob = useMemo(
    () => jobs.find((j) => j.job_id === selectedJobId) ?? null,
    [jobs, selectedJobId],
  );

  const loadPool = useCallback(() => {
    setPoolLoading(true);
    fetchCandidatesFromBackend()
      .then((all) =>
        setPool(all.filter((c) => (source === "internal" ? c.source === "internal" : c.source !== "internal"))),
      )
      .catch(() => setPool([]))
      .finally(() => setPoolLoading(false));
  }, [source]);

  useEffect(() => loadPool(), [loadPool]);

  // Match scores are only meaningful once a role is chosen, so they are
  // fetched for that role rather than for all of them up front.
  useEffect(() => {
    if (!selectedJobId || source !== "internal") {
      setScores({});
      return;
    }
    let cancelled = false;
    getInternalMatches(selectedJobId, true)
      .then((matches) => {
        if (cancelled) return;
        const next: Record<string, number> = {};
        for (const m of matches) {
          const id = m.candidate.candidate_id;
          if (id) next[id] = Math.round(m.candidate.score ?? 0);
        }
        setScores(next);
      })
      .catch(() => !cancelled && setScores({}));
    return () => {
      cancelled = true;
    };
  }, [selectedJobId, source]);

  const alreadyOnRole = useMemo(
    () => new Set((selectedJob?.pipeline ?? []).map((p) => String(p.candidate_id))),
    [selectedJob],
  );

  const available = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return pool
      .filter((p) => !alreadyOnRole.has(p.id) && !justAdded.includes(p.id))
      .filter(
        (p) =>
          !needle ||
          p.name.toLowerCase().includes(needle) ||
          p.skills.some((s) => skillName(s).toLowerCase().includes(needle)),
      )
      .sort((a, b) => (scores[b.id] ?? -1) - (scores[a.id] ?? -1));
  }, [pool, alreadyOnRole, justAdded, query, scores]);

  async function addToRole(person: BackendCandidate) {
    if (!selectedJobId) return;
    setAdding(person.id);
    try {
      await moveCandidateToRole(person.id, selectedJobId, null);
      // Drop them from the list immediately; a re-fetch of the whole
      // workspace would be a heavier round trip for the same outcome.
      setJustAdded((prev) => [...prev, person.id]);
      toast.success(`${person.name} added to ${selectedJob?.title ?? "the role"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not add them");
    } finally {
      setAdding(null);
    }
  }

  // ---- Step 1: pick a role -------------------------------------------------

  if (!selectedJob) {
    return (
      <div className="space-y-4">
        <UnclassifiedRoles jobs={unclassified.jobs} onClassified={unclassified.refresh} />

        <section className="rounded-2xl border bg-card">
          <header className="border-b px-5 py-4">
            <h2 className="text-sm font-semibold">{copy.rolesTitle}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{copy.rolesBlurb}</p>
          </header>

          <div className="p-5">
            {loading ? (
              <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading roles…
              </p>
            ) : error ? (
              <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">
                {error}
              </p>
            ) : jobs.length === 0 ? (
              <div className="rounded-xl border border-dashed px-4 py-10 text-center">
                <p className="text-sm font-medium">No roles yet</p>
                <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                  {copy.emptyRoles}
                </p>
                <Button onClick={openCreateJob} className="mt-4">
                  <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Create a role
                </Button>
              </div>
            ) : (
              <>
                <ul className="stagger space-y-2">
                  {jobs.map((job) => (
                    <li key={job.job_id}>
                      <button
                        type="button"
                        onClick={() => setSelectedJobId(job.job_id)}
                        className="press-fx spotlight flex w-full items-center gap-3 rounded-xl border bg-background px-4 py-3 text-left transition-colors hover:border-primary/50"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{job.title}</span>
                          <span className="mt-0.5 block text-xs text-muted-foreground">
                            {job.total_candidates} considered · {countTopMatches(job)} strong ·{" "}
                            {countInStage(job, ["interviewing", "interviewed"])} interviewing
                          </span>
                        </span>
                        <Badge variant="outline" className="shrink-0 text-xs capitalize">
                          {job.status}
                        </Badge>
                        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                      </button>
                    </li>
                  ))}
                </ul>

                <div className="mt-4">
                  <Button variant="outline" onClick={openCreateJob} className="press-fx">
                    <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Create another role
                  </Button>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    );
  }

  // ---- Step 2: add people to the chosen role -------------------------------

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={() => {
          setSelectedJobId(null);
          setQuery("");
          // Re-read the counts if this visit actually changed them.
          if (justAdded.length > 0) refresh();
          setJustAdded([]);
        }}
        className="press-fx inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-3.5 w-3.5" /> All roles
      </button>

      <section className="grad-panel rounded-2xl border bg-card p-5">
        <p className="text-xs font-semibold uppercase tracking-wider text-primary">Filling</p>
        <h2 className="mt-0.5 text-lg font-bold tracking-tight">{selectedJob.title}</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          {selectedJob.total_candidates} considered · {countTopMatches(selectedJob)} strong ·{" "}
          {countInStage(selectedJob, ["interviewing", "interviewed"])} interviewing
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link to="/jobs/$jobId" params={{ jobId: String(selectedJob.job_id) }}>
            <Button size="sm" variant="outline" className="press-fx">
              Open job workspace
            </Button>
          </Link>
          <Link to="/upload" search={{ source, job: String(selectedJob.job_id) }}>
            <Button size="sm" variant="outline" className="press-fx">
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Add by résumé
            </Button>
          </Link>
        </div>
      </section>

      <section className="rounded-2xl border bg-card">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold">{copy.peopleTitle}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">{copy.peopleBlurb}</p>
          </div>
          <div className="relative w-full max-w-xs">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or skill…"
              className="h-9 rounded-lg pl-8 text-xs"
            />
          </div>
        </header>

        <div className="p-5">
          {poolLoading ? (
            <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading {copy.population}…
            </p>
          ) : available.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center">
              <Users className="mx-auto h-6 w-6 text-muted-foreground/60" />
              <p className="mt-2 text-sm font-medium">
                {query ? "Nobody matches that search" : "Nobody left to add"}
              </p>
              <p className="mx-auto mt-1 max-w-sm text-xs text-muted-foreground">
                {query ? "Try a different name or skill." : copy.emptyPeople}
              </p>
            </div>
          ) : (
            <ul className="stagger space-y-2">
              {available.map((person) => {
                const score = scores[person.id];
                const onBench = person.employment_status === "bench";
                return (
                  <li
                    key={person.id}
                    className="lift spotlight flex flex-wrap items-center gap-3 rounded-xl border bg-background px-4 py-3"
                  >
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
                      <Users className="h-4 w-4" />
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="truncate text-sm font-semibold">{person.name}</span>
                        {onBench && (
                          <Badge className="border-success/30 bg-success/15 text-xs font-semibold text-success">
                            Available now
                          </Badge>
                        )}
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {person.current_assignment || person.title || "Role not recorded"}
                      </span>
                      <span className="mt-1.5 flex flex-wrap gap-1">
                        {person.skills.slice(0, 6).map((sk, i) => (
                          <Badge key={`${skillName(sk)}-${i}`} variant="outline" className="text-xs">
                            {skillName(sk)}
                          </Badge>
                        ))}
                      </span>
                    </span>

                    {score !== undefined && (
                      <span className="shrink-0 text-right">
                        <span className="metric block text-sm font-bold text-primary">{score}%</span>
                        <span className="block text-xs text-muted-foreground">fit</span>
                      </span>
                    )}

                    <span className="flex shrink-0 items-center gap-2">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="press-fx text-xs"
                        onClick={() => setViewingId(person.id)}
                      >
                        View
                      </Button>
                      <Button
                        size="sm"
                        className="press-fx"
                        disabled={adding === person.id}
                        onClick={() => void addToRole(person)}
                      >
                        {adding === person.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <>
                            <UserPlus className="mr-1.5 h-3.5 w-3.5" /> Add
                          </>
                        )}
                      </Button>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}

          {justAdded.length > 0 && (
            <p className="mt-4 flex items-center gap-1.5 text-xs text-success">
              <Check className="h-3.5 w-3.5" />
              {justAdded.length} added to {selectedJob.title}. Open the job workspace to score and
              move them.
            </p>
          )}
        </div>
      </section>

      <CandidateDetailModal
        candidateId={viewingId}
        jobId={selectedJob.job_id}
        isOpen={viewingId !== null}
        onClose={() => setViewingId(null)}
      />
    </div>
  );
}
