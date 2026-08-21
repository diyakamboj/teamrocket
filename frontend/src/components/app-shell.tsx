import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {

  Activity,
  Bell,
  ChevronsLeft,
  Command,
  Moon,
  Sun,
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
  UserSearch,
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
import { CommandPalette } from "@/components/command-palette";
import { OPEN_CREATE_JOB, openCommandPalette } from "@/lib/app-events";
import { listJobPipelines, type JobPipelineSummary } from "@/lib/api";

/**
 * Navigation, grouped by what the recruiter is trying to do.
 *
 * These were seven flat entries in which "Internal Hiring", "External
 * Hiring" and "Bench Employees" read as siblings of "Settings" — so the
 * three ways of sourcing a role looked unrelated to each other. Grouping
 * shows which ones are alternatives; Cmd-K covers the fast path for anyone
 * who already knows where they are going.
 *
 * `as const` is load-bearing: the router types `Link to` as a union of real
 * route paths, so these have to stay literals rather than widen to string.
 */
/**
 * Two groups instead of five.
 *
 * Nine items under five headings, three of which held a single link, made
 * the rail read as a site map rather than a place to go. The headings are
 * now the two things a recruiter actually does — fill roles, and work with
 * people — and everything that is not navigation moved out: notifications
 * live in the header bell, settings under the account menu.
 */
const NAV_GROUPS = [
  {
    heading: "Hiring",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutDashboard },
      { to: "/internal-hiring", label: "Internal roles", icon: Briefcase },
      { to: "/external-hiring", label: "External roles", icon: Globe },
    ],
  },
  {
    heading: "People",
    items: [
      { to: "/candidates", label: "Candidates", icon: UserSearch },
      { to: "/bench", label: "Bench", icon: Armchair },
      { to: "/network", label: "Recruiter network", icon: Network },
    ],
  },
  {
    heading: "System",
    items: [
      { to: "/ops", label: "Ops Health", icon: Activity },
    ],
  },
] as const;



export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { theme, toggle } = useTheme();
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
    // Dashboard cards and the palette open this modal without owning it.
    const handleOpenCreateJob = () => setIsCreateModalOpen(true);
    window.addEventListener("job-created", handleJobCreated);
    window.addEventListener(OPEN_CREATE_JOB, handleOpenCreateJob);
    return () => {
      cancelled = true;
      window.removeEventListener("job-created", handleJobCreated);
      window.removeEventListener(OPEN_CREATE_JOB, handleOpenCreateJob);
    };
  }, []);



  return (
    <div className="flex min-h-screen bg-background font-sans text-foreground">

      <aside
        className={cn(
          "sticky top-0 z-20 flex h-screen shrink-0 flex-col border-r border-border bg-sidebar transition-[width] duration-200",
          collapsed ? "w-[72px]" : "w-[240px]",
        )}
      >
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-gradient-to-br from-chart-1 via-chart-2 to-chart-3 text-[13px] font-bold text-white shadow-[0_4px_14px_-4px_var(--color-primary)]">
            R
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm tracking-tight text-foreground">
                <ProductName />
              </p>
              <p className="truncate text-[11px] font-medium text-muted-foreground">Recruiting Intelligence</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 p-3">
          {NAV_GROUPS.map((group) => (
            <div key={group.heading} className="pb-1">
              {/* The heading is what makes the grouping legible; collapsed
                  there is no room, and a rule stands in for it. */}
              {collapsed ? (
                <div aria-hidden className="mx-2 my-2 border-t border-sidebar-border" />
              ) : (
                <p className="px-3 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground/70">
                  {group.heading}
                </p>
              )}

              {group.items.map((item) => {
                const isActive =
                  item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
                return (
                  <Link
                    key={item.to}
                    to={item.to}
                    title={item.label}
                    className={cn(
                      "group relative flex items-center gap-2.5 rounded-md px-3 py-2 text-[13px]",
                      "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)]",
                      isActive
                        ? "bg-primary-soft font-medium text-primary-soft-foreground"
                        : "text-muted-foreground hover:translate-x-0.5 hover:bg-secondary/70 hover:text-foreground",
                    )}
                  >
                    {/* A quiet 2px rail marks the active row instead of a
                        filled accent block. */}
                    <span
                      aria-hidden
                      className={cn(
                        "absolute left-0 top-1/2 w-[3px] -translate-y-1/2 rounded-r-full bg-primary",
                        "transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
                        isActive
                          ? "h-6 opacity-100 shadow-[0_0_10px_1px_var(--color-primary)]"
                          : "h-0 opacity-0",
                      )}
                    />
                    <item.icon
                      className={cn(
                        "icon-nudge h-4 w-4 shrink-0 transition-colors duration-200",
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground group-hover:text-primary",
                      )}
                    />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                );
              })}
            </div>
          ))}

          {!collapsed && (
            <div className="pt-6 px-1 space-y-2">
              <div className="px-2 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                Recent Jobs
              </div>
              <div className="space-y-0.5">
                {recentJobs.length === 0 ? (
                  <div className="px-2 py-1 text-[11px] text-muted-foreground">No jobs yet</div>
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
                      <div className="text-[11px] text-muted-foreground">
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
                    className="h-full rounded-full grad-track transition-[width] duration-500 ease-out"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="m-3 flex items-center justify-center gap-2 rounded-md border border-border bg-card px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
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
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-border bg-background px-6 py-2.5">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <GlobalSearch />
            <button
              type="button"
              onClick={openCommandPalette}
              aria-label="Open command palette"
              title="Jump to anything (⌘K)"
              className="hidden shrink-0 items-center gap-1.5 rounded-md border border-border bg-secondary/60 px-2 py-1 text-xs text-muted-foreground transition-all duration-200 hover:border-primary/40 hover:bg-secondary hover:text-foreground active:scale-95 lg:inline-flex"
            >
              <Command className="h-3 w-3" />
              <span className="font-mono">⌘K</span>
            </button>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              className="press-fx ripple group flex items-center gap-1.5 rounded-md bg-gradient-to-r from-chart-1 to-chart-2 px-3 py-1.5 text-xs font-medium text-white shadow-[0_4px_14px_-6px_var(--color-primary)] transition-all duration-200 hover:shadow-[0_8px_22px_-6px_var(--color-primary)] active:scale-95"
            >
              <PlusCircle className="w-3.5 h-3.5" />
              Create New Job
            </Button>

            <button
              type="button"
              onClick={toggle}
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              title={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
              className="press-fx grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>

            <Link to="/actions">
              <button
                aria-label="Notifications"
                className="relative grid h-8 w-8 place-items-center rounded-lg border border-border text-muted-foreground transition-colors hover:bg-accent"
              >
                <Zap className="h-4 w-4" />
                <span className="pulse-ring absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-primary" />
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
                    <div className="mt-0.5 text-[11px] text-muted-foreground">{session?.role}</div>
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

        {/* Listens for Cmd/Ctrl-K globally; renders nothing until opened. */}
        <CommandPalette />
      </div>

    </div>
  );
}

