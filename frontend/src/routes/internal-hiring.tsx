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
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-50/50 text-slate-900 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 text-blue-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <Briefcase className="w-4 h-4" /> Internal Talent Marketplace & Bench Sourcing
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            Internal Hiring
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Manage open internal roles, bench employee auto-matching, and internal candidate progression.
          </p>
        </div>

        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-2 shadow-sm rounded-lg px-3.5 py-2"
        >
          <PlusCircle className="w-4 h-4" /> + Create Internal Job
        </Button>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          {[
            { id: "active", label: "Active Internal Jobs (4)" },
            { id: "bench", label: "Bench Employees (8)" },
            { id: "past", label: "Past Hiring Cycles (12)" },
            { id: "insights", label: "Internal Analytics" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-white text-blue-600 border border-slate-200 shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
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
              <Card key={job.id} className="bg-white border-slate-200/80 hover:border-blue-400 hover:shadow-xs transition-all rounded-xl">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] uppercase font-bold">
                      {job.dept}
                    </Badge>
                    <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Active Hiring</span>
                  </div>
                  <CardTitle className="text-base text-slate-900 font-bold mt-2">{job.title}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200/80 text-center text-xs">
                    <div>
                      <span className="text-[10px] text-slate-500 block">Candidates</span>
                      <span className="font-bold text-slate-900">{job.candidates}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-blue-600 block">Bench Matches</span>
                      <span className="font-bold text-blue-600">{job.bench}</span>
                    </div>
                    <div>
                      <span className="text-[10px] text-emerald-600 block">Ready</span>
                      <span className="font-bold text-emerald-600">{job.ready}</span>
                    </div>
                  </div>

                  <Link to="/jobs/$jobId" params={{ jobId: job.id }}>
                    <Button className="w-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold rounded-lg">
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                placeholder="Search bench employees by name, skill (e.g. Azure, React)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white border-slate-200 text-slate-900 text-xs pl-9 focus:border-blue-500 rounded-lg"
              />
            </div>
            <span className="text-xs text-slate-500">
              Showing {filteredBench.length} bench resources available for internal placement
            </span>
          </div>

          <div className="grid grid-cols-1 gap-4">
            {filteredBench.map((emp) => (
              <Card key={emp.id} className="bg-white border-slate-200/80 hover:border-slate-300 transition-all rounded-xl shadow-xs">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className="p-2.5 rounded-lg bg-blue-50 border border-blue-100 text-blue-600">
                        <Users className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-3">
                          <h3 className="font-bold text-slate-900 text-base">{emp.name}</h3>
                          <Badge className="bg-amber-50 text-amber-800 border-amber-200 text-xs font-semibold">
                            {emp.benchDays} Days on Bench
                          </Badge>
                        </div>
                        <p className="text-xs text-slate-500 mt-0.5">{emp.currentRole} • {emp.experienceYears} Years Experience</p>

                        {/* Skills */}
                        <div className="flex flex-wrap gap-1.5 mt-3">
                          {emp.skills.map((sk) => (
                            <Badge key={sk} variant="outline" className="text-slate-700 bg-slate-50 border-slate-200 text-[11px]">
                              {sk}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </div>

                    {/* Matched Roles preview */}
                    <div className="text-right space-y-2">
                      <span className="text-xs text-slate-500 block font-medium">AI Potential Opportunities</span>
                      {emp.matchedRoles.map((match) => (
                        <div key={match.jobId} className="flex items-center gap-2 justify-end">
                          <span className="text-xs font-semibold text-slate-900">{match.jobTitle}</span>
                          <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-bold">
                            {match.matchScore}% Match
                          </Badge>
                        </div>
                      ))}

                      <Button
                        size="sm"
                        onClick={() => setSelectedEmployee(emp)}
                        className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs mt-2 rounded-lg"
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
          <Card className="bg-white border-slate-200/80 p-6 rounded-xl shadow-xs">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Internal Placement Rate</h3>
            <div className="text-2xl font-bold text-slate-900 mt-2">78%</div>
            <p className="text-xs text-slate-500 mt-1">78% of open internal roles filled within 14 days.</p>
          </Card>
          <Card className="bg-white border-slate-200/80 p-6 rounded-xl shadow-xs">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Most Requested Internal Skills</h3>
            <div className="text-sm font-bold text-blue-600 mt-2">Azure, Python, React, Kubernetes</div>
            <p className="text-xs text-slate-500 mt-1">Highest skill demand across current internal JDs.</p>
          </Card>
          <Card className="bg-white border-slate-200/80 p-6 rounded-xl shadow-xs">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Bench Transition Time</h3>
            <div className="text-2xl font-bold text-emerald-600 mt-2">9.4 Days</div>
            <p className="text-xs text-slate-500 mt-1">Fast transition from bench to active project roles.</p>
          </Card>
        </div>
      )}

      {/* BENCH EMPLOYEE DETAIL MODAL */}
      {selectedEmployee && (
        <Dialog open={!!selectedEmployee} onOpenChange={() => setSelectedEmployee(null)}>
          <DialogContent className="sm:max-w-2xl bg-white border-slate-200 text-slate-900 p-6 rounded-xl">
            <DialogHeader>
              <DialogTitle className="text-lg text-slate-900 font-bold flex items-center gap-2">
                <Users className="w-5 h-5 text-blue-600" /> {selectedEmployee.name} — Bench Profile
              </DialogTitle>
              <DialogDescription className="text-slate-500 text-xs">
                {selectedEmployee.currentRole} • {selectedEmployee.experienceYears} Years Exp • {selectedEmployee.benchDays} Days on Bench
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-6 pt-4">
              {/* Skills */}
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-700">Verified Technical Skills</label>
                <div className="flex flex-wrap gap-2">
                  {selectedEmployee.skills.map((sk) => (
                    <Badge key={sk} className="bg-blue-50 text-blue-700 border-blue-200 text-xs">
                      ✓ {sk}
                    </Badge>
                  ))}
                </div>
              </div>

              {/* Matched Opportunities */}
              <div className="space-y-3">
                <label className="text-xs font-semibold text-slate-700">AI Matched Internal Opportunities</label>
                {selectedEmployee.matchedRoles.map((match) => (
                  <div key={match.jobId} className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <h4 className="font-bold text-slate-900 text-sm">{match.jobTitle}</h4>
                        <span className="text-xs text-emerald-600 font-semibold">{match.matchScore}% Role Alignment Fit</span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => handleRecommendEmployee(selectedEmployee.name, match.jobTitle)}
                        className="bg-emerald-600 hover:bg-emerald-700 text-white font-medium text-xs rounded-lg"
                      >
                        Recommend & Place Employee
                      </Button>
                    </div>

                    <div className="grid grid-cols-2 gap-2 text-xs pt-1">
                      <div>
                        <span className="text-slate-500 block text-[10px]">Strong Skills:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {match.strongSkills.map((s) => (
                            <Badge key={s} className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px]">
                              {s}
                            </Badge>
                          ))}
                        </div>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[10px]">Missing Skills:</span>
                        <div className="flex flex-wrap gap-1 mt-1">
                          {match.missingSkills.map((s) => (
                            <Badge key={s} variant="outline" className="text-slate-600 bg-white border-slate-200 text-[10px]">
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
