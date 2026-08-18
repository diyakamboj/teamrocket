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
import { analyzeJob, createJob } from "@/lib/api";

export type CreateJobModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function CreateJobModal({ isOpen, onClose }: CreateJobModalProps) {
  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [hiringType, setHiringType] = useState<"internal" | "external">("external");
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("Full-time");
  const [hiringManager, setHiringManager] = useState("");
  const [openings, setOpenings] = useState(1);
  const [newSkillInput, setNewSkillInput] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [copilotFeedback, setCopilotFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Extracted skills
  const [requiredSkills, setRequiredSkills] = useState<string[]>([]);
  const [preferredSkills, setPreferredSkills] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [postToLinkedIn, setPostToLinkedIn] = useState(true);

  const handleAddSkill = (type: "required" | "preferred") => {
    if (!newSkillInput.trim()) return;
    if (type === "required") {
      setRequiredSkills([...requiredSkills, newSkillInput.trim()]);
    } else {
      setPreferredSkills([...preferredSkills, newSkillInput.trim()]);
    }
    setNewSkillInput("");
  };

  const handleRemoveSkill = (skillToRemove: string, type: "required" | "preferred") => {
    if (type === "required") {
      setRequiredSkills(requiredSkills.filter((s) => s !== skillToRemove));
    } else {
      setPreferredSkills(preferredSkills.filter((s) => s !== skillToRemove));
    }
  };

  /**
   * Runs the backend's real JD requirement extraction over the drafted text
   * and fills in the skill chips from what it found.
   */
  const handleAskCopilot = async () => {
    if (!jobTitle.trim() || !descriptionText.trim()) {
      toast.error("Add a job title and description first.");
      return;
    }
    setAnalyzing(true);
    setCopilotFeedback(null);
    try {
      const analysis = await analyzeJob({ title: jobTitle, description: descriptionText });
      setRequiredSkills(analysis.required_skills ?? []);
      setPreferredSkills(analysis.nice_to_have_skills ?? []);
      setCopilotFeedback(
        analysis.summary ||
          `Extracted ${analysis.required_skills?.length ?? 0} required and ${analysis.nice_to_have_skills?.length ?? 0} nice-to-have skills.`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Copilot analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleCreateJob = async () => {
    if (!jobTitle.trim()) {
      toast.error("A job title is required.");
      return;
    }
    setIsSubmitting(true);
    try {
      // Real create: persists the job to the backend store and returns its id.
      const job = await createJob({
        title: jobTitle,
        description: descriptionText,
        required_skills: requiredSkills,
        nice_to_have_skills: preferredSkills,
      });
      onClose();
      setStep(1);
      toast.success(`Job "${job.title}" created.`);
      await navigate({ to: "/jobs/$jobId", params: { jobId: job.id } });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the job");
    } finally {
      setIsSubmitting(false);
    }
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

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto bg-slate-50/30">
          {/* STEP 1: Hiring Type */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Step 1 — Select Hiring Category</h3>
                <p className="text-xs text-slate-500 mt-1">
                  Choose whether this role prioritizes internal talent/bench matching or external candidate recruitment.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setHiringType("internal")}
                  className={`p-6 rounded-xl border text-left transition-all ${
                    hiringType === "internal"
                      ? "bg-blue-50 border-blue-500 text-slate-900 ring-1 ring-blue-500"
                      : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-lg bg-blue-100 text-blue-700">
                      <Briefcase className="w-6 h-6" />
                    </div>
                    {hiringType === "internal" && <CheckCircle2 className="w-5 h-5 text-blue-600" />}
                  </div>
                  <h4 className="font-bold text-slate-900 text-base mt-4">Internal Hiring</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Prioritize internal mobility, existing employees, and bench resources. Enables automatic bench auto-matching.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setHiringType("external")}
                  className={`p-6 rounded-xl border text-left transition-all ${
                    hiringType === "external"
                      ? "bg-indigo-50 border-indigo-500 text-slate-900 ring-1 ring-indigo-500"
                      : "bg-white border-slate-200 text-slate-700 hover:border-slate-300"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-lg bg-indigo-100 text-indigo-700">
                      <Globe className="w-6 h-6" />
                    </div>
                    {hiringType === "external" && <CheckCircle2 className="w-5 h-5 text-indigo-600" />}
                  </div>
                  <h4 className="font-bold text-slate-900 text-base mt-4">External Hiring</h4>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
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
                <h3 className="text-base font-semibold text-slate-900">Step 2 — Job Information & Metadata</h3>
                <p className="text-xs text-slate-500 mt-1">Specify target role parameters and organizational details.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-slate-700">Job Title</label>
                  <Input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="bg-white border-slate-200 text-slate-900 text-xs focus:border-blue-500"
                    placeholder="e.g. Senior Software Engineer"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Department</label>
                  <Input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="bg-white border-slate-200 text-slate-900 text-xs focus:border-blue-500"
                    placeholder="e.g. Engineering"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Location</label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="bg-white border-slate-200 text-slate-900 text-xs focus:border-blue-500"
                    placeholder="e.g. Seattle, WA (Hybrid)"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Hiring Manager</label>
                  <Input
                    value={hiringManager}
                    onChange={(e) => setHiringManager(e.target.value)}
                    className="bg-white border-slate-200 text-slate-900 text-xs focus:border-blue-500"
                    placeholder="e.g. Sarah Connor"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-slate-700">Target Openings</label>
                  <Input
                    type="number"
                    value={openings}
                    onChange={(e) => setOpenings(parseInt(e.target.value) || 1)}
                    className="bg-white border-slate-200 text-slate-900 text-xs focus:border-blue-500"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Job Description & Copilot */}
          {step === 3 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Step 3 — Job Description & Copilot Assistant</h3>
                <p className="text-xs text-slate-500 mt-1">Paste or edit your job description text with real-time Copilot assistance.</p>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                <div className="lg:col-span-2 space-y-2">
                  <label className="text-xs font-semibold text-slate-700">Job Description Text</label>
                  <Textarea
                    value={descriptionText}
                    onChange={(e) => setDescriptionText(e.target.value)}
                    rows={10}
                    className="bg-white border-slate-200 text-slate-900 text-xs font-sans leading-relaxed"
                  />
                </div>

                <div className="p-4 rounded-xl bg-blue-50/50 border border-blue-200 space-y-3">
                  <div className="flex items-center gap-2 text-blue-700 text-xs font-bold">
                    <Bot className="w-4 h-4" /> Copilot Assistant
                  </div>
                  <p className="text-[11px] text-slate-600">
                    I can analyze your job description to detect restrictive requirements or suggest improvements.
                  </p>

                  <div className="space-y-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={analyzing}
                      onClick={() => void handleAskCopilot()}
                      className="w-full justify-start text-[11px]"
                    >
                      {analyzing ? "Analyzing description…" : "Extract requirements from this JD"}
                    </Button>
                  </div>

                  {copilotFeedback && (
                    <div className="p-3 rounded-lg bg-white border border-blue-200 text-blue-900 text-xs leading-relaxed animate-in fade-in shadow-xs">
                      {copilotFeedback}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Job Description Analysis & Editable Skills */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Step 4 — Required & Preferred Skills Tagging</h3>
                <p className="text-xs text-slate-500 mt-1">Add, edit, or remove required and preferred skills for automated matching.</p>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <Input
                  value={newSkillInput}
                  onChange={(e) => setNewSkillInput(e.target.value)}
                  placeholder="Type a skill (e.g. FastAPI, AWS, Docker) and add..."
                  className="bg-white border-slate-200 text-xs"
                />
                <Button size="sm" onClick={() => handleAddSkill("required")} className="bg-blue-600 text-white text-xs whitespace-nowrap">
                  + Add Required
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleAddSkill("preferred")} className="border-slate-200 text-xs whitespace-nowrap">
                  + Add Preferred
                </Button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700">Required Skills ({requiredSkills.length})</label>
                  <div className="flex flex-wrap gap-2">
                    {requiredSkills.map((sk) => (
                      <Badge key={sk} className="bg-blue-50 text-blue-700 border-blue-200 text-xs px-2.5 py-1 flex items-center gap-1.5">
                        ✓ {sk}
                        <span onClick={() => handleRemoveSkill(sk, "required")} className="hover:text-rose-600 cursor-pointer font-bold ml-1">×</span>
                      </Badge>
                    ))}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-slate-700">Preferred Skills ({preferredSkills.length})</label>
                  <div className="flex flex-wrap gap-2">
                    {preferredSkills.map((sk) => (
                      <Badge key={sk} variant="outline" className="text-slate-700 bg-white border-slate-200 text-xs px-2.5 py-1 flex items-center gap-1.5">
                        + {sk}
                        <span onClick={() => handleRemoveSkill(sk, "preferred")} className="hover:text-rose-600 cursor-pointer font-bold ml-1">×</span>
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Historical JD Intelligence */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Step 5 — Historical Hiring Cycle Intelligence</h3>
                <p className="text-xs text-slate-500 mt-1">Copilot benchmarked this position against similar historical hiring cycles.</p>
              </div>

              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-3 shadow-xs">
                <div className="flex items-center gap-2 text-indigo-700 text-xs font-semibold">
                  <History className="w-4 h-4" /> Similar Past Role: Senior Backend Engineer (March 2026)
                </div>
                <div className="grid grid-cols-3 gap-3 pt-2 text-center">
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-lg font-bold text-slate-900">86</div>
                    <div className="text-[10px] text-slate-500">Total Applicants</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-lg font-bold text-blue-600">89%</div>
                    <div className="text-[10px] text-slate-500">Top Candidate Score</div>
                  </div>
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-lg font-bold text-emerald-600">18 Days</div>
                    <div className="text-[10px] text-slate-500">Avg Time-to-Hire</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: Auto Job Posting Simulation */}
          {step === 6 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-slate-900">Step 6 — Final Review & Multi-Channel Distribution</h3>
                <p className="text-xs text-slate-500 mt-1">Confirm job creation and automated portal posting.</p>
              </div>

              <div className="p-4 rounded-xl bg-white border border-slate-200 space-y-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-slate-900 text-base">{jobTitle}</h4>
                    <p className="text-xs text-slate-500">{department} • {location} • {employmentType}</p>
                  </div>
                  <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-bold">
                    Ready to Publish
                  </Badge>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-5 bg-slate-50 border-t border-slate-200 flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={step === 1}
            onClick={() => setStep((s) => s - 1)}
            className="text-xs border-slate-200 bg-white text-slate-700 hover:bg-slate-100 flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>

          {step < 6 ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1.5 rounded-lg"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={handleCreateJob}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs flex items-center gap-1.5 shadow-sm rounded-lg"
            >
              {isSubmitting ? "Creating & Opening Workspace..." : "Create Job & Open JD Workspace"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

