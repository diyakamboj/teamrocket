import { createFileRoute } from "@tanstack/react-router";
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
import { Button } from "@/components/ui/button";
import {
  checkResumeConsistency,
  screenCandidatesForFraud,
  type FraudCheckSource,
  type ResumeConsistencyResult,
} from "@/lib/api";
import {
  assessAllCandidates,
  fraudStats,
  mergeFraudResult,
  orbitShowcase,
  toFraudScreenInput,
  type FraudAssessment,
  type FraudStatus,
} from "@/lib/fraud-data";
import { useCandidatePool } from "@/lib/use-candidate-pool";
import { useAppState } from "@/lib/app-state";
import { cn, isBackendUuid } from "@/lib/utils";

export const Route = createFileRoute("/fraud-detection")({
  head: () => ({
    meta: [
      { title: "Fraud Detection — ResumeIQ" },
      {
        name: "description",
        content:
          "Background verification and candidate fraud detection — flag verified, suspicious, and fraudulent applicants.",
      },
      { property: "og:title", content: "Fraud Detection — ResumeIQ" },
      {
        property: "og:description",
        content: "Detect candidate fraud through automated background verification.",
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
      <span className="inline-flex items-center gap-1 rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success dark:bg-success/15 dark:text-success">
        <BadgeCheck className="h-3.5 w-3.5" /> Verified
      </span>
    );
  }
  if (status === "fraud") {
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-destructive/10 px-2.5 py-1 text-xs font-semibold text-destructive dark:bg-destructive/15 dark:text-destructive">
        <ShieldAlert className="h-3.5 w-3.5" /> Fraud
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning dark:bg-warning/15 dark:text-warning">
      <AlertTriangle className="h-3.5 w-3.5" /> Suspicious
    </span>
  );
}

function SourceTag({ source }: { source?: FraudCheckSource | undefined }) {
  if (!source || source === "no_data") return null;
  if (source === "live") {
    return (
      <span className="ml-1.5 rounded-full bg-primary/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-primary dark:bg-primary/15 dark:text-primary">
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
            ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
            : "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className={ok ? "text-foreground" : "text-destructive dark:text-destructive"}>
        {label}
        <span className="ml-1 text-xs text-muted-foreground">{ok ? "passed" : "failed"}</span>
        <SourceTag source={source} />
      </span>
    </div>
  );
}

function FraudDetectionPage() {
  const { blindMode } = useAppState();
  const { candidates: pool, loading: poolLoading, error: poolError } = useCandidatePool();
  const [assessments, setAssessments] = useState<FraudAssessment[]>([]);
  const [loading, setLoading] = useState(true);
  const [liveError, setLiveError] = useState<string | null>(null);

  useEffect(() => {
    if (poolLoading) return;
    if (pool.length === 0) {
      setAssessments([]);
      setLoading(false);
      setLiveError(poolError);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setLiveError(null);

    screenCandidatesForFraud(pool.map(toFraudScreenInput))
      .then((byId) => {
        if (cancelled) return;
        const merged = pool
          .map((c) => (byId[c.id] ? mergeFraudResult(c, byId[c.id]!) : null))
          .filter((a): a is FraudAssessment => a !== null);
        if (merged.length === 0) throw new Error("Verification API returned no results");
        setAssessments(merged.sort((a, b) => b.riskScore - a.riskScore));
      })
      .catch((err) => {
        if (cancelled) return;
        // Offline fallback: resume-consistency heuristics only. It raises no
        // sanctions/identity findings, so the queue degrades to "unverified"
        // rather than to invented accusations.
        setLiveError(err instanceof Error ? err.message : "Verification API unavailable");
        setAssessments(assessAllCandidates(pool));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [pool, poolLoading, poolError]);

  const stats = useMemo(() => fraudStats(assessments), [assessments]);
  const orbitNodes = useMemo(() => orbitShowcase(assessments), [assessments]);
  const [filter, setFilter] = useState<"all" | FraudStatus>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const filtered = assessments.filter((a) => (filter === "all" ? true : a.status === filter));
  const selected: FraudAssessment | undefined =
    assessments.find((a) => a.candidate.id === selectedId) ??
    orbitNodes.find((n) => n.status === "fraud") ??
    assessments[0];

  const [consistency, setConsistency] = useState<ResumeConsistencyResult | null>(null);
  const [consistencyLoading, setConsistencyLoading] = useState(false);
  const [consistencyError, setConsistencyError] = useState<string | null>(null);

  useEffect(() => {
    const candidateId = selected?.candidate.id ?? null;
    setConsistency(null);
    setConsistencyError(null);
    if (!isBackendUuid(candidateId)) {
      setConsistencyLoading(false);
      return;
    }
    let cancelled = false;
    setConsistencyLoading(true);
    checkResumeConsistency(candidateId)
      .then((result) => {
        if (!cancelled) setConsistency(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setConsistencyError(err instanceof Error ? err.message : "Consistency check failed");
        }
      })
      .finally(() => {
        if (!cancelled) setConsistencyLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected?.candidate.id]);

  if (loading) {
    return (
      <div className="mx-auto flex max-w-7xl flex-col items-center justify-center gap-3 py-24 text-center">
        <Loader2 className="h-6 w-6 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">
          Running live sanctions &amp; employer-registry checks on {pool.length} candidates…
        </p>
      </div>
    );
  }

  if (!selected) {
    return null;
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-primary-soft-foreground">
            Recruiting security
          </p>
          <h1 className="mt-1 text-2xl font-extrabold sm:text-3xl">Fraud Detection</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            Background verification across identity, employment, education, location, and sanctions
            signals. Sanctions and employer checks are verified live against the US Treasury OFAC
            list and company-registry data.
          </p>
        </div>
      </header>

      {liveError && (
        <div className="flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning dark:border-warning/30 dark:bg-warning/10 dark:text-warning">
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
            tone: "text-success",
          },
          {
            label: "Suspicious",
            value: stats.suspicious.toLocaleString(),
            icon: AlertTriangle,
            tone: "text-warning",
          },
          {
            label: "Fraud flagged",
            value: stats.fraud.toLocaleString(),
            icon: ShieldAlert,
            tone: "text-destructive",
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
            <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-semibold text-muted-foreground">
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
                    ? "bg-destructive"
                    : selected.status === "suspicious"
                      ? "bg-warning"
                      : "bg-success",
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
                      "mr-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase",
                      signal.severity === "high"
                        ? "bg-destructive/10 text-destructive"
                        : signal.severity === "medium"
                          ? "bg-warning/10 text-warning"
                          : "bg-success/10 text-success",
                    )}
                  >
                    {signal.severity}
                  </span>
                  {signal.label}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Resume &amp; profile consistency
            </p>
            {!isBackendUuid(selected.candidate.id) ? (
              <p className="mt-2 rounded-xl border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                Not available for sample candidates — upload a resume to run a live consistency
                check.
              </p>
            ) : consistencyLoading ? (
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking resume &amp; profile consistency…
              </div>
            ) : consistencyError ? (
              <p className="mt-2 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive dark:border-destructive/30 dark:bg-destructive/10 dark:text-destructive">
                Couldn&apos;t run consistency check: {consistencyError}
              </p>
            ) : consistency ? (
              consistency.flags.length === 0 ? (
                <p className="mt-2 rounded-xl border bg-success/10 px-3 py-2 text-sm text-success dark:border-success/30 dark:bg-success/10 dark:text-success">
                  {consistency.summary}
                </p>
              ) : (
                <>
                  {consistency.requires_review && (
                    <div className="mt-2 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning dark:border-warning/30 dark:bg-warning/10 dark:text-warning">
                      <AlertTriangle className="h-4 w-4 shrink-0" />
                      Recruiter review recommended
                    </div>
                  )}
                  <ul className="mt-2 space-y-2">
                    {consistency.flags.map((flag) => (
                      <li
                        key={flag.id}
                        className="rounded-xl border bg-secondary/40 px-3 py-2 text-sm text-muted-foreground"
                      >
                        <span
                          className={cn(
                            "mr-2 inline-flex rounded-full px-2 py-0.5 text-[11px] font-bold uppercase",
                            flag.severity === "high"
                              ? "bg-destructive/10 text-destructive"
                              : flag.severity === "medium"
                                ? "bg-warning/10 text-warning"
                                : "bg-success/10 text-success",
                          )}
                        >
                          {flag.severity}
                        </span>
                        {flag.label}
                        {flag.detail && (
                          <span className="mt-1 block text-xs text-muted-foreground">
                            {flag.detail}
                          </span>
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )
            ) : null}
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
                onClick={() => setSelectedId(item.candidate.id)}
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
