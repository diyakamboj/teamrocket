import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import {
  Briefcase,
  Users,
  Search,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Award,
  Bot,
  UserCheck,
  Building2,
  PlusCircle,
} from "lucide-react";
import { toast } from "sonner";
import { CreateJobModal } from "@/components/create-job-modal";

export const Route = createFileRoute("/internal-hiring")({
  component: InternalHiringPage,
});

type BenchEmployee = {
  id: string;
  name: string;
  currentRole: string;
  skills: string[];
  experienceYears: number;
  benchDays: number;
  matchedRoles: {
    jobId: string;
    jobTitle: string;
    matchScore: number;
    strongSkills: string[];
    missingSkills: string[];
  }[];
};

const BENCH_EMPLOYEES: BenchEmployee[] = [
  {
    id: "emp_1",
    name: "Employee A (David Chen)",
    currentRole: "Senior Cloud Architect",
    skills: ["Azure", "Python", "Docker", "Terraform"],
    experienceYears: 7,
    benchDays: 14,
    matchedRoles: [
      {
        jobId: "job_2",
        jobTitle: "Cloud Engineer",
        matchScore: 94,
        strongSkills: ["Azure", "Python", "Docker"],
        missingSkills: ["Kubernetes"],
      },
      {
        jobId: "job_1",
        jobTitle: "Senior Software Engineer",
        matchScore: 86,
        strongSkills: ["Python", "Terraform"],
        missingSkills: ["FastAPI"],
      },
    ],
  },
  {
    id: "emp_2",
    name: "Employee B (Sarah Jenkins)",
    currentRole: "Full Stack Engineer",
    skills: ["React", "TypeScript", "Node.js", "GraphQL"],
    experienceYears: 5,
    benchDays: 8,
    matchedRoles: [
      {
        jobId: "job_1",
        jobTitle: "Senior Software Engineer",
        matchScore: 89,
        strongSkills: ["TypeScript", "React"],
        missingSkills: ["Python"],
      },
    ],
  },
  {
    id: "emp_3",
    name: "Employee C (Michael Zhang)",
    currentRole: "Backend Engineer",
    skills: ["Java", "AWS", "Spring Boot", "PostgreSQL"],
    experienceYears: 6,
    benchDays: 21,
    matchedRoles: [
      {
        jobId: "job_3",
        jobTitle: "Data Engineer",
        matchScore: 91,
        strongSkills: ["Java", "PostgreSQL"],
        missingSkills: ["Spark"],
      },
    ],
  },
];

function InternalHiringPage() {
  const [activeTab, setActiveTab] = useState<"active" | "past" | "bench" | "insights">("active");
  const [selectedEmployee, setSelectedEmployee] = useState<BenchEmployee | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  const handleRecommendEmployee = (employeeName: string, jobTitle: string) => {
    toast.success(`Recommended ${employeeName} for open internal position "${jobTitle}"!`);
    setSelectedEmployee(null);
  };

  const filteredBench = BENCH_EMPLOYEES.filter(
    (e) =>
      e.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      e.skills.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-950 text-slate-100 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Briefcase className="w-4 h-4" /> Internal Talent Marketplace & Bench Sourcing
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            Internal Hiring
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage open internal roles, bench employee auto-matching, and internal candidate progression.
          </p>
        </div>

        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-2 shadow-lg shadow-sky-500/20"
        >
          <PlusCircle className="w-4 h-4" /> + Create Internal Job
        </Button>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          {[
            { id: "active", label: "Active Internal Jobs (4)" },
            { id: "bench", label: "Bench Employees (8)" },
            { id: "past", label: "Past Hiring Cycles (12)" },
            { id: "insights", label: "Internal Analytics" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* TAB 1: ACTIVE JOBS */}
      {activeTab === "active" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              { id: "job_1", title: "Senior Software Engineer", candidates: 12, bench: 4, ready: 3, dept: "Engineering" },
              { id: "job_2", title: "Cloud Engineer", candidates: 8, bench: 2, ready: 2, dept: "Infrastructure" },
              { id: "job_3", title: "Data Engineer", candidates: 5, bench: 1, ready: 1, dept: "Analytics" },
              { id: "job_4", title: "DevOps Architect", candidates: 7, bench: 1, ready: 2, dept: "Infrastructure" },
            ].map((job) => (
              <Card key={job.id} className="bg-slate-900/80 border-slate-800 hover:border-sky-500/50 transition-all">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-[10px] uppercase">
                      {job.dept}
                    </Badge>
                    <span className="text-[10px] text-emerald-400 font-semibold">Active Hiring</span>
                  </div>
                  <CardTitle className="text-lg text-white font-bold mt-2">{job.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-center text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Candidates</span>
                      <span className="font-bold text-slate-200">{job.candidates}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-sky-400 block">Bench Matches</span>
                      <span className="font-bold text-sky-400">{job.bench}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-emerald-400 block">Ready</span>
                      <span className="font-bold text-emerald-400">{job.ready}</span>
                    </div>
                  </div>

                  <Link to="/jobs/$jobId" params={{ jobId: job.id }}>
                    <Button className="w-full bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs font-semibold">
                      Open Job Workspace →
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* TAB 2: BENCH EMPLOYEES POOL */}
      {activeTab === "bench" && (
        <div className="space-y-6">
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Search bench employees by name, skill (e.g. Azure, React)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900 border-slate-800 text-slate-200 text-xs pl-9"
              />
            </div>
            <span className="text-xs text-slate-400">
              Showing {filteredBench.length} bench resources available for internal placement
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredBench.map((emp) => (
              <Card key={emp.id} className="bg-slate-900/80 border-slate-800 hover:border-slate-700 transition-all">
                <CardContent className="p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="p-3 rounded-xl bg-sky-500/10 border border-sky-500/20 text-sky-400">
                        <Users className="w-6 h-6" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="font-bold text-white text-lg">{emp.name}</h3>
                          <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-xs">
                            {emp.benchDays} Days on Bench
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-400 mt-0.5">{emp.currentRole} • {emp.experienceYears} Years Experience</p>

                        {/* Skills */}
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {emp.skills.map((sk) => (
                            <Badge key={sk} variant="outline" className="text-slate-300 border-slate-700 text-[11px]">
                              {sk}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Matched Roles preview */}
                    <div className="text-right space-y-2">
                      <span className="text-xs text-slate-400 block font-medium">AI Potential Opportunities</span>
                      {emp.matchedRoles.map((match) => (
                        <div key={match.jobId} className="flex items-center gap-2 justify-end">
                          <span className="text-xs font-semibold text-slate-200">{match.jobTitle}</span>
                          <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                            {match.matchScore}% Match
                          </Badge>
                        </div>
                      ))}

                      <Button
                        size="sm"
                        onClick={() => setSelectedEmployee(emp)}
                        className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs mt-2"
                      >
                        View Bench Profile & Match →
                      </Button>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* TAB 4: INSIGHTS */}
      {activeTab === "insights" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-slate-900/80 border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-slate-300">Internal Placement Rate</h3>
            <div className="text-3xl font-extrabold text-white mt-2">78%</div>
            <p className="text-xs text-slate-400 mt-1">78% of open internal roles filled within 14 days.</p>
          </Card>
          <Card className="bg-slate-900/80 border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-slate-300">Most Requested Internal Skills</h3>
            <div className="text-base font-bold text-sky-400 mt-2">Azure, Python, React, Kubernetes</div>
            <p className="text-xs text-slate-400 mt-1">Highest skill demand across current internal JDs.</p>
          </Card>
          <Card className="bg-slate-900/80 border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-slate-300">Avg Bench Transition Time</h3>
            <div className="text-3xl font-extrabold text-emerald-400 mt-2">9.4 Days</div>
            <p className="text-xs text-slate-400 mt-1">Fast transition from bench to active project roles.</p>
          </Card>
        </div>
      )}

      {/* BENCH EMPLOYEE DETAIL MODAL */}
      {selectedEmployee && (
        <Dialog open={!!selectedEmployee} onOpenChange={() => setSelectedEmployee(null)}>
          <DialogContent className="sm:max-w-2xl bg-slate-950 border-slate-800 text-slate-100 p-6">
            <DialogHeader>
              <DialogTitle className="text-xl text-white font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-sky-400" /> {selectedEmployee.name} — Bench Profile
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs">
                {selectedEmployee.currentRole} • {selectedEmployee.experienceYears} Years Exp • {selectedEmployee.benchDays} Days on Bench
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 pt-4">
              {/* Skills */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-300">Verified Technical Skills</label>
                <div className="flex flex-wrap gap-2">
                  {selectedEmployee.skills.map((sk) => (
                    <Badge key={sk} className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-xs">
                      ✓ {sk}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Matched Opportunities */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-300">AI Matched Internal Opportunities</label>
                {selectedEmployee.matchedRoles.map((match) => (
                  <div key={match.jobId} className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-white text-base">{match.jobTitle}</h4>
                        <span className="text-xs text-emerald-400 font-semibold">{match.matchScore}% Role Alignment Fit</span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleRecommendEmployee(selectedEmployee.name, match.jobTitle)}
                        className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-semibold text-xs"
                      >
                        Recommend & Place Employee
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Strong Skills:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {match.strongSkills.map((s) => (
                            <Badge key={s} className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px]">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Missing Skills:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {match.missingSkills.map((s) => (
                            <Badge key={s} variant="outline" className="text-slate-400 border-slate-700 text-[10px]">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}

      <CreateJobModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
