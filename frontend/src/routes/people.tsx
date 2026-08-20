import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { Armchair, Briefcase, Building2, Globe, Loader2, Search, Users } from "lucide-react";
import {
  fetchCandidatesFromBackend,
  listJobPipelines,
  type BackendCandidate,
  type JobPipelineSummary,
} from "@/lib/api";
import { Input } from "@/components/ui/input";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/people")({
  head: () => ({
    meta: [
      { title: "Everyone — ResumeIQ" },
      {
        name: "description",
        content: "Every employee and candidate in your workspace, in one place.",
      },
    ],
  }),
  component: PeoplePage,
});

/**
 * Everyone in the workspace, with employees and candidates kept apart.
 *
 * The two populations answer different questions — "who works here and what
 * do they do" versus "who applied and how do they score" — and mixing them
 * in one list made both harder to read. Internal and external are the same
 * split the rest of the app uses, so a person appears where a recruiter
 * already expects them.
 */

function initials(name: string) {
  return name
    .split(" ")
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function PersonRow({
  person,
  roleTitle,
  onOpen,
}: {
  person: BackendCandidate;
  roleTitle: string | null;
  onOpen: () => void;
}) {
  const internal = person.source === "internal";
  const onBench = person.employment_status === "bench";

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="press-fx spotlight flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
          {initials(person.name || "?")}
        </span>

        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{person.name}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {person.title || person.email || "—"}
          </span>
        </span>

        {/* What an employee does here today is the fact that matters for
            them; for an applicant it is which role they are up for. */}
        {internal ? (
          <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Building2 className="h-3 w-3" />
            <span className="max-w-[14rem] truncate">
              {onBench ? "On the bench" : person.current_assignment || "Role not recorded"}
            </span>
          </span>
        ) : (
          <span className="hidden shrink-0 items-center gap-1.5 text-xs text-muted-foreground sm:flex">
            <Briefcase className="h-3 w-3" />
            <span className="max-w-[14rem] truncate">{roleTitle ?? "No role yet"}</span>
          </span>
        )}

        {onBench && (
          <span className="shrink-0 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success">
            Available
          </span>
        )}
      </button>
    </li>
  );
}

function Section({
  title,
  hint,
  icon: Icon,
  people,
  roleTitles,
  onOpen,
  emptyHint,
}: {
  title: string;
  hint: string;
  icon: typeof Users;
  people: BackendCandidate[];
  roleTitles: Map<string, string>;
  onOpen: (id: string) => void;
  emptyHint: string;
}) {
  return (
    <section className="rounded-2xl border bg-card p-5">
      <header className="flex flex-wrap items-center gap-2 pb-3">
        <Icon className="h-4 w-4 text-primary" />
        <h2 className="text-sm font-semibold">{title}</h2>
        <span className="metric rounded-full bg-secondary px-2 py-0.5 text-xs font-bold">
          {people.length}
        </span>
        <p className="w-full text-xs text-muted-foreground sm:w-auto">· {hint}</p>
      </header>

      {people.length === 0 ? (
        <p className="rounded-lg border border-dashed px-4 py-8 text-center text-xs text-muted-foreground">
          {emptyHint}
        </p>
      ) : (
        <ul className="stagger space-y-1.5">
          {people.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              roleTitle={person.job_id ? (roleTitles.get(person.job_id) ?? null) : null}
              onOpen={() => onOpen(person.id)}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function PeoplePage() {
  const [people, setPeople] = useState<BackendCandidate[]>([]);
  const [jobs, setJobs] = useState<JobPipelineSummary[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchCandidatesFromBackend(), listJobPipelines().catch(() => [])])
      .then(([rows, roles]) => {
        if (cancelled) return;
        setPeople(rows);
        setJobs(roles);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Could not load people");
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  const roleTitles = useMemo(
    () => new Map(jobs.map((j) => [String(j.job_id), j.title])),
    [jobs],
  );

  const { employees, candidates } = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches = (p: BackendCandidate) =>
      !needle ||
      `${p.name} ${p.email} ${p.title ?? ""} ${p.current_assignment ?? ""}`
        .toLowerCase()
        .includes(needle);
    const visible = people.filter(matches);
    return {
      employees: visible.filter((p) => p.source === "internal"),
      candidates: visible.filter((p) => p.source !== "internal"),
    };
  }, [people, query]);

  const benchCount = employees.filter((p) => p.employment_status === "bench").length;

  return (
    <div className="mx-auto max-w-5xl space-y-6 pb-12">
      <header className="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-5">
        <div>
          <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <Users className="h-4 w-4" /> Everyone
          </div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight">People in your workspace</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {loading
              ? "Loading…"
              : `${employees.length} employee${employees.length === 1 ? "" : "s"} and ${candidates.length} candidate${candidates.length === 1 ? "" : "s"}${benchCount > 0 ? ` · ${benchCount} on the bench` : ""}.`}
          </p>
        </div>

        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, email or role"
            className="h-9 w-64 rounded-lg pl-8 text-xs"
          />
        </div>
      </header>

      {loading ? (
        <p className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading people…
        </p>
      ) : error ? (
        <p className="rounded-lg bg-destructive/10 px-4 py-3 text-sm text-destructive">{error}</p>
      ) : (
        <div className={cn("space-y-5")}>
          <Section
            title="Employees"
            hint="People who already work here"
            icon={Armchair}
            people={employees}
            roleTitles={roleTitles}
            onOpen={setOpenId}
            emptyHint={
              query
                ? "No employees match that search."
                : "No employees yet. Upload résumés to an internal role to add them."
            }
          />

          <Section
            title="Candidates"
            hint="Applicants from outside the company"
            icon={Globe}
            people={candidates}
            roleTitles={roleTitles}
            onOpen={setOpenId}
            emptyHint={
              query
                ? "No candidates match that search."
                : "No candidates yet. Upload résumés to an external role to add them."
            }
          />
        </div>
      )}

      <CandidateDetailModal
        candidateId={openId}
        isOpen={openId !== null}
        onClose={() => setOpenId(null)}
      />
    </div>
  );
}
