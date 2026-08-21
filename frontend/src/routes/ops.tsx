import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Activity, AlertTriangle, Bot, Gauge, ServerCog, Timer } from "lucide-react";
import {
  getOpsAgentHealth,
  getOpsAiServiceHealth,
  getOpsEndpointBreakdown,
  getOpsLogs,
  getOpsOverview,
  getOpsRequestHealth,
  type OpsAgentHealthResponse,
  type OpsAiServiceHealthResponse,
  type OpsEndpointBreakdownResponse,
  type OpsLogsResponse,
  type OpsOverviewResponse,
  type OpsRequestHealthResponse,
} from "@/lib/api";
import { StatCard } from "@/components/stat-card";
import { ChartCard, chartTooltipStyle } from "@/components/chart-card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { getOpsStatusClass, getOpsStatusLabel, type OpsStatus } from "@/lib/ops-status";

export const Route = createFileRoute("/ops")({
  head: () => ({
    meta: [
      { title: "Ops Health — ResumeIQ" },
      {
        name: "description",
        content:
          "Backend, AI service, and copilot agent health — request rates, latency, AI call failures, breaker state, and recent diagnostic events.",
      },
    ],
  }),
  component: Ops,
});

const POLL_INTERVAL_MS = 15000;
const WINDOW_HOURS = 1;

const LOG_STATUS_FILTERS = ["all", "failure", "fallback", "success"] as const;

function StatusPill({ status }: { status: string }) {
  return (
    <Badge variant="outline" className={getOpsStatusClass(status as OpsStatus)}>
      {getOpsStatusLabel(status)}
    </Badge>
  );
}

function formatBucketTime(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime())
    ? iso
    : date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function Ops() {
  const [overview, setOverview] = useState<OpsOverviewResponse | null>(null);
  const [requestHealth, setRequestHealth] = useState<OpsRequestHealthResponse | null>(null);
  const [aiHealth, setAiHealth] = useState<OpsAiServiceHealthResponse | null>(null);
  const [agentHealth, setAgentHealth] = useState<OpsAgentHealthResponse | null>(null);
  const [endpoints, setEndpoints] = useState<OpsEndpointBreakdownResponse | null>(null);
  const [logs, setLogs] = useState<OpsLogsResponse | null>(null);
  const [logStatusFilter, setLogStatusFilter] =
    useState<(typeof LOG_STATUS_FILTERS)[number]>("all");
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [nextOverview, nextRequests, nextAi, nextAgent, nextEndpoints, nextLogs] =
          await Promise.all([
            getOpsOverview(WINDOW_HOURS),
            getOpsRequestHealth(WINDOW_HOURS),
            getOpsAiServiceHealth(WINDOW_HOURS),
            getOpsAgentHealth(WINDOW_HOURS),
            getOpsEndpointBreakdown(WINDOW_HOURS),
            getOpsLogs(WINDOW_HOURS, logStatusFilter === "all" ? undefined : logStatusFilter),
          ]);
        if (cancelled) return;
        setOverview(nextOverview);
        setRequestHealth(nextRequests);
        setAiHealth(nextAi);
        setAgentHealth(nextAgent);
        setEndpoints(nextEndpoints);
        setLogs(nextLogs);
        setLastUpdated(new Date());
        setError(null);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not reach the backend");
        }
      }
    }

    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [logStatusFilter]);

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold sm:text-3xl">Ops Health</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Backend, AI services, and copilot agent — last {WINDOW_HOURS}h, refreshes every 15s
          </p>
        </div>
        <div className="flex items-center gap-2">
          {overview && <StatusPill status={overview.overall_status} />}
          {lastUpdated && (
            <span className="text-xs text-muted-foreground">
              updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
        </div>
      </header>

      {error && (
        <div className="card-surface flex items-center gap-2 border-rose-500/30 bg-rose-500/5 p-4 text-sm text-rose-600 dark:text-rose-400">
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Could not refresh Ops data: {error}
        </div>
      )}

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="application">Application Health</TabsTrigger>
          <TabsTrigger value="ai">AI Services</TabsTrigger>
          <TabsTrigger value="agent">Agent Monitoring</TabsTrigger>
          <TabsTrigger value="diagnostics">Diagnostics</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {(overview?.services ?? []).map((service) => (
              <div key={service.service} className="card-surface p-5">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-sm font-semibold">{service.label}</p>
                  <StatusPill status={service.status} />
                </div>
                <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                  {service.detail}
                </p>
              </div>
            ))}
            {!overview && <p className="text-sm text-muted-foreground">Loading overview…</p>}
          </div>
        </TabsContent>

        <TabsContent value="application" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Activity}
              label="Total requests"
              value={String(requestHealth?.total_requests ?? 0)}
              delta={`last ${WINDOW_HOURS}h`}
            />
            <StatCard
              icon={AlertTriangle}
              label="Error rate"
              value={`${requestHealth?.error_rate_pct ?? 0}%`}
            />
            <StatCard
              icon={Timer}
              label="Avg latency"
              value={`${requestHealth?.avg_latency_ms ?? 0}ms`}
            />
            <StatCard
              icon={Gauge}
              label="P95 latency"
              value={`${requestHealth?.p95_latency_ms ?? 0}ms`}
            />
          </div>

          <ChartCard title="Request volume & errors" subtitle="5-minute buckets, this window">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={requestHealth?.buckets ?? []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" />
                <XAxis
                  dataKey="bucket_start"
                  tickFormatter={formatBucketTime}
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip
                  contentStyle={chartTooltipStyle}
                  labelFormatter={formatBucketTime}
                  cursor={{ fill: "var(--muted)" }}
                />
                <Bar dataKey="count" name="Requests" radius={[8, 8, 0, 0]} fill="var(--chart-1)" />
                <Bar
                  dataKey="error_count"
                  name="Errors"
                  radius={[8, 8, 0, 0]}
                  fill="var(--chart-4)"
                />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <div className="card-surface p-5">
            <h2 className="text-base font-bold">Top endpoints</h2>
            <p className="mb-4 text-xs text-muted-foreground">
              Ranked by error count, then request volume — this window
            </p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Method</TableHead>
                  <TableHead>Path</TableHead>
                  <TableHead className="text-right">Requests</TableHead>
                  <TableHead className="text-right">Errors</TableHead>
                  <TableHead className="text-right">Error rate</TableHead>
                  <TableHead className="text-right">Avg latency</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(endpoints?.endpoints ?? []).map((endpoint) => (
                  <TableRow key={`${endpoint.method}-${endpoint.path}`}>
                    <TableCell className="text-xs font-semibold">{endpoint.method}</TableCell>
                    <TableCell className="max-w-xs truncate font-mono text-xs">
                      {endpoint.path}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {endpoint.count}
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {endpoint.error_count}
                    </TableCell>
                    <TableCell
                      className={cn(
                        "text-right text-xs tabular-nums font-semibold",
                        endpoint.error_rate_pct > 0 && "text-rose-600 dark:text-rose-400",
                      )}
                    >
                      {endpoint.error_rate_pct}%
                    </TableCell>
                    <TableCell className="text-right text-xs tabular-nums">
                      {endpoint.avg_latency_ms}ms
                    </TableCell>
                  </TableRow>
                ))}
                {endpoints && endpoints.endpoints.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No requests in this window.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>

        <TabsContent value="ai" className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-3">
            {(aiHealth?.services ?? []).map((service) => (
              <div key={service.service} className="card-surface p-5">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold">{service.label}</p>
                  <Badge
                    variant="outline"
                    className={service.mock_call_pct >= 50 ? "" : "border-primary/40"}
                  >
                    {service.mock_call_pct >= 50 ? "Mostly Mock" : "Mostly Live"}
                  </Badge>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-y-2 text-xs">
                  <dt className="text-muted-foreground">Calls</dt>
                  <dd className="text-right tabular-nums font-semibold">{service.call_count}</dd>
                  <dt className="text-muted-foreground">Failures</dt>
                  <dd className="text-right tabular-nums font-semibold">{service.failure_count}</dd>
                  <dt className="text-muted-foreground">Fallbacks</dt>
                  <dd className="text-right tabular-nums font-semibold">
                    {service.fallback_count}
                  </dd>
                  <dt className="text-muted-foreground">Avg latency</dt>
                  <dd className="text-right tabular-nums font-semibold">
                    {service.avg_latency_ms}ms
                  </dd>
                  <dt className="text-muted-foreground">P95 latency</dt>
                  <dd className="text-right tabular-nums font-semibold">
                    {service.p95_latency_ms}ms
                  </dd>
                </dl>
                {service.breaker_open !== null && (
                  <div className="mt-3 flex items-center justify-between border-t pt-3">
                    <span className="text-xs text-muted-foreground">Circuit breaker</span>
                    <Badge
                      variant="outline"
                      className={
                        service.breaker_open
                          ? "border-rose-500/30 bg-rose-500/10 text-rose-600 dark:text-rose-400"
                          : "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                      }
                    >
                      {service.breaker_open ? "Open" : "Closed"}
                    </Badge>
                  </div>
                )}
              </div>
            ))}
            {!aiHealth && (
              <p className="text-sm text-muted-foreground">Loading AI service health…</p>
            )}
          </div>
        </TabsContent>

        <TabsContent value="agent" className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={Bot}
              label="Total turns"
              value={String(agentHealth?.total_turns ?? 0)}
              delta={`last ${WINDOW_HOURS}h`}
            />
            <StatCard
              icon={ServerCog}
              label="Deterministic"
              value={String(agentHealth?.deterministic_turns ?? 0)}
            />
            <StatCard
              icon={Bot}
              label="Agent (LLM)"
              value={String(agentHealth?.agent_turns ?? 0)}
            />
            <StatCard
              icon={AlertTriangle}
              label="Fallback rate"
              value={`${agentHealth?.fallback_rate_pct ?? 0}%`}
            />
          </div>

          <ChartCard title="Tool usage" subtitle="Copilot tool selections, this window">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={agentHealth?.tool_usage ?? []} layout="vertical">
                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="var(--border)" />
                <XAxis
                  type="number"
                  allowDecimals={false}
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                />
                <YAxis
                  type="category"
                  dataKey="tool"
                  width={140}
                  tick={{ fontSize: 11 }}
                  stroke="var(--muted-foreground)"
                />
                <Tooltip contentStyle={chartTooltipStyle} cursor={{ fill: "var(--muted)" }} />
                <Bar dataKey="count" radius={[0, 8, 8, 0]} fill="var(--chart-1)" />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </TabsContent>

        <TabsContent value="diagnostics" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {LOG_STATUS_FILTERS.map((filter) => (
              <button
                key={filter}
                onClick={() => setLogStatusFilter(filter)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                  logStatusFilter === filter
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {filter}
              </button>
            ))}
            <span className="ml-auto text-xs text-muted-foreground">
              {logs?.total_count ?? 0} events
            </span>
          </div>

          <div className="card-surface p-2">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Time</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Duration</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(logs?.entries ?? []).map((entry, index) => (
                  <TableRow key={`${entry.created_at}-${index}`}>
                    <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                      {formatBucketTime(entry.created_at)}
                    </TableCell>
                    <TableCell className="text-xs">{entry.event_type}</TableCell>
                    <TableCell className="text-xs">{entry.service}</TableCell>
                    <TableCell>
                      <StatusPill
                        status={
                          entry.status === "success"
                            ? "healthy"
                            : entry.status === "fallback"
                              ? "degraded"
                              : "critical"
                        }
                      />
                    </TableCell>
                    <TableCell className="text-xs tabular-nums">
                      {entry.duration_ms.toFixed(0)}ms
                    </TableCell>
                    <TableCell className="max-w-md truncate text-xs text-muted-foreground">
                      {entry.error_message ?? "—"}
                    </TableCell>
                  </TableRow>
                ))}
                {logs && logs.entries.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={6}
                      className="py-8 text-center text-sm text-muted-foreground"
                    >
                      No events in this window.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
