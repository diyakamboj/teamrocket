import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { InternalRoster } from "@/components/internal-roster";
import { Armchair, Clock, Loader2, Search, Sparkles, UserCheck } from "lucide-react";
import { toast } from "sonner";
import {
  assignFromBench,
  listBench,
  listJobs,
  matchBenchToRole,
  type BenchEmployee,
  type BenchMatch,
  type JobResponse,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/bench")({
  head: () => ({
    meta: [
      { title: "Bench Employees — ResumeIQ" },
      {
        name: "description",
        content: "Internal employees between assignments, and which open roles they fit.",
      },
    ],
  }),
  component: BenchPage,
});

function initials(name: string) {
  return name.split(" ").map((p) => p[0]).slice(0, 2).join("").toUpperCase();
}

/** Bench time is the cost this page exists to reduce, so it is colour-coded. */
function benchAge(days: number | null | undefined) {
  if (days == null) return { label: "Start date unknown", tone: "text-muted-foreground" };
  if (days >= 30) return { label: `${days} days on bench`, tone: "text-destructive" };
  if (days >= 14) return { label: `${days} days on bench`, tone: "text-chart-4" };
  return { label: days === 0 ? "Benched today" : `${days} days on bench`, tone: "text-muted-foreground" };
}

function BenchPage() {
  const [bench, setBench] = useState<BenchEmployee[]>([]);
  const [jobs, setJobs] = useState<JobResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [matches, setMatches] = useState<BenchMatch[] | null>(null);
  const [matching, setMatching] = useState(false);
  const [matchLabel, setMatchLabel] = useState("");
  const [freeText, setFreeText] = useState("");
  const [assigning, setAssigning] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [people, roles] = await Promise.all([listBench(), listJobs()]);
      setBench(people);
      setJobs(roles);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load the bench");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runMatch(params: { jobId?: string; q?: string }, label: string) {
    setMatching(true);
    setMatchLabel(label);
    try {
      setMatches(await matchBenchToRole({ ...params, limit: 10 }));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not match the bench");
      setMatches(null);
    } finally {
      setMatching(false);
    }
  }

  async function assign(person: BenchEmployee) {
    const assignment = window.prompt(`Assign ${person.name} to which project?`);
    if (!assignment?.trim()) return;
    setAssigning(person.candidate_id);
    try {
      await assignFromBench(person.candidate_id, assignment.trim());
      toast.success(`${person.name} assigned to ${assignment.trim()}`);
      setMatches(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not assign");
    } finally {
      setAssigning(null);
    }
  }

  const longWaiting = bench.filter((b) => (b.days_on_bench ?? 0) >= 30).length;

  return (
    <div className="mx-auto flow max-w-5xl pb-12">
      <header className="animate-rise">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Armchair className="h-4 w-4" /> Bench employees
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">
          Who is available right now
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Internal people between assignments. They are the fastest and cheapest way to fill a
          role, so check here before opening a req externally.
        </p>
      </header>

      <InternalRoster onChanged={() => void refresh()} />

      <section className="stagger grid gap-3 sm:grid-cols-3">
        <div className="lift edge-accent rounded-2xl border bg-card p-5">
          <p className="metric text-2xl font-bold">{bench.length}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">On the bench</p>
        </div>
        <div className="lift edge-accent rounded-2xl border bg-card p-5">
          <p className={cn("metric text-2xl font-bold", longWaiting > 0 && "text-destructive")}>
            {longWaiting}
          </p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">Waiting 30+ days</p>
        </div>
        <div className="lift edge-accent rounded-2xl border bg-card p-5">
          <p className="metric text-2xl font-bold">{jobs.length}</p>
          <p className="mt-1 text-xs font-medium text-muted-foreground">Open roles to match</p>
        </div>
      </section>

      <section className="animate-rise rounded-2xl border bg-card p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Sparkles className="h-4 w-4" /> Match the bench to a role
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Matches on meaning, not keywords — describe the work and it finds who has done it.
        </p>

        <div className="mt-4 flex flex-wrap gap-2">
          {jobs.slice(0, 6).map((job) => (
            <Button
              key={job.id}
              size="sm"
              variant="outline"
              className="rounded-lg text-xs"
              disabled={matching}
              onClick={() => void runMatch({ jobId: job.id }, job.title)}
            >
              {job.title}
            </Button>
          ))}
        </div>

        <form
          className="mt-3 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (freeText.trim()) void runMatch({ q: freeText.trim() }, `“${freeText.trim()}”`);
          }}
        >
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={freeText}
              onChange={(e) => setFreeText(e.target.value)}
              placeholder="…or describe the work: “someone who has run Kubernetes in production”"
              className="h-9 rounded-lg pl-8 text-xs"
            />
          </div>
          <Button type="submit" size="sm" className="rounded-lg" disabled={matching || !freeText.trim()}>
            {matching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Match"}
          </Button>
        </form>

        {matches !== null && (
          <div className="animate-fade mt-5">
            <p className="text-xs font-semibold">
              Best fits for {matchLabel}
              <button
                onClick={() => setMatches(null)}
                className="ml-2 text-xs font-normal text-muted-foreground hover:text-foreground"
              >
                clear
              </button>
            </p>
            {matches.length === 0 ? (
              <p className="mt-3 rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                Nobody on the bench matches that closely.
              </p>
            ) : (
              <ul className="stagger mt-3 space-y-2">
                {matches.map((match) => (
                  <li key={match.candidate_id} className="lift flex items-center gap-3 rounded-xl border p-3">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {initials(match.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{match.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {match.title || "—"} · {benchAge(match.days_on_bench).label}
                      </p>
                    </div>
                    {match.similarity !== null && match.similarity !== undefined && (
                      <span className="metric shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
                        {Math.round(match.similarity * 100)}% fit
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="animate-rise rounded-2xl border bg-card shadow-sm">
        <header className="border-b px-5 py-4">
          <h2 className="text-sm font-semibold">Bench list</h2>
          <p className="text-xs text-muted-foreground">Longest waiting first.</p>
        </header>

        <div className="p-5">
          {loading ? (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading the bench…
            </p>
          ) : error ? (
            <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
          ) : bench.length === 0 ? (
            <div className="rounded-xl border border-dashed px-4 py-10 text-center">
              <Armchair className="mx-auto h-7 w-7 text-muted-foreground/60" />
              <p className="mt-3 text-sm font-medium">Nobody is on the bench</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Mark an internal candidate as bench from their profile to track their availability.
              </p>
            </div>
          ) : (
            <ul className="stagger space-y-2.5">
              {bench.map((person) => {
                const age = benchAge(person.days_on_bench);
                return (
                  <li key={person.candidate_id} className="lift flex flex-wrap items-center gap-3 rounded-xl border p-4">
                    <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {initials(person.name)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{person.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {person.title || "—"}
                        {person.previous_assignment ? ` · last on ${person.previous_assignment}` : ""}
                      </p>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {person.skills.slice(0, 6).map((skill) => (
                          <span
                            key={skill}
                            className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground"
                          >
                            {skill}
                          </span>
                        ))}
                      </div>
                    </div>
                    <span className={cn("flex shrink-0 items-center gap-1 text-xs font-medium", age.tone)}>
                      <Clock className="h-3 w-3" /> {age.label}
                    </span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="shrink-0 rounded-lg"
                      disabled={assigning === person.candidate_id}
                      onClick={() => void assign(person)}
                    >
                      {assigning === person.candidate_id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <>
                          <UserCheck className="mr-1.5 h-3.5 w-3.5" /> Assign
                        </>
                      )}
                    </Button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
