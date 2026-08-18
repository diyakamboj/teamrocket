import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  BadgeCheck,
  Building2,
  GraduationCap,
  Loader2,
  MapPin,
  Shield,
  ShieldAlert,
  ShieldCheck,
  UserRoundSearch,
  WifiOff,
} from "lucide-react";
import { FraudOrbit } from "@/components/fraud-orbit";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { screenCandidatesForFraud, type FraudCheckSource } from "@/lib/api";
import {
  assessAllCandidates,
  fraudStats,
  mergeFraudResult,
  orbitShowcase,
  toFraudScreenInput,
  type FraudAssessment,
  type FraudStatus,
} from "@/lib/fraud-data";
import { CANDIDATES } from "@/lib/mock-data";
import { useAppState } from "@/lib/app-state";
import { getJob } from "@/lib/jobs-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/fraud-detection")({
  validateSearch: (search: Record<string, unknown>): { candidate?: string } =>
    typeof search["candidate"] === "string" ? { candidate: search["candidate"] } : {},
  head: () => ({
    meta: [
      { title: "Background check — ResumeIQ" },
      {
        name: "description",
        content:
          "Background verification for a candidate — identity, employment, education, and sanctions signals.",
      },
      { property: "og:title", content: "Background check — ResumeIQ" },
      {
        property: "og:description",
        content: "Verify a candidate from the ranking workflow.",
      },
    ],
  }),
  component: FraudDetectionPage,
});

const FILTERS: Array<{ id: "all" | FraudStatus; label: string }> = [
  { id: "all", label: "All" },
  { id: "fraud", label: "Fraud" },
  { id: "suspicious", label: "Suspicious" },
  { id: "verified", label: "Verified" },
];

function StatusPill({ status }: { status: FraudStatus }) {
  if (status === "verified") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
        <BadgeCheck className="h-3.5 w-3.5" /> Verified
      </span>
    );
  }
  if (status === "fraud") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-rose-100 px-2.5 py-1 text-[11px] font-semibold text-rose-700 dark:bg-rose-500/15 dark:text-rose-300">
        <ShieldAlert className="h-3.5 w-3.5" /> Fraud
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[11px] font-semibold text-amber-800 dark:bg-amber-500/15 dark:text-amber-300">
      <AlertTriangle className="h-3.5 w-3.5" /> Suspicious
    </span>
  );
}

function SourceTag({ source }: { source?: FraudCheckSource | undefined }) {
  if (!source || source === "no_data") return null;
  if (source === "live") {
    return (
      <span className="ml-1.5 rounded-full bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
        Live
      </span>
    );
  }
  if (source === "unavailable") {
    return (
      <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
        API down
      </span>
    );
  }
  return (
    <span className="ml-1.5 rounded-full bg-secondary px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-muted-foreground">
      Heuristic
    </span>
  );
}

function CheckRow({
  ok,
  label,
  icon: Icon,
  source,
}: {
  ok: boolean;
  label: string;
  icon: typeof Shield;
  source?: FraudCheckSource | undefined;
}) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span
        className={cn(
          "grid h-7 w-7 place-items-center rounded-lg",
          ok
            ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
            : "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className={ok ? "text-foreground" : "text-rose-700 dark:text-rose-300"}>
        {label}
        <span className="ml-1 text-xs text-muted-foreground">{ok ? "passed" : "failed"}</span>
        <SourceTag source={source} />
      </span>
    </div>
  );
}

/** Falls back to the fully offline heuristic assessment for candidates the
 * live batch call didn't return a result for (e.g. backend unreachable). */
function fallbackAssessments(): FraudAssessment[] {
  return assessAllCandidates();
}

function FraudDetectionPage() {
  const { blindMode, selectedJobId } = useAppState();
  const { candidate: candidateParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const job = getJob(selectedJobId);
  const [assessments, setAssessments] = useState<FraudAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLiveError(null);

    const inputs = CANDIDATES.map(toFraudScreenInput);
    screenCandidatesForFraud(inputs)
      .then((byId) => {
        if (cancelled) return;
        const merged = CANDIDATES.map((c) =>
          byId[c.id] ? mergeFraudResult(c, byId[c.id]!) : null,
        ).filter((a): a is FraudAssessment => a !== null);
        if (merged.length === 0) throw new Error("Verification API returned no results");
        setAssessments(merged.sort((a, b) => b.riskScore - a.riskScore));
      })
      .catch((err) => {
        if (cancelled) return;
        setLiveError(err instanceof Error ? err.message : "Verification API unavailable");
        setAssessments(fallbackAssessments());
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const stats = useMemo(() => fraudStats(assessments), [assessments]);
  const orbitNodes = useMemo(() => orbitShowcase(assessments), [assessments]);
  const [filter, setFilter] = useState<"all" | FraudStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(candidateParam ?? null);

  useEffect(() => {
    if (candidateParam) setSelectedId(candidateParam);
  }, [candidateParam]);

  const filtered = assessments.filter((a) => (filter === "all" ? true : a.status === filter));
  const selected: FraudAssessment | undefined =
    assessments.find((a) => a.candidate.id === selectedId) ??
    orbitNodes.find((n) => n.status === "fraud") ??
    assessments[0];

  if (loading) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-3 py-24 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Running background checks on {CANDIDATES.length} candidates…
        </p>
      </div>
    );
  }

  if (!selected) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <PageHeader
        crumbs={[
          { label: "Workspace", to: "/" },
          {
            label: job?.title ?? "Candidates",
            to: "/candidates",
            search: job ? { job: job.id } : undefined,
          },
          { label: "Background check" },
        ]}
        title="Background check"
        description="Identity, employment, education, location, and sanctions signals for this evaluation."
        actions={
          <Button variant="outline" className="rounded-xl" asChild>
            <Link to="/candidates" search={job ? { job: job.id } : {}}>
              Back to candidates
            </Link>
          </Button>
        }
      />

      {liveError && (
        <div className="flex items-center gap-2 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-300">
          <WifiOff className="h-4 w-4 shrink-0" />
          <span>
            Live verification API unavailable ({liveError}) — showing heuristic-only results.
          </span>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Candidates screened",
            value: stats.total.toLocaleString(),
            icon: UserRoundSearch,
          },
          {
            label: "Verified",
            value: stats.verified.toLocaleString(),
            icon: ShieldCheck,
            tone: "text-emerald-600",
          },
          {
            label: "Suspicious",
            value: stats.suspicious.toLocaleString(),
            icon: AlertTriangle,
            tone: "text-amber-600",
          },
          {
            label: "Fraud flagged",
            value: stats.fraud.toLocaleString(),
            icon: ShieldAlert,
            tone: "text-rose-600",
          },
        ].map((card) => (
          <div key={card.label} className="card-surface p-5">
            <div className="flex items-center justify-between">
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary-soft text-primary-soft-foreground">
                <card.icon className={cn("h-5 w-5", card.tone)} />
              </span>
              <span className="text-xs font-semibold text-muted-foreground">
                {stats.clearRate}% clear
              </span>
            </div>
            <p className="mt-4 text-3xl font-extrabold tabular-nums">{card.value}</p>
            <p className="mt-1 text-sm text-muted-foreground">{card.label}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)]">
        <div className="card-surface overflow-hidden p-4 sm:p-6">
          <div className="mb-4 flex items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-bold">Live verification orbit</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Candidates circulate as background checks resolve — verified, suspicious, or fraud.
              </p>
            </div>
            <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-[11px] font-semibold text-muted-foreground">
              Streaming
            </span>
          </div>
          <FraudOrbit nodes={orbitNodes} />
        </div>

        <div className="card-surface flex flex-col gap-5 p-5 sm:p-6">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Case detail
              </p>
              <h2 className="mt-1 truncate text-xl font-extrabold">
                {blindMode ? `Candidate #${selected.candidate.rank}` : selected.candidate.name}
              </h2>
              <p className="truncate text-sm text-muted-foreground">
                {selected.candidate.title} · {selected.candidate.location}
              </p>
            </div>
            <StatusPill status={selected.status} />
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between text-sm">
              <span className="font-semibold">Fraud risk score</span>
              <span className="tabular-nums font-bold">{selected.riskScore}/100</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-secondary">
              <div
                className={cn(
                  "h-full rounded-full transition-all",
                  selected.status === "fraud"
                    ? "bg-rose-500"
                    : selected.status === "suspicious"
                      ? "bg-amber-500"
                      : "bg-emerald-500",
                )}
                style={{ width: `${selected.riskScore}%` }}
              />
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{selected.summary}</p>
          </div>

          <div className="space-y-2.5">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Background verification
            </p>
            <CheckRow
              ok={selected.checks.identity}
              label="Identity match"
              icon={Shield}
              source={selected.sources?.identity}
            />
            <CheckRow
              ok={selected.checks.employment}
              label="Employment history"
              icon={Building2}
              source={selected.sources?.employment}
            />
            <CheckRow
              ok={selected.checks.education}
              label="Education records"
              icon={GraduationCap}
              source={selected.sources?.education}
            />
            <CheckRow
              ok={selected.checks.location}
              label="Location consistency"
              icon={MapPin}
              source={selected.sources?.location}
            />
            <CheckRow
              ok={selected.checks.sanctions}
              label="Sanctions / OFAC screen"
              icon={ShieldAlert}
              source={selected.sources?.sanctions}
            />
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Detected signals
            </p>
            <ul className="mt-2 space-y-2">
              {selected.signals.map((signal) => (
                <li
                  key={signal.id}
                  className="rounded-xl border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
                >
                  <span
                    className={cn(
                      "mr-2 inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                      signal.severity === "high"
                        ? "bg-rose-100 text-rose-700"
                        : signal.severity === "medium"
                          ? "bg-amber-100 text-amber-800"
                          : "bg-emerald-100 text-emerald-700",
                    )}
                  >
                    {signal.severity}
                  </span>
                  {signal.label}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      <div className="card-surface p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-bold">Verification queue</h2>
            <p className="text-sm text-muted-foreground">
              Click a candidate to inspect background-check results.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <Button
                key={f.id}
                size="sm"
                variant={filter === f.id ? "default" : "outline"}
                className="rounded-xl"
                onClick={() => setFilter(f.id)}
              >
                {f.label}
              </Button>
            ))}
          </div>
        </div>

        <div className="max-h-[420px] space-y-2 overflow-y-auto pr-1">
          {filtered.slice(0, 40).map((item) => {
            const active = item.candidate.id === selected.candidate.id;
            return (
              <button
                key={item.candidate.id}
                type="button"
                onClick={() => {
                  setSelectedId(item.candidate.id);
                  void navigate({ search: { candidate: item.candidate.id } });
                }}
                className={cn(
                  "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-colors",
                  active ? "border-primary/40 bg-primary-soft/50" : "hover:bg-secondary/60",
                )}
              >
                <span className="grid h-10 w-10 place-items-center rounded-full bg-secondary text-xs font-bold">
                  {item.candidate.initials}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-semibold">
                    {blindMode ? `Candidate #${item.candidate.rank}` : item.candidate.name}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {item.candidate.title} · risk {item.riskScore}
                  </span>
                </span>
                <StatusPill status={item.status} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
