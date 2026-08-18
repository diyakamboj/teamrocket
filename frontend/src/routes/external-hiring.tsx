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
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-50/50 text-slate-900 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 text-indigo-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <Globe className="w-4 h-4" /> External Applicant Recruitment Workspace
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-3">
            External Hiring
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Manage public job postings, candidate applicant funnels, and external sourcing analytics.
          </p>
        </div>

        <Button
          onClick={() => setIsCreateModalOpen(true)}
          className="bg-indigo-600 hover:bg-indigo-700 text-white font-medium text-xs flex items-center gap-2 shadow-sm rounded-lg px-3.5 py-2"
        >
          <PlusCircle className="w-4 h-4" /> + Create External Job
        </Button>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center gap-2 border-b border-slate-200 pb-3">
        {[
          { id: "active", label: "Active External Jobs (8)" },
          { id: "past", label: "Past Hiring Cycles (24)" },
          { id: "insights", label: "External Applicant Analytics" },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
              activeTab === tab.id
                ? "bg-white text-indigo-600 border border-slate-200 shadow-xs"
                : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
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
            <Card key={job.id} className="bg-white border-slate-200/80 hover:border-indigo-400 hover:shadow-xs transition-all rounded-xl">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-[10px] uppercase font-bold">
                    {job.dept}
                  </Badge>
                  <span className="text-[10px] text-emerald-700 font-bold bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">Active Funnel</span>
                </div>
                <CardTitle className="text-base text-slate-900 font-bold mt-2">{job.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-2 p-3 rounded-lg bg-slate-50 border border-slate-200/80 text-center text-xs">
                  <div>
                    <span className="text-[10px] text-slate-500 block font-semibold">Applicants</span>
                    <span className="font-bold text-slate-900">{job.applicants}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-indigo-600 block font-semibold">Top Matches</span>
                    <span className="font-bold text-indigo-600">{job.matches}</span>
                  </div>
                  <div>
                    <span className="text-[10px] text-emerald-600 block font-semibold">Ready</span>
                    <span className="font-bold text-emerald-600">{job.ready}</span>
                  </div>
                </div>

                <Link to="/jobs/$jobId" params={{ jobId: job.id }}>
                  <Button className="w-full bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200 text-xs font-semibold rounded-lg">
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
          <Card className="bg-white border-slate-200/80 p-6 rounded-xl shadow-xs">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Top External Applicant Source</h3>
            <div className="text-xl font-bold text-slate-900 mt-2">LinkedIn Recruiter</div>
            <p className="text-xs text-slate-500 mt-1">62% of top-matching candidates originate from LinkedIn.</p>
          </Card>
          <Card className="bg-white border-slate-200/80 p-6 rounded-xl shadow-xs">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Avg Candidate Resume Score</h3>
            <div className="text-2xl font-bold text-indigo-600 mt-2">84.2%</div>
            <p className="text-xs text-slate-500 mt-1">High average role alignment fit score across applicants.</p>
          </Card>
          <Card className="bg-white border-slate-200/80 p-6 rounded-xl shadow-xs">
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">External Sourcing Funnel Speed</h3>
            <div className="text-2xl font-bold text-emerald-600 mt-2">12.5 Days</div>
            <p className="text-xs text-slate-500 mt-1">Time from resume upload to Interview Round 1 booking.</p>
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
