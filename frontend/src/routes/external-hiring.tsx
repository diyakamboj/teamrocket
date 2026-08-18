import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Globe,
  Users,
  Search,
  Sparkles,
  ArrowRight,
  TrendingUp,
  PlusCircle,
} from "lucide-react";
import { CreateJobModal } from "@/components/create-job-modal";

export const Route = createFileRoute("/external-hiring")({
  component: ExternalHiringPage,
});

function ExternalHiringPage() {
  const [activeTab, setActiveTab] = useState<"active" | "past" | "insights">("active");
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-950 text-slate-100 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Globe className="w-4 h-4" /> External Applicant Recruitment Workspace
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            External Hiring
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Manage public job postings, candidate applicant funnels, and external sourcing analytics.
          </p>
        </div>

        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs flex items-center gap-2 shadow-lg shadow-indigo-500/20"
        >
          <PlusCircle className="w-4 h-4" /> + Create External Job
        </Button>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-3 border-b border-slate-800 pb-3">
        {[
          { id: "active", label: "Active External Jobs (8)" },
          { id: "past", label: "Past Hiring Cycles (24)" },
          { id: "insights", label: "External Applicant Analytics" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
              activeTab === tab.id
                ? "bg-indigo-500/20 text-indigo-300 border border-indigo-500/40"
                : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* TAB 1: ACTIVE JOBS */}
      {activeTab === "active" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[
            { id: "job_1", title: "Software Engineer", applicants: 124, matches: 18, ready: 7, dept: "Engineering" },
            { id: "job_2", title: "Data Scientist", applicants: 86, matches: 11, ready: 4, dept: "AI & Research" },
            { id: "job_3", title: "Cloud Engineer", applicants: 51, matches: 5, ready: 3, dept: "Infrastructure" },
            { id: "job_4", title: "Product Manager", applicants: 92, matches: 14, ready: 5, dept: "Product" },
          ].map((job) => (
            <Card key={job.id} className="bg-slate-900/80 border-slate-800 hover:border-indigo-500/50 transition-all">
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px] uppercase">
                    {job.dept}
                  </Badge>
                  <span className="text-[10px] text-emerald-400 font-semibold">Active Funnel</span>
                </div>
                <CardTitle className="text-lg text-white font-bold mt-2">{job.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-slate-950/70 border border-slate-800 text-center text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 block">Applicants</span>
                    <span className="font-bold text-slate-200">{job.applicants}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-indigo-400 block">Top Matches</span>
                    <span className="font-bold text-indigo-400">{job.matches}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-400 block">Ready</span>
                    <span className="font-bold text-emerald-400">{job.ready}</span>
                  </div>
                </div>

                <Link to="/jobs/$jobId" params={{ jobId: job.id }}>
                  <Button className="w-full bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300 border border-indigo-500/30 text-xs font-semibold">
                    Open Job Workspace →
                  </Button>
                </Link>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* TAB 3: INSIGHTS */}
      {activeTab === "insights" && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Card className="bg-slate-900/80 border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-slate-300">Top External Applicant Source</h3>
            <div className="text-2xl font-extrabold text-white mt-2">LinkedIn Recruiter</div>
            <p className="text-xs text-slate-400 mt-1">62% of top-matching candidates originate from LinkedIn.</p>
          </Card>
          <Card className="bg-slate-900/80 border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-slate-300">Avg Candidate Resume Score</h3>
            <div className="text-3xl font-extrabold text-indigo-400 mt-2">84.2%</div>
            <p className="text-xs text-slate-400 mt-1">High average role alignment fit score across applicants.</p>
          </Card>
          <Card className="bg-slate-900/80 border-slate-800 p-6">
            <h3 className="text-sm font-semibold text-slate-300">External Sourcing Funnel Speed</h3>
            <div className="text-3xl font-extrabold text-emerald-400 mt-2">12.5 Days</div>
            <p className="text-xs text-slate-400 mt-1">Time from resume upload to Interview Round 1 booking.</p>
          </Card>
        </div>
      )}

      <CreateJobModal
        isOpen={isCreateModalOpen}
        onClose={() => setIsCreateModalOpen(false)}
      />
    </div>
  );
}
