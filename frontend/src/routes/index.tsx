import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Briefcase,
  Globe,
  PlusCircle,
  Zap,
  Users,
  AlertTriangle,
  Bot,
  ArrowRight,
  TrendingUp,
  CheckCircle2,
  Sparkles,
  Search,
  Sliders,
} from "lucide-react";
import { getSession } from "@/lib/auth";
import { CreateJobModal } from "@/components/create-job-modal";

export const Route = createFileRoute("/")({
  component: DashboardPage,
});

function DashboardPage() {
  const session = getSession();
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-50/50 text-slate-900 min-h-screen">
      {/* Executive Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 text-blue-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <Sparkles className="w-4 h-4" /> ResumeIQ Executive Control Center
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Good morning, {session.name.split(" ")[0]} 👋
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Here's what is happening across your internal and external hiring pipelines right now.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-2 shadow-sm py-2 px-4 rounded-lg"
          >
            <PlusCircle className="w-4 h-4" />
            + Create New Job
          </Button>
        </div>
      </div>

      {/* Global Hiring Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Job Openings", val: "12 Roles", sub: "4 Internal • 8 External", icon: Briefcase, color: "text-blue-600" },
          { label: "Total Candidates", val: "308", sub: "47 Internal • 261 External", icon: Users, color: "text-slate-600" },
          { label: "Top Quality Matches", val: "52", sub: "Score > 85% Fit", icon: Sparkles, color: "text-emerald-600" },
          { label: "Ready for Interview", val: "24", sub: "8 Internal • 16 External", icon: CheckCircle2, color: "text-amber-600" },
        ].map((m, idx) => (
          <Card key={idx} className="bg-white border-slate-200/80 shadow-xs rounded-xl">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-500">{m.label}</span>
                <m.icon className={`w-4 h-4 ${m.color}`} />
              </div>
              <div className="text-xl font-bold text-slate-900 mt-2">{m.val}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{m.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main 2 Column Overview Layout: Internal Hiring & External Hiring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* INTERNAL HIRING OVERVIEW BOX */}
        <Card className="bg-white border-slate-200/80 shadow-xs rounded-xl flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-blue-50 text-blue-600 border border-blue-100">
                    <Briefcase className="w-4 h-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base text-slate-900 font-bold">INTERNAL HIRING</CardTitle>
                    <CardDescription className="text-slate-500 text-xs">
                      Active internal roles, bench candidate auto-matching, and internal mobility.
                    </CardDescription>
                  </div>
                </div>
                <Link to="/internal-hiring" className="text-xs font-semibold text-blue-600 hover:underline flex items-center gap-1">
                  View All →
                </Link>
              </div>
            </CardHeader>

            <CardContent className="p-5 space-y-4">
              {/* Internal Metrics bar */}
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Active Roles</span>
                  <span className="font-bold text-slate-900 text-sm">4 Roles</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Bench Pool</span>
                  <span className="font-bold text-blue-600 text-sm">8 Candidates</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Interview Ready</span>
                  <span className="font-bold text-emerald-600 text-sm">5 Ready</span>
                </div>
              </div>

              {/* Active Jobs List */}
              <div className="space-y-2">
                {[
                  { id: "job_1", title: "Senior Software Engineer", candidates: 12, bench: 4, status: "Hiring" },
                  { id: "job_2", title: "Cloud Engineer", candidates: 8, bench: 2, status: "Hiring" },
                  { id: "job_3", title: "Data Engineer", candidates: 5, bench: 1, status: "Screening" },
                ].map((job) => (
                  <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }}>
                    <div className="p-3 rounded-lg bg-white border border-slate-200/80 hover:border-blue-400 hover:shadow-xs transition-all flex items-center justify-between group">
                      <div>
                        <div className="font-semibold text-slate-900 text-xs group-hover:text-blue-600">
                          {job.title}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                          <span>{job.candidates} candidates</span>
                          <span className="text-blue-600 font-medium">👥 {job.bench} bench matches</span>
                        </div>
                      </div>
                      <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[11px] font-medium">
                        Open Job →
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <Link to="/internal-hiring">
              <Button
                variant="outline"
                className="w-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center justify-center gap-2"
              >
                Go to Internal Mobility Workspace →
              </Button>
            </Link>
          </div>
        </Card>

        {/* EXTERNAL HIRING OVERVIEW BOX */}
        <Card className="bg-white border-slate-200/80 shadow-xs rounded-xl flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-slate-100 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-indigo-50 text-indigo-600 border border-indigo-100">
                    <Globe className="w-4 h-4" />
                  </div>
                  <div>
                    <CardTitle className="text-base text-slate-900 font-bold">EXTERNAL HIRING</CardTitle>
                    <CardDescription className="text-slate-500 text-xs">
                      Public applicant funnel, candidate matching, and external sourcing.
                    </CardDescription>
                  </div>
                </div>
                <Link to="/external-hiring" className="text-xs font-semibold text-indigo-600 hover:underline flex items-center gap-1">
                  View All →
                </Link>
              </div>
            </CardHeader>

            <CardContent className="p-5 space-y-4">
              {/* External Metrics bar */}
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200/80 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Active Roles</span>
                  <span className="font-bold text-slate-900 text-sm">8 Roles</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Applicants</span>
                  <span className="font-bold text-indigo-600 text-sm">261 Applicants</span>
                </div>
                <div>
                  <span className="text-slate-500 block text-[10px] uppercase font-semibold">Top Matches</span>
                  <span className="font-bold text-emerald-600 text-sm">34 Top Matches</span>
                </div>
              </div>

              {/* Active Jobs List */}
              <div className="space-y-2">
                {[
                  { id: "job_1", title: "Software Engineer", applicants: 124, matches: 18, ready: 7 },
                  { id: "job_2", title: "Data Scientist", applicants: 86, matches: 11, ready: 4 },
                  { id: "job_3", title: "Cloud Engineer", applicants: 51, matches: 5, ready: 3 },
                ].map((job) => (
                  <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }}>
                    <div className="p-3 rounded-lg bg-white border border-slate-200/80 hover:border-indigo-400 hover:shadow-xs transition-all flex items-center justify-between group">
                      <div>
                        <div className="font-semibold text-slate-900 text-xs group-hover:text-indigo-600">
                          {job.title}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-500 mt-0.5">
                          <span>{job.applicants} applicants</span>
                          <span className="text-indigo-600 font-medium">🟢 {job.matches} top matches</span>
                        </div>
                      </div>
                      <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[11px] font-medium">
                        Open Job →
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </div>

          <div className="p-4 border-t border-slate-100 bg-slate-50/50">
            <Link to="/external-hiring">
              <Button
                variant="outline"
                className="w-full border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center justify-center gap-2"
              >
                Go to External Sourcing Workspace →
              </Button>
            </Link>
          </div>
        </Card>

      </div>

      {/* RECRUITER AGENT ACTION FEED */}
      <Card className="bg-white border-slate-200/80 shadow-xs rounded-xl">
        <CardHeader className="border-b border-slate-100 pb-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-amber-500" />
              <div>
                <CardTitle className="text-base text-slate-900 font-bold">Recruiter Copilot Action Feed</CardTitle>
                <CardDescription className="text-slate-500 text-xs">
                  Background intelligence notifications & actionable recommendations requiring recruiter decision.
                </CardDescription>
              </div>
            </div>
            <Link to="/actions">
              <Button size="sm" variant="ghost" className="text-xs text-amber-600 hover:bg-amber-50 font-semibold">
                View All Actions ({3}) →
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-5 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Bench match */}
            <div className="p-4 rounded-xl bg-slate-50/50 border border-slate-200/80 space-y-3 hover:border-emerald-300 transition-all">
              <div className="flex items-center justify-between">
                <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-[10px] uppercase font-bold">
                  Bench Candidate Match
                </Badge>
                <span className="text-[10px] text-slate-400">5 min ago</span>
              </div>
              <h4 className="font-semibold text-slate-900 text-xs">Cloud Engineer</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                Copilot identified bench employee <strong>Employee A</strong> (94% match) with Azure & Python skills.
              </p>
              <Link to="/internal-hiring">
                <Button size="sm" className="w-full bg-emerald-50 hover:bg-emerald-100 text-emerald-800 border border-emerald-200 text-xs font-semibold">
                  Review & Place Employee →
                </Button>
              </Link>
            </div>

            {/* Card 2: JD Skew */}
            <div className="p-4 rounded-xl bg-slate-50/50 border border-slate-200/80 space-y-3 hover:border-amber-300 transition-all">
              <div className="flex items-center justify-between">
                <Badge className="bg-amber-50 text-amber-700 border-amber-200 text-[10px] uppercase font-bold">
                  JD Skew Warning
                </Badge>
                <span className="text-[10px] text-slate-400">42 min ago</span>
              </div>
              <h4 className="font-semibold text-slate-900 text-xs">Kubernetes Engineer</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                47 applicants received, but only 10% possess Kubernetes. Recommend marking as preferred.
              </p>
              <Link to="/jobs/$jobId" params={{ jobId: "job_1" }}>
                <Button size="sm" className="w-full bg-amber-50 hover:bg-amber-100 text-amber-800 border border-amber-200 text-xs font-semibold">
                  Review JD Requirement →
                </Button>
              </Link>
            </div>

            {/* Card 3: Readiness assessment */}
            <div className="p-4 rounded-xl bg-slate-50/50 border border-slate-200/80 space-y-3 hover:border-blue-300 transition-all">
              <div className="flex items-center justify-between">
                <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] uppercase font-bold">
                  Readiness Validation
                </Badge>
                <span className="text-[10px] text-slate-400">2 hours ago</span>
              </div>
              <h4 className="font-semibold text-slate-900 text-xs">Senior Software Engineer</h4>
              <p className="text-xs text-slate-600 leading-relaxed">
                3 candidates meet initial fit criteria but require technical assessment prior to Interview Round 1.
              </p>
              <Link to="/jobs/$jobId" params={{ jobId: "job_1" }}>
                <Button size="sm" className="w-full bg-blue-50 hover:bg-blue-100 text-blue-800 border border-blue-200 text-xs font-semibold">
                  Send Readiness Assessment →
                </Button>
              </Link>
            </div>
          </div>
        </CardContent>
      </Card>


      <CreateJobModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
