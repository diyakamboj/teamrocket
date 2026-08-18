import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import {
  Bell,
  ChevronsLeft,
  ChevronsRight,
  Columns3,
  FileText,
  LayoutDashboard,
  Menu,
  Moon,
  Search,
  ShieldAlert,
  Sparkles,
  Sun,
  Trophy,
  UploadCloud,
} from "lucide-react";
import { useState, type ReactNode } from "react";
import { useAppState } from "@/lib/app-state";
import { useTheme } from "@/lib/theme";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { RecruiterCopilot } from "@/components/recruiter-copilot";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

const NAV = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  { to: "/fraud-detection", label: "Fraud Detection", icon: ShieldAlert },
  { to: "/upload", label: "Resume Upload", icon: UploadCloud },
  { to: "/job-analysis", label: "Job Description", icon: FileText },
  { to: "/candidates", label: "Candidate Ranking", icon: Trophy },
  { to: "/compare", label: "Comparison", icon: Columns3 },
] as const;

function NavLinks({
  pathname,
  collapsed,
  onNavigate,
}: {
  pathname: string;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      {NAV.map((item) => {
        const isActive = item.to === "/" ? pathname === "/" : pathname.startsWith(item.to);
        return (
          <Link
            key={item.to}
            to={item.to}
            title={item.label}
            onClick={onNavigate}
            className={cn(
              "flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors",
              isActive
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <item.icon className="h-[18px] w-[18px] shrink-0" />
            {!collapsed && <span className="truncate">{item.label}</span>}
          </Link>
        );
      })}
    </>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const { theme, toggle } = useTheme();
  const { active, counts, overallProgress, openCopilot, selectedJobId } = useAppState();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const navigate = useNavigate();

  function submitSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = searchQ.trim();
    void navigate({
      to: "/candidates",
      search: {
        ...(selectedJobId ? { job: selectedJobId } : {}),
        ...(q ? { q } : {}),
      },
    });
  }

  return (
    <div className="flex min-h-screen bg-background">
      <aside
        className={cn(
          "sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-300 md:flex",
          collapsed ? "w-[76px]" : "w-[248px]",
        )}
      >
        <div className="flex items-center gap-3 px-4 py-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-black text-primary-foreground">
            R
          </span>
          {!collapsed && (
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold tracking-tight">ResumeIQ</p>
              <p className="truncate text-[11px] text-muted-foreground">Screening assistant</p>
            </div>
          )}
        </div>

        <nav className="flex-1 space-y-1 px-3">
          <NavLinks pathname={pathname} collapsed={collapsed} />
        </nav>

        {active && (
          <div className="mx-3 mb-3 rounded-xl bg-primary-soft p-3">
            {collapsed ? (
              <div className="grid place-items-center text-xs font-bold text-primary-soft-foreground">
                {overallProgress}%
              </div>
            ) : (
              <>
                <p className="text-xs font-semibold text-primary-soft-foreground">
                  Processing {counts.processing + counts.queued} resumes
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-background/60">
                  <div
                    className="h-full rounded-full bg-primary transition-[width] duration-500"
                    style={{ width: `${overallProgress}%` }}
                  />
                </div>
              </>
            )}
          </div>
        )}

        <button
          onClick={() => setCollapsed((c) => !c)}
          className="m-3 flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          {collapsed ? (
            <ChevronsRight className="h-4 w-4" />
          ) : (
            <>
              <ChevronsLeft className="h-4 w-4" /> Collapse
            </>
          )}
        </button>
      </aside>

      <Sheet open={mobileNav} onOpenChange={setMobileNav}>
        <SheetContent side="left" className="w-[280px] bg-sidebar p-0">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <div className="flex items-center gap-3 px-4 py-5">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-primary text-lg font-black text-primary-foreground">
              R
            </span>
            <div className="min-w-0">
              <p className="truncate text-base font-extrabold tracking-tight">ResumeIQ</p>
              <p className="truncate text-[11px] text-muted-foreground">Screening assistant</p>
            </div>
          </div>
          <nav className="space-y-1 px-3">
            <NavLinks pathname={pathname} onNavigate={() => setMobileNav(false)} />
          </nav>
        </SheetContent>
      </Sheet>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border-b bg-background/80 px-4 py-3 backdrop-blur sm:gap-3 sm:px-6">
          <button
            type="button"
            className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground hover:bg-secondary hover:text-foreground md:hidden"
            aria-label="Open navigation"
            onClick={() => setMobileNav(true)}
          >
            <Menu className="h-4 w-4" />
          </button>
          <form onSubmit={submitSearch} className="relative min-w-0 max-w-sm">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQ}
              onChange={(e) => setSearchQ(e.target.value)}
              placeholder="Search candidates…"
              className="rounded-xl pl-9"
              aria-label="Search candidates"
            />
          </form>
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={() => openCopilot({ jobId: selectedJobId })}
              aria-label="Open Recruiter Copilot"
              title="Recruiter Copilot"
              className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Sparkles className="h-4 w-4" />
            </button>
            <button
              onClick={toggle}
              aria-label="Toggle theme"
              className="grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </button>
            <button
              aria-label="Notifications"
              className="relative grid h-9 w-9 place-items-center rounded-xl text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
            >
              <Bell className="h-4 w-4" />
              <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary" />
            </button>
            <span className="ml-1 grid h-9 w-9 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary-soft-foreground">
              AL
            </span>
          </div>
        </header>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>

      <RecruiterCopilot />
    </div>
  );
}
