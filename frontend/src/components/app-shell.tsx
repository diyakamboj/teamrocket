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
import { useState, type ReactNode } from "react";
import { useAppState } from "@/lib/app-state";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { getSession, logoutSession } from "@/lib/auth";
import { CreateJobModal } from "@/components/create-job-modal";

const PRIMARY_NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/internal-hiring", label: "Internal Hiring", icon: Briefcase },
  { to: "/external-hiring", label: "External Hiring", icon: Globe },
  { to: "/actions", label: "Actions Center", icon: Zap, badge: 3 },
  { to: "/settings", label: "Settings & Context", icon: Settings },
] as const;

const RECENT_JOBS = [
  { id: "job_1", title: "Senior Software Engineer", count: "12 candidates" },
  { id: "job_2", title: "Cloud Engineer", count: "8 candidates" },
  { id: "job_3", title: "Data Engineer", count: "5 candidates" },
];

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const { active, counts, overallProgress } = useAppState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const session = getSession();


  return (
    <div className="flex min-h-screen bg-slate-50/50 font-sans text-slate-900">

      <aside
        className={cn(
          "sticky top-0 flex h-screen shrink-0 flex-col border-r border-slate-200/80 bg-white transition-[width] duration-300 shadow-sm z-20",
          collapsed ? "w-[72px]" : "w-[240px]",
        )}
      >
        <div className="flex items-center gap-3 px-4 py-5 border-b border-slate-100">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-blue-600 text-sm font-extrabold text-white shadow-sm">
            R
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-sm font-bold tracking-tight text-slate-900">ResumeIQ</p>
              <p className="truncate text-[10px] font-medium text-slate-500">Recruiting Intelligence</p>
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
                    : "text-slate-600 hover:bg-slate-100/80 hover:text-slate-900",
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <item.icon className={cn("h-4 w-4 shrink-0", isActive ? "text-blue-600" : "text-slate-400")} />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </div>
                {!collapsed && "badge" in item && (
                  <span className="px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold border border-amber-200">
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}

          {!collapsed && (
            <div className="pt-6 px-1 space-y-2">
              <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2">
                Recent Jobs
              </div>
              <div className="space-y-0.5">
                {RECENT_JOBS.map((job) => (
                  <Link
                    key={job.id}
                    to="/jobs/$jobId"
                    params={{ jobId: job.id }}
                    className="block p-2 rounded-lg hover:bg-slate-100/80 transition-all group"
                  >
                    <div className="text-xs font-semibold text-slate-700 truncate group-hover:text-blue-600">
                      {job.title}
                    </div>
                    <div className="text-[10px] text-slate-400">{job.count}</div>
                  </Link>
                ))}
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
          className="m-3 flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 hover:text-slate-900 shadow-sm"
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
        <header className="sticky top-0 z-30 flex items-center justify-between gap-4 border-b border-slate-200/80 bg-white/90 px-6 py-3 backdrop-blur-md shadow-xs">
          <div className="relative min-w-0 max-w-md w-full">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
            <Input
              placeholder="Search candidates, active jobs, skills..."
              className="rounded-lg border-slate-200 bg-slate-50/70 text-slate-900 placeholder:text-slate-400 text-xs focus:bg-white focus:border-blue-500"
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
                className="relative grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
              >
                <Zap className="h-4 w-4 text-amber-500" />
                <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-500" />
              </button>
            </Link>

            <Link to="/settings">
              <div className="flex items-center gap-2 pl-2 border-l border-slate-200 cursor-pointer hover:opacity-90 transition-all">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-blue-100 border border-blue-200 text-xs font-bold text-blue-700">
                  {session.name ? session.name.substring(0, 2) : "AS"}
                </span>
                <div className="hidden md:block text-left">
                  <div className="text-xs font-semibold text-slate-900 leading-none">{session.name}</div>
                  <div className="text-[10px] text-slate-500 mt-0.5">{session.role}</div>
                </div>
              </div>
            </Link>
          </div>
        </header>

        <main className="flex-1 bg-slate-50/50">{children}</main>

        <CreateJobModal
          isOpen={isCreateModalOpen}
          onClose={() => setIsCreateModalOpen(false)}
        />
      </div>

    </div>
  );
}

