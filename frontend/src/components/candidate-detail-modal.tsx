import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CandidateEnrichmentSection } from "@/components/candidate-enrichment-card";
import { CandidateReadinessSection } from "@/components/candidate-readiness-card";
import {
  User,
  Sparkles,
  ShieldAlert,
  Calendar,
  Send,
  Eye,
  EyeOff,
  CheckCircle2,
  AlertTriangle,
  Bot,
  ExternalLink,
  ChevronDown,
  Building,
  GraduationCap,
  Award,
  Layers,
} from "lucide-react";
import { toast } from "sonner";

export type CandidateDetailModalProps = {
  candidateId: string | null;
  isOpen: boolean;
  onClose: () => void;
};

export function CandidateDetailModal({ candidateId, isOpen, onClose }: CandidateDetailModalProps) {
  const [blindReview, setBlindReview] = useState(false);
  const [currentStage, setCurrentStage] = useState("Screening");
  const [showScheduling, setShowScheduling] = useState(false);
  const [scheduledSuccess, setScheduledSuccess] = useState(false);

  if (!candidateId) return null;

  // Mock candidate detailed profile data
  const candidate = {
    id: candidateId,
    name: blindReview ? "Candidate #4092" : "Alex Johnson",
    email: blindReview ? "[Redacted Email]" : "alex.johnson@example.com",
    phone: blindReview ? "[Redacted Phone]" : "+1 (555) 234-5678",
    location: "Seattle, WA",
    title: "Senior Cloud Infrastructure Engineer",
    overallFit: 94,
    technicalScore: 96,
    experienceScore: 91,
    communicationScore: 88,
    roleAlignmentScore: 95,
    statusBadge: "Top Match",
    isBench: candidateId === "cand_2",
    isImmediateJoiner: true,
    fraudWarning: candidateId === "cand_3",
    skills: ["Python", "Azure", "Kubernetes", "FastAPI", "Terraform", "Docker"],
    experience: [
      {
        company: "CloudScale Tech",
        role: "Senior Cloud Engineer",
        period: "2023 - Present",
        desc: "Architected multi-tenant AKS Kubernetes clusters and automated CI/CD deployment pipelines.",
      },
      {
        company: "DataNode Inc",
        role: "DevOps Engineer",
        period: "2021 - 2023",
        desc: "Managed Azure cloud infrastructure, Docker containers, and Python automation services.",
      },
    ],
    evidenceCitations: [
      {
        skill: "Python & Azure Integration",
        snippet: "Built Python automation microservices on Azure App Services handling 10M+ daily events.",
        score: "98% Match",
      },
      {
        skill: "Kubernetes & AKS",
        snippet: "Deployed production AKS clusters with Zero-Trust network security and Helm charts.",
        score: "94% Match",
      },
    ],
    fraudDetails: {
      timelineOverlap: "Company A (Jan 2022 – Dec 2023) overlaps with Company B (Jun 2023 – Present).",
      fluffingAnomaly: "99% keyword overlap ratio with job posting text.",
    },
  };

  const handleStageChange = (newStage: string) => {
    setCurrentStage(newStage);
    toast.success(`Candidate moved to stage: ${newStage}`);
  };

  const handleScheduleInterview = () => {
    setScheduledSuccess(true);
    toast.success("Interview scheduled! Microsoft Teams meeting link and Outlook calendar invite (.ics) generated.");
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-4xl bg-slate-950 border-slate-800 text-slate-100 p-0 overflow-hidden shadow-2xl">
        {/* Modal Header */}
        <DialogHeader className="p-6 bg-slate-900/90 border-b border-slate-800">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                  🟢 {candidate.statusBadge} ({candidate.overallFit}% Overall Fit)
                </Badge>
                {candidate.isBench && (
                  <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-xs">
                    👥 Internal Bench Candidate
                  </Badge>
                )}
                {candidate.fraudWarning && (
                  <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30 text-xs flex items-center gap-1">
                    <ShieldAlert className="w-3 h-3 text-rose-400" /> Verification Review
                  </Badge>
                )}
              </div>

              <DialogTitle className="text-2xl text-white font-extrabold flex items-center gap-3 mt-2">
                {candidate.name}
              </DialogTitle>
              <DialogDescription className="text-slate-400 text-xs mt-1">
                {candidate.title} • {candidate.location} • Current Hiring Stage:{" "}
                <span className="text-sky-400 font-semibold">{currentStage}</span>
              </DialogDescription>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBlindReview(!blindReview)}
                className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs flex items-center gap-1.5"
              >
                {blindReview ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5 text-sky-400" />}
                {blindReview ? "Blind Mode ON" : "Blind Review"}
              </Button>
            </div>
          </div>

          {/* STAGE ACTION BAR */}
          <div className="mt-4 pt-4 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-400 font-medium">Stage Transition:</span>
              {[
                "Screening",
                "L1 Screening",
                "Interview Round 1",
                "Technical Round",
                "Offer",
              ].map((stg) => (
                <button
                  key={stg}
                  onClick={() => handleStageChange(stg)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium transition-all ${
                    currentStage === stg
                      ? "bg-sky-500 text-slate-950 font-bold shadow-md shadow-sky-500/20"
                      : "bg-slate-950/80 text-slate-400 border border-slate-800 hover:text-slate-200"
                  }`}
                >
                  {stg}
                </button>
              ))}
            </div>

            <Button
              size="sm"
              onClick={() => setShowScheduling(!showScheduling)}
              className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-md shadow-sky-500/20"
            >
              <Calendar className="w-3.5 h-3.5" /> Schedule Teams Interview
            </Button>
          </div>
        </DialogHeader>

        {/* Modal Scrollable Body */}
        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* Scheduling Panel if toggled */}
          {showScheduling && (
            <div className="p-4 rounded-xl bg-sky-500/10 border border-sky-500/30 space-y-3 animate-in fade-in">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-sky-300 flex items-center gap-2">
                  <Calendar className="w-4 h-4 text-sky-400" /> Microsoft Teams & Outlook Meeting Scheduler
                </div>
                {scheduledSuccess && (
                  <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
                    ✓ Invite Sent
                  </Badge>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3 text-xs">
                <button
                  onClick={handleScheduleInterview}
                  className="p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-sky-500 text-left"
                >
                  <span className="text-slate-400 block text-[10px]">Monday Slot:</span>
                  <span className="font-bold text-white">Mon 10:00 AM PST</span>
                </button>
                <button
                  onClick={handleScheduleInterview}
                  className="p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-sky-500 text-left"
                >
                  <span className="text-slate-400 block text-[10px]">Monday Afternoon:</span>
                  <span className="font-bold text-white">Mon 2:00 PM PST</span>
                </button>
                <button
                  onClick={handleScheduleInterview}
                  className="p-3 rounded-lg bg-slate-900 border border-slate-800 hover:border-sky-500 text-left"
                >
                  <span className="text-slate-400 block text-[10px]">Tuesday Morning:</span>
                  <span className="font-bold text-white">Tue 11:00 AM PST</span>
                </button>
              </div>
            </div>
          )}

          {/* Fraud Review Alert if triggered */}
          {candidate.fraudWarning && (
            <div className="p-4 rounded-xl bg-rose-500/10 border border-rose-500/30 space-y-2">
              <div className="flex items-center gap-2 text-rose-300 font-bold text-xs">
                <ShieldAlert className="w-4 h-4 text-rose-400" /> Verification Review Warning
              </div>
              <p className="text-xs text-rose-200/90 leading-relaxed">
                {candidate.fraudDetails.timelineOverlap}
              </p>
            </div>
          )}

          {/* Section 1: Multi-Dimensional AI Evaluation */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-sky-400" /> Multi-Dimensional AI Fit Analysis
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: "Technical Skills", val: `${candidate.technicalScore}%`, color: "text-sky-400" },
                { label: "Role Experience", val: `${candidate.experienceScore}%`, color: "text-indigo-400" },
                { label: "Communication", val: `${candidate.communicationScore}%`, color: "text-emerald-400" },
                { label: "Role Alignment", val: `${candidate.roleAlignmentScore}%`, color: "text-amber-400" },
              ].map((s, idx) => (
                <div key={idx} className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 text-center">
                  <span className="text-[10px] text-slate-400 uppercase font-medium block">{s.label}</span>
                  <span className={`text-xl font-extrabold mt-1 block ${s.color}`}>{s.val}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Section 2: Explainable Ranking & Evidence Tracing */}
          <div className="space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Layers className="w-4 h-4 text-indigo-400" /> Explainable Evidence Tracing (Resume Source Snippets)
            </h3>
            <div className="space-y-2.5">
              {candidate.evidenceCitations.map((ev, idx) => (
                <div key={idx} className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-semibold text-slate-200">✓ {ev.skill}</span>
                    <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-[10px]">
                      {ev.score}
                    </Badge>
                  </div>
                  <p className="text-xs text-slate-400 font-mono italic">"{ev.snippet}"</p>
                </div>
              ))}
            </div>
          </div>

          {/* Section 3: External Profile Signals */}
          <CandidateEnrichmentSection candidateId={candidate.id} />

          {/* Section 4: Aptitude & Readiness Assessment */}
          <CandidateReadinessSection candidateId={candidate.id} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
