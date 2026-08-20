import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import {
  Armchair,
  Briefcase,
  Globe,
  LayoutDashboard,
  Moon,
  Network,
  PlusCircle,
  Search,
  Settings,
  Sun,
  Upload,
  UserSearch,
  Users,
  Zap,
} from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { listJobPipelines, type JobPipelineSummary } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import { OPEN_COMMAND_PALETTE, openCreateJob } from "@/lib/app-events";

/**
 * Jump-to-anything, on Cmd/Ctrl-K.
 *
 * The app has seven top-level destinations plus a job workspace per role,
 * which is more than a sidebar can surface without becoming a directory.
 * This is the fast path: type a few letters, land on the screen — including
 * jobs, which are data and were previously only reachable by scrolling the
 * sidebar's "Recent Jobs" list.
 */

const DESTINATIONS = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard, keywords: "home overview pipeline" },
  { to: "/people", label: "Everyone", icon: Users, keywords: "people employees candidates directory all" },
  { to: "/candidates", label: "Candidates", icon: UserSearch, keywords: "applicants pool ranking" },
  { to: "/internal-hiring", label: "Internal Hiring", icon: Briefcase, keywords: "mobility" },
  { to: "/external-hiring", label: "External Hiring", icon: Globe, keywords: "sourcing market" },
  { to: "/bench", label: "Bench Employees", icon: Armchair, keywords: "available staff" },
  { to: "/network", label: "Recruiter Network", icon: Network, keywords: "share collaborate" },
  { to: "/actions", label: "Actions Center", icon: Zap, keywords: "todo tasks" },
  { to: "/upload", label: "Upload Résumés", icon: Upload, keywords: "import parse" },
  { to: "/settings", label: "Settings & Context", icon: Settings, keywords: "preferences" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [jobs, setJobs] = useState<JobPipelineSummary[]>([]);
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((v) => !v);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_COMMAND_PALETTE, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_COMMAND_PALETTE, onOpen);
    };
  }, []);

  // Jobs are only needed once the palette is opened, so the list is not
  // fetched on every page load.
  useEffect(() => {
    if (!open) return;
    listJobPipelines()
      .then(setJobs)
      .catch(() => setJobs([]));
  }, [open]);

  const go = useCallback(
    (to: string, params?: Record<string, string>) => {
      setOpen(false);
      void navigate(params ? { to, params } : { to });
    },
    [navigate],
  );

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search screens, jobs and actions…" />
      <CommandList>
        <CommandEmpty>Nothing matches that.</CommandEmpty>

        <CommandGroup heading="Go to">
          {DESTINATIONS.map((item) => (
            <CommandItem
              key={item.to}
              value={`${item.label} ${item.keywords}`}
              onSelect={() => go(item.to)}
              className="group"
            >
              <item.icon className="icon-nudge mr-2 h-4 w-4 text-muted-foreground group-hover:text-primary" />
              {item.label}
            </CommandItem>
          ))}
        </CommandGroup>

        {jobs.length > 0 && (
          <>
            <CommandSeparator />
            <CommandGroup heading="Jobs">
              {jobs.map((job) => (
                <CommandItem
                  key={job.job_id}
                  value={`job ${job.title}`}
                  onSelect={() => go("/jobs/$jobId", { jobId: String(job.job_id) })}
                  className="group"
                >
                  <Search className="icon-nudge mr-2 h-4 w-4 text-muted-foreground" />
                  <span className="truncate">{job.title}</span>
                  <CommandShortcut>{job.total_candidates} in pipeline</CommandShortcut>
                </CommandItem>
              ))}
            </CommandGroup>
          </>
        )}

        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem
            value="create new job role posting"
            className="group"
            onSelect={() => {
              setOpen(false);
              openCreateJob();
            }}
          >
            <PlusCircle className="icon-nudge mr-2 h-4 w-4 text-muted-foreground group-hover:text-primary" />
            Create a job
          </CommandItem>
        </CommandGroup>

        <CommandSeparator />
        <CommandGroup heading="Preferences">
          <CommandItem
            value="toggle theme dark light appearance"
            onSelect={() => {
              toggle();
              setOpen(false);
            }}
          >
            {theme === "dark" ? (
              <Sun className="mr-2 h-4 w-4 text-muted-foreground" />
            ) : (
              <Moon className="mr-2 h-4 w-4 text-muted-foreground" />
            )}
            Switch to {theme === "dark" ? "light" : "dark"} mode
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
