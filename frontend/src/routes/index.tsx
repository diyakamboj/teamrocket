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
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-950 text-slate-100 min-h-screen">
      {/* Executive Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-sky-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Sparkles className="w-4 h-4" /> ResumeIQ Executive Control Center
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white">
            Good morning, {session.name.split(" ")[0]} 👋
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Here's what is happening across your internal and external hiring pipelines right now.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <Button
            onClick={() => setIsCreateModalOpen(true)}
            className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-sky-500/20 py-2.5 px-4 rounded-xl"
          >
            <PlusCircle className="w-4 h-4" />
            + Create New Job
          </Button>
        </div>
      </div>

      {/* Global Hiring Metrics Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: "Active Job Openings", val: "12 Roles", sub: "4 Internal • 8 External", icon: Briefcase, color: "text-sky-400" },
          { label: "Total Candidates", val: "308", sub: "47 Internal • 261 External", icon: Users, color: "text-indigo-400" },
          { label: "Top Quality Matches", val: "52", sub: "Score > 85% Fit", icon: Sparkles, color: "text-emerald-400" },
          { label: "Ready for Interview", val: "24", sub: "8 Internal • 16 External", icon: CheckCircle2, color: "text-amber-400" },
        ].map((m, idx) => (
          <Card key={idx} className="bg-slate-900/80 border-slate-800/90 shadow-xl">
            <CardContent className="p-5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-slate-400">{m.label}</span>
                <m.icon className={`w-4 h-4 ${m.color}`} />
              </div>
              <div className="text-2xl font-extrabold text-white mt-2">{m.val}</div>
              <div className="text-[11px] text-slate-500 mt-1">{m.sub}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Main 2 Column Overview Layout: Internal Hiring & External Hiring */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* INTERNAL HIRING OVERVIEW BOX */}
        <Card className="bg-slate-900/80 border-slate-800/90 shadow-xl flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-slate-800/60 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
                    <Briefcase className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-white font-bold">INTERNAL HIRING</CardTitle>
                    <CardDescription className="text-slate-400 text-xs">
                      Active internal roles, bench candidate auto-matching, and internal mobility.
                    </CardDescription>
                  </div>
                </div>
                <Link to="/internal-hiring" className="text-xs font-semibold text-sky-400 hover:underline flex items-center gap-1">
                  View All →
                </Link>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              {/* Internal Metrics bar */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Active Roles</span>
                  <span className="font-extrabold text-white text-base">4 Roles</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Bench Pool</span>
                  <span className="font-extrabold text-sky-400 text-base">8 Candidates</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Interview Ready</span>
                  <span className="font-extrabold text-emerald-400 text-base">5 Ready</span>
                </div>
              </div>

              {/* Active Jobs List */}
              <div className="space-y-2.5">
                {[
                  { id: "job_1", title: "Senior Software Engineer", candidates: 12, bench: 4, status: "Hiring" },
                  { id: "job_2", title: "Cloud Engineer", candidates: 8, bench: 2, status: "Hiring" },
                  { id: "job_3", title: "Data Engineer", candidates: 5, bench: 1, status: "Screening" },
                ].map((job) => (
                  <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }}>
                    <div className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-800/80 hover:border-sky-500/50 transition-all flex items-center justify-between group">
                      <div>
                        <div className="font-semibold text-slate-200 text-sm group-hover:text-sky-400">
                          {job.title}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                          <span>{job.candidates} candidates</span>
                          <span className="text-sky-400 font-medium">👥 {job.bench} bench matches</span>
                        </div>
                      </div>
                      <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-xs">
                        Open Job →
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </div>

          <div className="p-6 border-t border-slate-800/60 bg-slate-950/40">
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              variant="outline"
              className="w-full border-sky-500/30 text-sky-300 hover:bg-sky-500/10 text-xs font-semibold flex items-center justify-center gap-2"
            >
              <PlusCircle className="w-4 h-4" /> + Create Internal Job
            </Button>
          </div>
        </Card>

        {/* EXTERNAL HIRING OVERVIEW BOX */}
        <Card className="bg-slate-900/80 border-slate-800/90 shadow-xl flex flex-col justify-between">
          <div>
            <CardHeader className="border-b border-slate-800/60 pb-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-400 border border-indigo-500/20">
                    <Globe className="w-5 h-5" />
                  </div>
                  <div>
                    <CardTitle className="text-lg text-white font-bold">EXTERNAL HIRING</CardTitle>
                    <CardDescription className="text-slate-400 text-xs">
                      Public applicant funnel, candidate matching, and external sourcing.
                    </CardDescription>
                  </div>
                </div>
                <Link to="/external-hiring" className="text-xs font-semibold text-indigo-400 hover:underline flex items-center gap-1">
                  View All →
                </Link>
              </div>
            </CardHeader>

            <CardContent className="p-6 space-y-4">
              {/* External Metrics bar */}
              <div className="p-3.5 rounded-xl bg-slate-950/70 border border-slate-800/80 grid grid-cols-3 gap-2 text-center text-xs">
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Active Roles</span>
                  <span className="font-extrabold text-white text-base">8 Roles</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Applicants</span>
                  <span className="font-extrabold text-indigo-400 text-base">261 Applicants</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[10px] uppercase">Top Matches</span>
                  <span className="font-extrabold text-emerald-400 text-base">34 Top Matches</span>
                </div>
              </div>

              {/* Active Jobs List */}
              <div className="space-y-2.5">
                {[
                  { id: "job_1", title: "Software Engineer", applicants: 124, matches: 18, ready: 7 },
                  { id: "job_2", title: "Data Scientist", applicants: 86, matches: 11, ready: 4 },
                  { id: "job_3", title: "Cloud Engineer", applicants: 51, matches: 5, ready: 3 },
                ].map((job) => (
                  <Link key={job.id} to="/jobs/$jobId" params={{ jobId: job.id }}>
                    <div className="p-3.5 rounded-xl bg-slate-950/50 border border-slate-800/80 hover:border-indigo-500/50 transition-all flex items-center justify-between group">
                      <div>
                        <div className="font-semibold text-slate-200 text-sm group-hover:text-indigo-400">
                          {job.title}
                        </div>
                        <div className="flex items-center gap-3 text-xs text-slate-400 mt-0.5">
                          <span>{job.applicants} applicants</span>
                          <span className="text-indigo-400 font-medium">🟢 {job.matches} top matches</span>
                        </div>
                      </div>
                      <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-xs">
                        Open Job →
                      </Badge>
                    </div>
                  </Link>
                ))}
              </div>
            </CardContent>
          </div>

          <div className="p-6 border-t border-slate-800/60 bg-slate-950/40">
            <Button
              onClick={() => setIsCreateModalOpen(true)}
              variant="outline"
              className="w-full border-indigo-500/30 text-indigo-300 hover:bg-indigo-500/10 text-xs font-semibold flex items-center justify-center gap-2"
            >
              <PlusCircle className="w-4 h-4" /> + Create External Job
            </Button>
          </div>
        </Card>
      </div>

      {/* JIRA-STYLE RECRUITER AGENT ACTION FEED */}
      <Card className="bg-slate-900/80 border-slate-800/90 shadow-xl">
        <CardHeader className="border-b border-slate-800/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Zap className="w-5 h-5 text-amber-400" />
              <div>
                <CardTitle className="text-lg text-white font-bold">Recruiter Copilot Action Feed</CardTitle>
                <CardDescription className="text-slate-400 text-xs">
                  Background intelligence notifications & actionable recommendations requiring recruiter decision.
                </CardDescription>
              </div>
            </div>
            <Link to="/actions">
              <Button size="sm" variant="ghost" className="text-xs text-amber-400 hover:bg-amber-500/10">
                View All Actions ({3}) →
              </Button>
            </Link>
          </div>
        </CardHeader>
        <CardContent className="p-6 space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Card 1: Bench match */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3 hover:border-emerald-500/40 transition-all">
              <div className="flex items-center justify-between">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-[10px] uppercase">
                  Bench Candidate Match
                </Badge>
                <span className="text-[10px] text-slate-500">5 min ago</span>
              </div>
              <h4 className="font-semibold text-slate-200 text-sm">Cloud Engineer</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                Copilot identified bench employee <strong>Employee A</strong> (94% match) with Azure & Python skills.
              </p>
              <Link to="/internal-hiring">
                <Button size="sm" className="w-full bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 text-xs font-medium">
                  Review & Place Employee →
                </Button>
              </Link>
            </div>

            {/* Card 2: JD Skew */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3 hover:border-amber-500/40 transition-all">
              <div className="flex items-center justify-between">
                <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-[10px] uppercase">
                  JD Skew Warning
                </Badge>
                <span className="text-[10px] text-slate-500">42 min ago</span>
              </div>
              <h4 className="font-semibold text-slate-200 text-sm">Kubernetes Engineer</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                47 applicants received, but only 10% possess Kubernetes. Recommend marking as preferred.
              </p>
              <Link to="/jobs/$jobId" params={{ jobId: "job_1" }}>
                <Button size="sm" className="w-full bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 text-xs font-medium">
                  Review JD Requirement →
                </Button>
              </Link>
            </div>

            {/* Card 3: Readiness assessment */}
            <div className="p-4 rounded-xl bg-slate-950/70 border border-slate-800 space-y-3 hover:border-sky-500/40 transition-all">
              <div className="flex items-center justify-between">
                <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-[10px] uppercase">
                  Readiness Validation
                </Badge>
                <span className="text-[10px] text-slate-500">2 hours ago</span>
              </div>
              <h4 className="font-semibold text-slate-200 text-sm">Senior Software Engineer</h4>
              <p className="text-xs text-slate-400 leading-relaxed">
                3 candidates meet initial fit criteria but require technical assessment prior to Interview Round 1.
              </p>
              <Link to="/jobs/$jobId" params={{ jobId: "job_1" }}>
                <Button size="sm" className="w-full bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-medium">
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
