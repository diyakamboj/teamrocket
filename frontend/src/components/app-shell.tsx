import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
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
  Bot,
  User,
  LogOut,
  Armchair,
  Network,
  Building2,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useAppState } from "@/lib/app-state";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { ProductName } from "@/components/product-name";
import { Button } from "@/components/ui/button";
import { getSession, logoutSession } from "@/lib/auth";
import { CreateJobModal } from "@/components/create-job-modal";
import { GlobalSearch } from "@/components/global-search";
import { listJobPipelines, type JobPipelineSummary } from "@/lib/api";

const PRIMARY_NAV = [
  { to: "/bench", label: "Bench Employees", icon: Armchair },
  { to: "/network", label: "Recruiter Network", icon: Network },
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
  const navigate = useNavigate();
  const session = getSession();
  const initials = session?.name?.trim().slice(0, 2).toUpperCase() ?? "";
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
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-gradient-to-br from-primary to-accent-foreground text-sm font-extrabold text-primary-foreground shadow-[0_6px_18px_-6px_oklch(0.58_0.28_288/0.7)]">
            R
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm tracking-tight text-foreground">
                <ProductName />
              </p>
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
                  "press group relative flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-xs font-medium",
                  "transition-[background-color,color,transform] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                  isActive
                    ? "bg-primary-soft font-semibold text-primary-soft-foreground"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                )}
              >
                {/* The active marker animates in rather than snapping. */}
                <span
                  aria-hidden
                  className={cn(
                    "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary",
                    "transition-[height] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                    isActive ? "h-6" : "h-0",
                  )}
                />
                <div className="flex min-w-0 items-center gap-2.5">
                  <item.icon
                    className={cn(
                      "h-4 w-4 shrink-0 transition-colors duration-300",
                      isActive
                        ? "text-primary"
                        : "text-muted-foreground group-hover:text-foreground",
                    )}
                  />
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
                      params={{ jobId: String(job.job_id) }}
                      className="group block rounded-lg p-2 transition-all hover:bg-accent"
                    >

                      <div className="truncate text-xs font-semibold text-foreground group-hover:text-primary">
                        {job.title}
                      </div>
                      <div className="text-[10px] text-muted-foreground">
                        {job.total_candidates} in pipeline
                      </div>
                    </Link>
                  ))
                )}
              </div>
            </div>
          )}
        </nav>

        {active && (
          <div className="surface-lift mx-3 mb-3 border-primary/20 bg-primary-soft/50 p-3">
            {collapsed ? (
              <div className="grid place-items-center text-xs font-bold text-primary">
                {overallProgress}%
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold text-primary-soft-foreground">
                  Processing {counts.processing + counts.queued} resumes
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-primary/15">
                  <div
                    className="h-full rounded-full bg-gradient-to-r from-primary to-accent-foreground transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
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
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border/70 bg-card/70 px-6 py-3 backdrop-blur-xl">
          <GlobalSearch />

          <div className="flex shrink-0 items-center gap-3">
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="press flex items-center gap-1.5 rounded-xl bg-primary px-3.5 py-1.5 text-xs font-semibold text-primary-foreground shadow-[0_6px_18px_-8px_oklch(0.58_0.28_288/0.9)] transition-shadow duration-300 hover:shadow-[0_10px_26px_-8px_oklch(0.58_0.28_288/0.95)]"
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

            <div className="flex items-center gap-1 border-l border-border pl-2">
              <Link to="/settings">
                <div className="flex cursor-pointer items-center gap-2 rounded-lg p-1 transition-colors hover:bg-accent">
                  <span className="grid h-8 w-8 place-items-center rounded-full border border-primary/25 bg-primary-soft text-xs font-bold text-primary">
                    {initials}
                  </span>
                  <div className="hidden text-left md:block">
                    <div className="text-xs font-semibold leading-none text-foreground">
                      {session?.name}
                    </div>
                    <div className="mt-0.5 text-[10px] text-muted-foreground">{session?.role}</div>
                  </div>
                </div>
              </Link>
              <button
                aria-label="Sign out"
                title="Sign out"
                onClick={() => {
                  logoutSession();
                  void navigate({ to: "/welcome", replace: true });
                }}
                className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </div>
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

