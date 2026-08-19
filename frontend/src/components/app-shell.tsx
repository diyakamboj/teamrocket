import { Link, useRouterState } from "@tanstack/react-router";
import {

  Bell,
  ChevronsLeft,
  ChevronsRight,
  LayoutDashboard,
  Briefcase,
  Globe,
  Zap,
  Settings,
  PlusCircle,
  Search,
  Bot,
  User,
  LogOut,
  Building2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAppState } from "@/lib/app-state";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getSession, logoutSession } from "@/lib/auth";
import { CreateJobModal } from "@/components/create-job-modal";
import { listJobPipelines, type JobPipelineSummary } from "@/lib/api";

const PRIMARY_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/internal-hiring", label: "Internal Hiring", icon: Briefcase },
  { to: "/external-hiring", label: "External Hiring", icon: Globe },
  { to: "/actions", label: "Actions Center", icon: Zap },
  { to: "/settings", label: "Settings & Context", icon: Settings },
] as const;


export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { active, counts, overallProgress } = useAppState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = getSession();
  const [recentJobs, setRecentJobs] = useState<JobPipelineSummary[]>([]);

  // Real open jobs and their live candidate counts, from the backend store.
  useEffect(() => {
    let cancelled = false;
    const fetchJobs = () => {
      listJobPipelines()
        .then((jobs) => {
          if (!cancelled) setRecentJobs(jobs.slice(0, 5));
        })
        .catch(() => {
          if (!cancelled) setRecentJobs([]);
        });
    };

    fetchJobs();

    const handleJobCreated = () => fetchJobs();
    window.addEventListener("job-created", handleJobCreated);
    return () => {
      cancelled = true;
      window.removeEventListener("job-created", handleJobCreated);
    };
  }, []);



  return (
    <div className="flex min-h-screen bg-background font-sans text-foreground">

      <aside
        className={cn(
          "sticky top-0 z-20 flex h-screen shrink-0 flex-col border-r border-border bg-sidebar shadow-sm transition-[width] duration-300",
          collapsed ? "w-[72px]" : "w-[240px]",
        )}
      >
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-sm font-extrabold text-white shadow-sm">
            R
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-foreground">ResumeIQ</p>
              <p className="truncate text-[10px] font-medium text-muted-foreground">Recruiting Intelligence</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {PRIMARY_NAV.map((item) => {
            const isActive = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
            return (
              <Link
                key={item.to}
                to={item.to}
                title={item.label}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2 text-xs font-medium transition-all justify-between",
                  isActive
                    ? "bg-blue-50 text-blue-700 font-semibold border-l-2 border-blue-600"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground",
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-primary" : "text-muted-foreground")} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </div>
              </Link>
            );
          })}

          {!collapsed && (
            <div className="pt-6 px-1 space-y-2">
              <div className="px-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Recent Jobs
              </div>
              <div className="space-y-0.5">
                {recentJobs.length === 0 ? (
                  <div className="px-2 py-1 text-[10px] text-muted-foreground">No jobs yet</div>
                ) : (
                  recentJobs.map((job) => (
                    <Link
                      key={job.job_id}
                      to="/jobs/$jobId"
                      params={{ jobId: job.job_id }}
                      className="group block rounded-lg p-2 transition-all hover:bg-accent"
                    >
                      <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary">
                        {job.title}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {job.total_candidates} candidate{job.total_candidates === 1 ? "" : "s"}
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}
        </nav>

        {active && (
          <div className="mx-3 mb-3 rounded-lg bg-blue-50/80 border border-blue-100 p-3">
            {collapsed ? (
              <div className="grid place-items-center text-xs font-bold text-blue-700">
                {overallProgress}%
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold text-blue-900">
                  Processing {counts.processing + counts.queued} resumes
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-blue-200/60">
                  <div
                    className="h-full rounded-full bg-blue-600 transition-[width] duration-500"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="m-3 flex items-center justify-center gap-2 rounded-lg border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground"
        >
          {collapsed ? (
            <ChevronsRight className="h-3.5 w-3.5" />
          ) : (
            <>
              <ChevronsLeft className="h-3.5 w-3.5" /> Collapse Sidebar
            </>
          )}
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border bg-card/90 px-6 py-3 shadow-xs backdrop-blur-md">
          <div className="relative min-w-0 max-w-md w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search candidates, active jobs, skills..."
              className="rounded-lg text-xs"
              aria-label="Global Search"
            />
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm rounded-lg px-3 py-1.5"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Create New Job
            </Button>

            <Link to="/actions">
              <button
                aria-label="Actions Center"
                className="relative grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent"
              >
                <Zap className="h-4 w-4 text-amber-500" />
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />
              </button>
            </Link>

            <Link to="/settings">
              <div className="flex items-center gap-2 cursor-pointer border-l border-border pl-2 hover:opacity-90 transition-all">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 border border-blue-200 text-xs font-bold text-blue-700">
                  {session.name ? session.name.substring(0, 2) : "AS"}
                </span>
                <div className="hidden md:block text-left">
                  <div className="text-xs font-semibold leading-none text-foreground">{session.name}</div>
                  <div className="mt-0.5 text-[10px] text-muted-foreground">{session.role}</div>
                </div>
              </div>
            </Link>
          </div>
        </header>

        <main className="flex-1 bg-background p-8">{children}</main>

        <CreateJobModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
        />
      </div>

    </div>
  );
}

