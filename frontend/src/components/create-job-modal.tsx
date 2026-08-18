import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Briefcase,
  Globe,
  Bot,
  Sparkles,
  CheckCircle2,
  ArrowRight,
  ArrowLeft,
  Share2,
  History,
  ListChecks,
} from "lucide-react";
import { toast } from "sonner";

export type CreateJobModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function CreateJobModal({ isOpen, onClose }: CreateJobModalProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [hiringType, setHiringType] = useState<"internal" | "external">("external");
  const [jobTitle, setJobTitle] = useState("Senior Cloud Infrastructure Architect");
  const [department, setDepartment] = useState("Engineering");
  const [location, setLocation] = useState("Seattle, WA (Hybrid)");
  const [employmentType, setEmploymentType] = useState("Full-time");
  const [hiringManager, setHiringManager] = useState("Sarah Connor");
  const [openings, setOpenings] = useState(2);
  const [targetStartDate, setTargetStartDate] = useState("2026-09-15");
  const [descriptionText, setDescriptionText] = useState(
    `We are seeking a Senior Cloud Infrastructure Architect to lead our Azure multi-tenant microservices deployment.

Responsibilities:
• Architect, deploy, and manage scalable Azure Kubernetes Service (AKS) clusters.
• Build automated CI/CD pipelines using GitHub Actions and Terraform.
• Implement Zero-Trust security and observability frameworks.

Requirements:
• 5+ years of experience with Azure and Python or Go.
• Proven expertise in Kubernetes, Terraform, and Docker containerization.
• Bachelor's degree in Computer Science or equivalent experience.`
  );
  const [copilotFeedback, setCopilotFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Extracted skills
  const [requiredSkills, setRequiredSkills] = useState(["Python", "Azure", "Kubernetes", "Terraform"]);
  const [preferredSkills, setPreferredSkills] = useState(["Go", "Docker", "Zero-Trust"]);
  const [postToLinkedIn, setPostToLinkedIn] = useState(true);

  const handleAskCopilot = (promptType: string) => {
    if (promptType === "restrictive") {
      setCopilotFeedback(
        "🤖 Copilot Analysis: Requiring both 5+ years Azure AND Terraform creates a bottleneck. Only 12% of public candidates possess both at senior level. Recommendation: Mark Terraform as preferred."
      );
    } else if (promptType === "wording") {
      setCopilotFeedback(
        "🤖 Copilot Optimization: Wording is clear and concise. Added technical clarity around AKS multi-tenant clusters and Zero-Trust security standards."
      );
    }
  };

  const handleCreateJob = () => {
    setIsSubmitting(true);
    setTimeout(() => {
      setIsSubmitting(false);
      onClose();
      setStep(1);
      toast.success(`Job "${jobTitle}" successfully created and analyzed!`);
      // Automatically redirect to the newly created JD Workspace!
      navigate({ to: "/jobs/$jobId", params: { jobId: "job_1" } });
    }, 800);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl bg-white border-slate-200 text-slate-900 p-0 overflow-hidden shadow-xl rounded-xl">
        <DialogHeader className="p-5 bg-slate-50 border-b border-slate-200">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg text-slate-900 font-bold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-blue-600" /> Create New Job Description
              </DialogTitle>
              <DialogDescription className="text-slate-500 text-xs mt-0.5">
                Step {step} of 6 — Guided AI Job Creation & Optimization Workflow
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <div
                  key={i}
                  className={`w-6 h-1.5 rounded-full transition-all ${
                    step >= i ? "bg-blue-600" : "bg-slate-200"
                  }`}
                />
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto">
          {/* STEP 1: Hiring Type */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold text-white">Step 1 — Select Hiring Category</h3>
                <p className="text-xs text-slate-400 mt-1">
                  Choose whether this role prioritizes internal talent/bench matching or external candidate recruitment.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setHiringType("internal")}
                  className={`p-6 rounded-xl border text-left transition-all ${
                    hiringType === "internal"
                      ? "bg-sky-500/10 border-sky-500 text-white ring-1 ring-sky-500"
                      : "bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-lg bg-sky-500/20 text-sky-300">
                      <Briefcase className="w-6 h-6" />
                    </div>
                    {hiringType === "internal" && <CheckCircle2 className="w-5 h-5 text-sky-400" />}
                  </div>
                  <h4 className="font-bold text-slate-200 text-lg mt-4">Internal Hiring</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Prioritize internal mobility, existing employees, and bench resources. Enables automatic bench auto-matching.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setHiringType("external")}
                  className={`p-6 rounded-xl border text-left transition-all ${
                    hiringType === "external"
                      ? "bg-indigo-500/10 border-indigo-500 text-white ring-1 ring-indigo-500"
                      : "bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-lg bg-indigo-500/20 text-indigo-300">
                      <Globe className="w-6 h-6" />
                    </div>
                    {hiringType === "external" && <CheckCircle2 className="w-5 h-5 text-indigo-400" />}
                  </div>
                  <h4 className="font-bold text-slate-200 text-lg mt-4">External Hiring</h4>
                  <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                    Recruit external applicants via job portals, direct uploads, and public profile enrichment.
                  </p>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Job Information */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-white">Step 2 — Job Information & Metadata</h3>
                <p className="text-xs text-slate-400 mt-1">Specify target role parameters and organizational details.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-medium text-slate-300">Job Title</label>
                  <Input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-slate-100 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Department</label>
                  <Input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-slate-100 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Location</label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-slate-100 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Hiring Manager</label>
                  <Input
                    value={hiringManager}
                    onChange={(e) => setHiringManager(e.target.value)}
                    className="bg-slate-900 border-slate-800 text-slate-100 text-xs"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-slate-300">Target Openings</label>
                  <Input
                    type="number"
                    value={openings}
                    onChange={(e) => setOpenings(parseInt(e.target.value) || 1)}
                    className="bg-slate-900 border-slate-800 text-slate-100 text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Job Description & Copilot */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-white">Step 3 — Job Description & Copilot Assistant</h3>
                <p className="text-xs text-slate-400 mt-1">Paste your job description text alongside real-time Copilot assistance.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-2">
                  <label className="text-xs font-medium text-slate-300">Job Description Text</label>
                  <Textarea
                    value={descriptionText}
                    onChange={(e) => setDescriptionText(e.target.value)}
                    rows={10}
                    className="bg-slate-900 border-slate-800 text-slate-200 text-xs font-mono"
                  />
                </div>

                <div className="p-4 rounded-xl bg-slate-900/90 border border-slate-800 space-y-3">
                  <div className="flex items-center gap-2 text-sky-400 text-xs font-bold">
                    <Bot className="w-4 h-4" /> Copilot Assistant
                  </div>
                  <p className="text-[11px] text-slate-400">
                    I can analyze your job description to detect overly restrictive requirements or suggest improvements.
                  </p>

                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleAskCopilot("restrictive")}
                      className="w-full text-[11px] border-slate-700 text-slate-300 hover:bg-sky-500/10 justify-start"
                    >
                      "Is this JD too restrictive?"
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => handleAskCopilot("wording")}
                      className="w-full text-[11px] border-slate-700 text-slate-300 hover:bg-sky-500/10 justify-start"
                    >
                      "Improve wording & clarity"
                    </Button>
                  </div>

                  {copilotFeedback && (
                    <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/30 text-sky-300 text-xs leading-relaxed animate-in fade-in">
                      {copilotFeedback}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Job Description Analysis */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-white">Step 4 — Extracted Requirements Analysis</h3>
                <p className="text-xs text-slate-400 mt-1">Review AI-parsed requirements extracted from your job description.</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">Required Skills</label>
                  <div className="flex flex-wrap gap-2">
                    {requiredSkills.map((sk) => (
                      <Badge key={sk} className="bg-sky-500/20 text-sky-300 border-sky-500/40 text-xs px-2.5 py-1">
                        ✓ {sk}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">Preferred Skills</label>
                  <div className="flex flex-wrap gap-2">
                    {preferredSkills.map((sk) => (
                      <Badge key={sk} variant="outline" className="text-slate-300 border-slate-700 text-xs px-2.5 py-1">
                        + {sk}
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                    <span className="text-slate-400">Target Experience:</span>
                    <p className="font-semibold text-slate-200 text-sm mt-0.5">5+ Years Senior Level</p>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-xs">
                    <span className="text-slate-400">Required Education:</span>
                    <p className="font-semibold text-slate-200 text-sm mt-0.5">Bachelor's Degree in CS</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Historical JD Intelligence */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-white">Step 5 — Historical Hiring Cycle Intelligence</h3>
                <p className="text-xs text-slate-400 mt-1">Copilot benchmarked this position against similar historical hiring cycles.</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-3">
                <div className="flex items-center gap-2 text-indigo-400 text-xs font-semibold">
                  <History className="w-4 h-4" /> Similar Past Role: Senior Backend Engineer (March 2026)
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2 text-center">
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-lg font-bold text-white">86</div>
                    <div className="text-[10px] text-slate-400">Total Applicants</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-lg font-bold text-sky-400">89%</div>
                    <div className="text-[10px] text-slate-400">Top Candidate Score</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-950 border border-slate-800">
                    <div className="text-lg font-bold text-emerald-400">18 Days</div>
                    <div className="text-[10px] text-slate-400">Avg Time-to-Hire</div>
                  </div>
                </div>
                <p className="text-xs text-slate-400 leading-relaxed pt-2">
                  <strong>Historical Insight:</strong> In the March hiring cycle, mandatory Terraform requirements eliminated 35% of qualified applicants. Keeping Terraform as preferred yielded 2x more top-tier candidates.
                </p>
              </div>
            </div>
          )}

          {/* STEP 6: Auto Job Posting Simulation */}
          {step === 6 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-white">Step 6 — Final Review & Multi-Channel Distribution</h3>
                <p className="text-xs text-slate-400 mt-1">Confirm job creation and automated portal posting.</p>
              </div>

              <div className="p-4 rounded-xl bg-slate-900 border border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-white text-base">{jobTitle}</h4>
                    <p className="text-xs text-slate-400">{department} • {location} • {employmentType}</p>
                  </div>
                  <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-xs">
                    Ready to Publish
                  </Badge>
                </div>

                <div className="pt-2 space-y-2 border-t border-slate-800">
                  <label className="flex items-center gap-3 text-xs text-slate-200 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={postToLinkedIn}
                      onChange={(e) => setPostToLinkedIn(e.target.checked)}
                      className="rounded border-slate-800 bg-slate-950 text-sky-500"
                    />
                    <Share2 className="w-4 h-4 text-sky-400" />
                    Simulate automated job posting to LinkedIn Recruiter & Indeed
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-6 bg-slate-900/80 border-t border-slate-800 flex items-center justify-between">
          <Button
            type="button"
            variant="ghost"
            disabled={step === 1}
            onClick={() => setStep((s) => s - 1)}
            className="text-xs text-slate-400 hover:text-slate-200 flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>

          {step < 6 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="bg-sky-500 hover:bg-sky-400 text-slate-950 font-semibold text-xs flex items-center gap-1.5"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={handleCreateJob}
              className="bg-gradient-to-r from-sky-500 to-indigo-600 hover:from-sky-400 hover:to-indigo-500 text-white font-semibold text-xs flex items-center gap-1.5 shadow-lg shadow-sky-500/20"
            >
              {isSubmitting ? "Creating & Opening Workspace..." : "Create Job & Open JD Workspace"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
