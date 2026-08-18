import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Zap,
  Bot,
  Users,
  AlertTriangle,
  CheckCircle2,
  ArrowRight,
  Sparkles,
  Filter,
  Search,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/actions")({
  component: ActionsPage,
});

type ActionItem = {
  id: string;
  type: "bench_match" | "jd_optimization" | "readiness_assessment" | "batch_processed";
  title: string;
  description: string;
  timestamp: string;
  jobTitle?: string;
  candidateName?: string;
  status: "pending" | "approved" | "dismissed";
  urgency: "high" | "medium" | "low";
  targetUrl: string;
  actionLabel: string;
};

const INITIAL_ACTIONS: ActionItem[] = [
  {
    id: "act_1",
    type: "bench_match",
    title: "New Internal Bench Candidate Match",
    description: "Copilot identified bench employee Employee A (Senior Cloud Architect) whose profile matches 94% with the open Cloud Engineer position requirements.",
    timestamp: "5 minutes ago",
    jobTitle: "Cloud Engineer",
    candidateName: "Employee A",
    status: "pending",
    urgency: "high",
    targetUrl: "/internal-hiring",
    actionLabel: "Review & Place Employee →",
  },
  {
    id: "act_2",
    type: "jd_optimization",
    title: "JD Optimization Skew Warning",
    description: "Senior Kubernetes Engineer role has received 47 applicants, but only 5 candidates demonstrate Kubernetes experience. Copilot recommends making Kubernetes a nice-to-have.",
    timestamp: "42 minutes ago",
    jobTitle: "Senior Kubernetes Engineer",
    status: "pending",
    urgency: "high",
    targetUrl: "/jobs/job_1",
    actionLabel: "Review JD Requirement →",
  },
  {
    id: "act_3",
    type: "readiness_assessment",
    title: "3 Candidates Ready for Readiness Validation",
    description: "Candidates Candidate A, Candidate B, and Candidate C meet initial match criteria but require technical assessment validation before scheduling Interview Round 1.",
    timestamp: "2 hours ago",
    jobTitle: "Senior Software Engineer",
    status: "pending",
    urgency: "medium",
    targetUrl: "/jobs/job_1",
    actionLabel: "Send Readiness Assessments →",
  },
  {
    id: "act_4",
    type: "batch_processed",
    title: "Batch Resume Parsing Complete",
    description: "18 new applicant resumes for Data Engineer position were parsed, scored, and enriched with public GitHub/LinkedIn signals.",
    timestamp: "4 hours ago",
    jobTitle: "Data Engineer",
    status: "pending",
    urgency: "low",
    targetUrl: "/jobs/job_3",
    actionLabel: "View Processed Batch →",
  },
];

function ActionsPage() {
  const [items, setItems] = useState<ActionItem[]>(INITIAL_ACTIONS);
  const [filterType, setFilterType] = useState<string>("all");

  const handleApprove = (id: string, label: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "approved" } : item))
    );
    toast.success(`Action Executed: ${label}`);
  };

  const handleDismiss = (id: string) => {
    setItems((prev) =>
      prev.map((item) => (item.id === id ? { ...item, status: "dismissed" } : item))
    );
    toast.info("Action item dismissed.");
  };

  const filteredItems = items.filter((item) => {
    if (filterType === "all") return true;
    return item.type === filterType;
  });

  const pendingCount = items.filter((i) => i.status === "pending").length;

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 bg-slate-950 text-slate-100 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold uppercase tracking-wider mb-1">
            <Zap className="w-4 h-4" /> Recruiter Decision Queue
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-white flex items-center gap-3">
            Actions Center
            {pendingCount > 0 && (
              <Badge className="bg-amber-500/20 text-amber-300 border-amber-500/30 text-sm">
                {pendingCount} Pending Actions
              </Badge>
            )}
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Background AI intelligence recommendations requiring recruiter review, decision-making, and approval.
          </p>
        </div>
      </div>

      {/* Filter Tabs */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {[
            { id: "all", label: "All Actions" },
            { id: "bench_match", label: "Bench Matches" },
            { id: "jd_optimization", label: "JD Skew Warnings" },
            { id: "readiness_assessment", label: "Readiness Prompts" },
            { id: "batch_processed", label: "Batch Uploads" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setFilterType(tab.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${
                filterType === tab.id
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                  : "bg-slate-900/60 text-slate-400 border border-slate-800 hover:text-slate-200"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {/* Action Items List */}
      <div className="space-y-4">
        {filteredItems.length === 0 ? (
          <Card className="bg-slate-900/50 border-slate-800 text-center p-12">
            <CheckCircle2 className="w-12 h-12 text-emerald-400 mx-auto mb-3" />
            <h3 className="text-lg font-semibold text-white">Queue Clear!</h3>
            <p className="text-slate-400 text-xs mt-1">
              All background Copilot recommendation items have been reviewed and acted upon.
            </p>
          </Card>
        ) : (
          filteredItems.map((item) => (
            <Card
              key={item.id}
              className={`bg-slate-900/80 border-slate-800 transition-all ${
                item.status !== "pending" ? "opacity-60" : "hover:border-slate-700"
              }`}
            >
              <CardContent className="p-6">
                <div className="flex items-start justify-between gap-6">
                  <div className="flex items-start gap-4">
                    <div
                      className={`p-2.5 rounded-xl border mt-0.5 ${
                        item.type === "bench_match"
                          ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-400"
                          : item.type === "jd_optimization"
                          ? "bg-amber-500/10 border-amber-500/30 text-amber-400"
                          : item.type === "readiness_assessment"
                          ? "bg-sky-500/10 border-sky-500/30 text-sky-400"
                          : "bg-indigo-500/10 border-indigo-500/30 text-indigo-400"
                      }`}
                    >
                      {item.type === "bench_match" && <Users className="w-5 h-5" />}
                      {item.type === "jd_optimization" && <AlertTriangle className="w-5 h-5" />}
                      {item.type === "readiness_assessment" && <Bot className="w-5 h-5" />}
                      {item.type === "batch_processed" && <Sparkles className="w-5 h-5" />}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-3">
                        <h3 className="font-semibold text-slate-100 text-base">{item.title}</h3>
                        {item.urgency === "high" && (
                          <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30 text-[10px] uppercase">
                            High Priority
                          </Badge>
                        )}
                        <span className="text-xs text-slate-500">{item.timestamp}</span>
                      </div>
                      <p className="text-sm text-slate-300 max-w-3xl leading-relaxed">{item.description}</p>
                      {item.jobTitle && (
                        <div className="pt-2 flex items-center gap-2">
                          <span className="text-xs text-slate-500">Target Role:</span>
                          <Badge variant="outline" className="text-slate-300 border-slate-700 text-xs">
                            {item.jobTitle}
                          </Badge>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex flex-col sm:flex-row items-center gap-2 shrink-0">
                    {item.status === "pending" ? (
                      <>
                        <Link to={item.targetUrl}>
                          <Button
                            size="sm"
                            onClick={() => handleApprove(item.id, item.title)}
                            className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
                          >
                            {item.actionLabel}
                          </Button>
                        </Link>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => handleDismiss(item.id)}
                          className="text-slate-500 hover:text-slate-300 text-xs"
                        >
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                        ✓ Action Completed
                      </Badge>
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
