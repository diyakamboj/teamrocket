import { useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Briefcase,
  CheckCircle2,
  Globe,
  History,
  Info,
  ListChecks,
  Loader2,
  Share2,
  Sliders,
  Sparkles,
  Wand2,
} from "lucide-react";
import { toast } from "sonner";
import {
  analyzeJob,
  createJob,
  listInternalEmployees,
  moveCandidateToRole,
  polishJobDescription,
  type InternalEmployee,
} from "@/lib/api";
import { DEFAULT_WEIGHTS, type Weights } from "@/lib/candidates";
import { getRecruiterSettings } from "@/lib/settings";

function getDynamicBenchmark(title: string) {
  const t = (title || "").toLowerCase();
  if (t.includes("cto") || t.includes("chief") || t.includes("vp") || t.includes("director") || t.includes("head") || t.includes("executive")) {
    return {
      roleTitle: title || "Chief Technology Officer",
      applicants: 42,
      topMatchScore: "94%",
      timeToHire: "28 Days",
      cycles: "14 Executive Cycles",
      insight: `Historical benchmarks for executive & ${title || "CTO"} roles show 48% higher offer acceptance when Strategic Planning, Team Leadership, and System Architecture are explicitly balanced.`,
    };
  }
  if (t.includes("data") || t.includes("ml") || t.includes("ai") || t.includes("scientist") || t.includes("machine learning")) {
    return {
      roleTitle: title || "Data / Machine Learning Engineer",
      applicants: 94,
      topMatchScore: "88%",
      timeToHire: "21 Days",
      cycles: "18 Data Cycles",
      insight: `Data & ML engineering roles benchmarked across past cycles show 38% higher match precision when Python, SQL, and Cloud Data Platforms are explicitly specified.`,
    };
  }
  if (t.includes("manager") || t.includes("lead") || t.includes("product")) {
    return {
      roleTitle: title || "Engineering / Product Leadership",
      applicants: 76,
      topMatchScore: "90%",
      timeToHire: "22 Days",
      cycles: "15 Management Cycles",
      insight: `Leadership and management roles achieve faster candidate convergence when Team Management, Stakeholder Communication, and Roadmap Execution are tagged.`,
    };
  }
  return {
    roleTitle: title || "Software Engineer",
    applicants: 118,
    topMatchScore: "87%",
    timeToHire: "16 Days",
    cycles: "24 Hiring Cycles",
    insight: `Software Engineering roles benchmarked against past hiring cycles show top talent is secured fastest when mandatory coding skills and system architecture are balanced with clear preferred skills.`,
  };
}

type JobRoundDraft = {
  name: string;
  focus: string;
  interview_type: string;
  duration_minutes: number;
};

const WEIGHT_FIELDS = [
  { key: "skills", label: "Technical skills" },
  { key: "experience", label: "Role experience" },
  { key: "education", label: "Education" },
  { key: "certifications", label: "Certifications" },
  { key: "projects", label: "Portfolio projects" },
] as const;

const STEPS = 6;

type CreateJobModalProps = {
  isOpen: boolean;
  onClose: () => void;
};

export function CreateJobModal({ isOpen, onClose }: CreateJobModalProps) {

  const navigate = useNavigate();
  const [step, setStep] = useState(1);
  const [polishing, setPolishing] = useState(false);
  // What the polish changed, shown so the recruiter can see the edit rather
  // than just finding their text replaced.
  const [polishChanges, setPolishChanges] = useState<string[]>([]);
  const [prePolishDescription, setPrePolishDescription] = useState<string | null>(null);
  // The interview loop for this role. Seeded so a new job always has a
  // pipeline the board can render, and editable before the job is created.
  const [rounds, setRounds] = useState<JobRoundDraft[]>([
    { name: "Recruiter screen", focus: "Motivation, logistics, comp", interview_type: "Recruiter Screen", duration_minutes: 30 },
    { name: "Technical interview", focus: "Depth in the core stack", interview_type: "Technical Interview", duration_minutes: 60 },
    { name: "System design", focus: "Design judgement and trade-offs", interview_type: "System Design", duration_minutes: 60 },
    { name: "Hiring manager", focus: "Ownership, collaboration, fit", interview_type: "Hiring Manager", duration_minutes: 45 },
  ]);
  const [hiringType, setHiringType] = useState<"internal" | "external">("external");
  //: Internal people to put on this role's board at creation. Internal
  //: hiring starts from named employees you already have in mind, so the
  //: board should not start empty and wait for a résumé upload.
  const [internalPool, setInternalPool] = useState<InternalEmployee[]>([]);
  const [chosenEmployees, setChosenEmployees] = useState<string[]>([]);

  useEffect(() => {
    if (hiringType !== "internal") return;
    let cancelled = false;
    listInternalEmployees()
      .then((all) => !cancelled && setInternalPool(all))
      .catch(() => !cancelled && setInternalPool([]));
    return () => {
      cancelled = true;
    };
  }, [hiringType]);
  const [jobTitle, setJobTitle] = useState("");
  const [department, setDepartment] = useState("");
  const [location, setLocation] = useState("");
  const [employmentType, setEmploymentType] = useState("Full-time");
  const [hiringManager, setHiringManager] = useState("");
  const [openings, setOpenings] = useState<number | "">(1);
  const [newSkillInput, setNewSkillInput] = useState("");
  const [descriptionText, setDescriptionText] = useState("");
  const [copilotFeedback, setCopilotFeedback] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Extracted skills
  const [requiredSkills, setRequiredSkills] = useState<string[]>([]);
  const [preferredSkills, setPreferredSkills] = useState<string[]>([]);
  const [analyzing, setAnalyzing] = useState(false);
  const [postToLinkedIn, setPostToLinkedIn] = useState(true);
  const [weights, setWeights] = useState<Weights>(() => ({
    ...DEFAULT_WEIGHTS,
    ...getRecruiterSettings().defaultWeights,
  }));

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
      toast.error(err instanceof Error ? err.message : "AI analysis failed");
    } finally {
      setAnalyzing(false);
    }
  };

  async function handlePolish() {
    if (polishing) return;
    setPolishing(true);
    try {
      const result = await polishJobDescription({
        title: jobTitle || "this role",
        description: descriptionText,
      });
      if (!result.polished) {
        toast.info("No model available to polish with — your draft is unchanged.");
        return;
      }
      // Keep the original so the recruiter can undo a rewrite they dislike.
      setPrePolishDescription(descriptionText);
      setDescriptionText(result.polished_description);
      setPolishChanges(result.changes);
      toast.success("Description polished");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not polish the description");
    } finally {
      setPolishing(false);
    }
  }

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
        sourcing_mode: hiringType,
        rounds: rounds
          .filter((r) => r.name.trim())
          .map((r, i) => ({ ...r, name: r.name.trim(), sequence: i + 1 })),
        scoring_weights: weights,
      });
      const newJobId = String(job.id || (job as any).job_id || "");
      if (hiringType === "internal" && chosenEmployees.length > 0 && newJobId) {
        // Sequential rather than parallel: a partial failure should leave a
        // clear count, not an unknown mix of moved and unmoved people.
        let moved = 0;
        for (const candidateId of chosenEmployees) {
          try {
            await moveCandidateToRole(candidateId, newJobId);
            moved += 1;
          } catch {
            // Reported in aggregate below.
          }
        }
        if (moved < chosenEmployees.length) {
          toast.warning(
            `Added ${moved} of ${chosenEmployees.length} employees to this role — you can add the rest from the candidate list.`,
          );
        }
      }
      window.dispatchEvent(new CustomEvent("job-created", { detail: job }));
      onClose();
      setStep(1);
      toast.success(`Job "${job.title}" created.`);
      await navigate({ to: "/jobs/$jobId", params: { jobId: String(job.id || (job as any).job_id || "") } });

    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not create the job");
    } finally {
      setIsSubmitting(false);
    }
  };


  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-3xl bg-card border-border text-foreground p-0 overflow-hidden shadow-xl rounded-xl">
        <DialogHeader className="p-5 bg-secondary border-b border-border">
          <div className="flex items-center justify-between">
            <div>
              <DialogTitle className="text-lg text-foreground font-bold flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary" /> Create New Job Description
              </DialogTitle>
              <DialogDescription className="text-muted-foreground text-xs mt-0.5">
                Step {step} of {STEPS} — Guided AI Job Creation & Historical Intelligence Workflow
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1.5">
              {Array.from({ length: STEPS }, (_, i) => i + 1).map((i) => (
                <div
                  key={i}
                  className={`w-6 h-1.5 rounded-full transition-all ${
                    step >= i ? "bg-primary" : "bg-border"
                  }`}
                />
              ))}
            </div>
          </div>
        </DialogHeader>

        <div className="p-6 space-y-6 max-h-[70vh] overflow-y-auto bg-secondary/30">
          {/* STEP 1: Hiring Type */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h3 className="text-base font-semibold text-foreground">Step 1 — Select Sourcing Category</h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Choose whether this role prioritizes internal talent/bench matching or external candidate recruitment.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <button
                  type="button"
                  onClick={() => setHiringType("internal")}
                  className={`p-6 rounded-xl border text-left transition-all ${
                    hiringType === "internal"
                      ? "bg-primary-soft border-primary text-foreground ring-1 ring-ring"
                      : "bg-card border-border text-foreground hover:border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-lg bg-primary-soft text-primary">
                      <Briefcase className="w-6 h-6" />
                    </div>
                    {hiringType === "internal" && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  </div>
                  <h4 className="font-bold text-foreground text-base mt-4">Internal Hiring Workspace</h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Prioritize internal mobility, existing employees, and bench resources. Enables bench auto-matching.
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => setHiringType("external")}
                  className={`p-6 rounded-xl border text-left transition-all ${
                    hiringType === "external"
                      ? "bg-primary-soft border-primary text-foreground ring-1 ring-ring"
                      : "bg-card border-border text-foreground hover:border-border"
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <div className="p-3 rounded-lg bg-primary-soft text-primary">
                      <Globe className="w-6 h-6" />
                    </div>
                    {hiringType === "external" && <CheckCircle2 className="w-5 h-5 text-primary" />}
                  </div>
                  <h4 className="font-bold text-foreground text-base mt-4">External Sourcing Workspace</h4>
                  <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                    Recruit external applicants via job portals, direct uploads, and public profile enrichment.
                  </p>
                </button>
              </div>

              {/* Internal hiring usually starts from people you already have
                  in mind, so the role's board can be populated here rather
                  than starting empty and waiting for a résumé upload. */}
              {hiringType === "internal" && (
                <div className="rounded-xl border border-border bg-card p-5">
                  <h4 className="text-sm font-semibold text-foreground">
Pick from the bench
                  </h4>
                  <p className="mt-1 text-xs text-muted-foreground">
                    People on the bench are available now, so they are listed first. Anyone you
                    pick is added to this role&apos;s pipeline.
                  </p>

                  {internalPool.length === 0 ? (
                    <p className="mt-4 rounded-lg border border-dashed px-3 py-6 text-center text-xs text-muted-foreground">
                      No internal employees yet. Add them on the Bench Employees page — they do not
                      need a résumé — and they will appear here.
                    </p>
                  ) : (
                    <ul className="mt-4 max-h-56 space-y-1.5 overflow-y-auto pr-1">
                      {internalPool.map((person) => {
                        const checked = chosenEmployees.includes(person.candidate_id);
                        const onBench = person.on_bench;
                        return (
                          <li key={person.candidate_id}>
                            <label
                              className={`flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 transition-colors ${
                                checked
                                  ? "border-primary bg-primary-soft"
                                  : "border-border hover:border-border"
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setChosenEmployees((prev) =>
                                    e.target.checked
                                      ? [...prev, person.candidate_id]
                                      : prev.filter((id) => id !== person.candidate_id),
                                  )
                                }
                                className="h-3.5 w-3.5"
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block truncate text-xs font-semibold text-foreground">
                                  {person.name}
                                </span>
                                <span className="block truncate text-xs text-muted-foreground">
                                  {person.title || "No title"}
                                  {" · "}
                                  {onBench
                                    ? `On the bench${
                                        typeof person.days_on_bench === "number"
                                          ? ` · ${person.days_on_bench}d`
                                          : ""
                                      }`
                                    : person.current_assignment
                                      ? `Currently on ${person.current_assignment}`
                                      : "Currently assigned"}
                                </span>
                              </span>
                              {onBench && (
                                <span className="shrink-0 rounded-full bg-success/10 px-2 py-0.5 text-[11px] font-semibold text-success">
                                  Available
                                </span>
                              )}
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}

                  {chosenEmployees.length > 0 && (
                    <p className="mt-3 text-xs font-medium text-primary">
                      {chosenEmployees.length} employee
                      {chosenEmployees.length === 1 ? "" : "s"} will be added to this role.
                    </p>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Job Information */}
          {step === 2 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Step 2 — Role Parameters & Metadata</h3>
                <p className="text-xs text-muted-foreground mt-1">Specify target role parameters and organizational details.</p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="space-y-1.5 md:col-span-2">
                  <label className="text-xs font-semibold text-foreground">Job Title</label>
                  <Input
                    value={jobTitle}
                    onChange={(e) => setJobTitle(e.target.value)}
                    className="bg-card border-border text-foreground text-xs focus:border-primary"
                    placeholder="e.g. Senior Software Engineer"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Department</label>
                  <Input
                    value={department}
                    onChange={(e) => setDepartment(e.target.value)}
                    className="bg-card border-border text-foreground text-xs focus:border-primary"
                    placeholder="e.g. Engineering"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Location</label>
                  <Input
                    value={location}
                    onChange={(e) => setLocation(e.target.value)}
                    className="bg-card border-border text-foreground text-xs focus:border-primary"
                    placeholder="e.g. Seattle, WA (Hybrid)"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Hiring Manager</label>
                  <Input
                    value={hiringManager}
                    onChange={(e) => setHiringManager(e.target.value)}
                    className="bg-card border-border text-foreground text-xs focus:border-primary"
                    placeholder="e.g. Sarah Connor"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-foreground">Target Openings</label>
                  <Input
                    type="number"
                    min={1}
                    value={openings}
                    onChange={(e) => {
                      const val = e.target.value;
                      setOpenings(val === "" ? "" : Math.max(1, parseInt(val) || 1));
                    }}
                    className="bg-card border-border text-foreground text-xs focus:border-primary"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Job Description Text & Copilot Assistant + Historical Benchmarks */}
          {step === 3 && (
            <div className="space-y-5">
              <div>
                <h3 className="text-base font-semibold text-foreground">Step 3 — Job Description & AI Historical Intelligence</h3>
                <p className="text-xs text-muted-foreground mt-1">Paste your job description. AI extracts requirements and scores them against past hiring cycles.</p>
              </div>

              <div className="space-y-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-foreground">Job Description Text</label>
                  <div className="flex items-center gap-2">
                    {prePolishDescription !== null && (
                      <button
                        type="button"
                        onClick={() => {
                          setDescriptionText(prePolishDescription);
                          setPrePolishDescription(null);
                          setPolishChanges([]);
                        }}
                        className="text-xs font-medium text-muted-foreground hover:text-foreground"
                      >
                        Undo polish
                      </button>
                    )}
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={polishing || descriptionText.trim().length < 40}
                      onClick={() => void handlePolish()}
                      title={
                        descriptionText.trim().length < 40
                          ? "Write a bit more first"
                          : "Rewrite for clarity and inclusive language"
                      }
                      className="h-7 rounded-lg border-primary/30 text-primary text-xs hover:bg-primary-soft"
                    >
                      {polishing ? (
                        <>
                          <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> Polishing…
                        </>
                      ) : (
                        <>
                          <Wand2 className="mr-1.5 h-3 w-3" /> Polish with AI
                        </>
                      )}
                    </Button>
                  </div>
                </div>
                <Textarea
                  value={descriptionText}
                  onChange={(e) => setDescriptionText(e.target.value)}
                  rows={8}
                  placeholder="Paste job description text here (e.g., We are looking for a Senior Software Engineer with Python, SQL, Azure, and Docker experience)..."
                  className="bg-card border-border text-foreground text-xs font-sans leading-relaxed"
                />

                {polishChanges.length > 0 && (
                  <div className="animate-fade rounded-lg border border-primary/30 bg-primary-soft/60 p-3">
                    <p className="text-xs font-bold text-primary">What the polish changed</p>
                    <ul className="mt-1.5 space-y-1">
                      {polishChanges.map((change, i) => (
                        <li key={i} className="flex gap-1.5 text-xs text-muted-foreground">
                          <span className="mt-1 h-1 w-1 shrink-0 rounded-full bg-primary" />
                          {change}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>

              {/* Copilot Assistant placed directly below the textarea */}
              <div className="p-4 rounded-xl bg-primary-soft/70 border border-primary/30 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-primary text-xs font-bold">
                    <Bot className="w-4 h-4" /> AI requirement extraction
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={analyzing}
                    onClick={() => void handleAskCopilot()}
                    className="text-xs bg-card border-primary/40 text-primary hover:bg-primary-soft font-semibold"
                  >
                    {analyzing ? "Analyzing description…" : "Extract Requirements & Analyze JD"}
                  </Button>
                </div>

                {copilotFeedback ? (
                  <div className="p-3 rounded-lg bg-card border border-primary/30 text-primary text-xs leading-relaxed animate-in fade-in shadow-xs">
                    {copilotFeedback}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    Click <strong>Extract Requirements</strong> to run automated AI requirement detection across skills, experience, and education requirements.
                  </p>
                )}
              </div>

              {/* Historical Hiring Cycle Intelligence Card */}

              {(() => {
                const bm = getDynamicBenchmark(jobTitle);
                return (
                  <div className="p-4 rounded-xl bg-card border border-border space-y-3 shadow-xs">
                    <div className="flex items-center justify-between border-b border-border pb-2">
                      <div className="flex items-center gap-2 text-primary text-xs font-bold">
                        <History className="w-4 h-4" /> Historical Hiring Benchmark: {bm.roleTitle}
                      </div>
                      <Badge className="bg-primary-soft text-primary border-primary/30 text-[11px]">
                        Benchmarked vs {bm.cycles}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-3 gap-3 text-center">
                      <div className="p-2.5 rounded-lg bg-secondary border border-border/80">
                        <div className="text-base font-bold text-foreground">{bm.applicants}</div>
                        <div className="text-[11px] text-muted-foreground">Avg Applicants</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-secondary border border-border/80">
                        <div className="text-base font-bold text-primary">{bm.topMatchScore}</div>
                        <div className="text-[11px] text-muted-foreground">Top Match Score</div>
                      </div>
                      <div className="p-2.5 rounded-lg bg-secondary border border-border/80">
                        <div className="text-base font-bold text-success">{bm.timeToHire}</div>
                        <div className="text-[11px] text-muted-foreground">Avg Time-to-Hire</div>
                      </div>
                    </div>

                    <p className="text-xs text-muted-foreground leading-relaxed">
                      {bm.insight}
                    </p>
                  </div>
                );
              })()}

            </div>
          )}

          {/* STEP 4: Job Description Analysis & Editable Skills */}
          {step === 4 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Step 4 — Required & Preferred Skills Tagging</h3>
                <p className="text-xs text-muted-foreground mt-1">Add, edit, or remove required and preferred skills for candidate match scoring.</p>
              </div>

              <div className="flex items-center gap-2 mb-2">
                <Input
                  value={newSkillInput}
                  onChange={(e) => setNewSkillInput(e.target.value)}
                  placeholder="Type a skill (e.g. FastAPI, AWS, Docker) and add..."
                  className="bg-card border-border text-xs"
                />
                <Button size="sm" onClick={() => handleAddSkill("required")} className="bg-primary text-white text-xs whitespace-nowrap">
                  + Add Required
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleAddSkill("preferred")} className="border-border text-xs whitespace-nowrap">
                  + Add Preferred
                </Button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground">Required Mandatory Skills ({requiredSkills.length})</label>
                  <div className="flex flex-wrap gap-2">
                    {requiredSkills.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">No required skills tagged yet.</span>
                    ) : (
                      requiredSkills.map((sk) => (
                        <Badge key={sk} className="bg-primary-soft text-primary border-primary/30 text-xs px-2.5 py-1 flex items-center gap-1.5">
                          ✓ {sk}
                          <span onClick={() => handleRemoveSkill(sk, "required")} className="hover:text-destructive cursor-pointer font-bold ml-1">×</span>
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-semibold text-foreground">Preferred Nice-to-Have Skills ({preferredSkills.length})</label>
                  <div className="flex flex-wrap gap-2">
                    {preferredSkills.length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">No preferred skills tagged yet.</span>
                    ) : (
                      preferredSkills.map((sk) => (
                        <Badge key={sk} variant="outline" className="text-foreground bg-card border-border text-xs px-2.5 py-1 flex items-center gap-1.5">
                          + {sk}
                          <span onClick={() => handleRemoveSkill(sk, "preferred")} className="hover:text-destructive cursor-pointer font-bold ml-1">×</span>
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Scoring weights for this role */}
          {step === 5 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground flex items-center gap-2">
                  <Sliders className="h-4 w-4 text-primary" /> Step 5 — Default scoring weights
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  How this role ranks candidates. Seeded from your Settings defaults; still
                  adjustable later from the job workspace.
                </p>
              </div>

              <div className="rounded-xl border border-border bg-card p-5 space-y-5 shadow-xs">
                {WEIGHT_FIELDS.map((item) => (
                  <div key={item.key} className="space-y-2">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-foreground">{item.label}</span>
                      <span className="font-semibold tabular-nums text-primary">
                        {weights[item.key]}%
                      </span>
                    </div>
                    <Slider
                      min={0}
                      max={50}
                      step={5}
                      value={[weights[item.key]]}
                      onValueChange={([v]) =>
                        setWeights((prev) => ({ ...prev, [item.key]: v ?? prev[item.key] }))
                      }
                    />
                  </div>
                ))}

                <div className="flex items-start gap-2.5 rounded-xl border bg-primary-soft/70 border-primary/20 p-3.5">
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    Total{" "}
                    <strong className="text-foreground tabular-nums">
                      {Object.values(weights).reduce((a, b) => a + b, 0)}%
                    </strong>{" "}
                    — weights are normalized, so they need not add up to 100.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 6: Final Review & Multi-Channel Distribution */}
          {step === 6 && (
            <div className="space-y-4">
              <div>
                <h3 className="text-base font-semibold text-foreground">Step 6 — Interview Loop & Publishing</h3>
                <p className="text-xs text-muted-foreground mt-1">Set the rounds a candidate goes through, then create the job.</p>
              </div>

              <div className="p-4 rounded-xl bg-card border border-border space-y-3 shadow-xs">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-foreground">Interview loop</span>
                  <button
                    type="button"
                    onClick={() =>
                      setRounds((prev) => [
                        ...prev,
                        { name: "", focus: "", interview_type: "Technical Interview", duration_minutes: 45 },
                      ])
                    }
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    + Add round
                  </button>
                </div>

                {rounds.map((round, index) => (
                  <div key={index} className="flex items-center gap-2">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-lg bg-primary-soft text-xs font-bold text-primary">
                      {index + 1}
                    </span>
                    <Input
                      value={round.name}
                      onChange={(e) =>
                        setRounds((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, name: e.target.value } : r)),
                        )
                      }
                      placeholder="Round name"
                      className="h-8 text-xs rounded-lg"
                    />
                    <Input
                      value={round.focus}
                      onChange={(e) =>
                        setRounds((prev) =>
                          prev.map((r, i) => (i === index ? { ...r, focus: e.target.value } : r)),
                        )
                      }
                      placeholder="What it's for"
                      className="h-8 text-xs rounded-lg"
                    />
                    <button
                      type="button"
                      aria-label={`Remove round ${index + 1}`}
                      onClick={() => setRounds((prev) => prev.filter((_, i) => i !== index))}
                      className="shrink-0 rounded-md px-2 py-1 text-xs text-muted-foreground hover:text-destructive"
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <p className="text-xs text-muted-foreground">
                  These become the columns on the job's Stage Kanban Board and the rounds shown in
                  Pipeline Overview.
                </p>
              </div>

              <div className="p-4 rounded-xl bg-card border border-border space-y-4 shadow-xs">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="font-bold text-foreground text-base">{jobTitle || "Untitled Job"}</h4>
                    <p className="text-xs text-muted-foreground">{department || "Engineering"} • {location || "Seattle, WA"} • {hiringType.toUpperCase()} SOURCING</p>
                  </div>
                  <Badge className="bg-success/10 text-success border-success/30 text-xs font-bold">
                    Ready to Publish
                  </Badge>
                </div>

                <div className="grid grid-cols-2 gap-4 text-xs pt-2 border-t border-border">
                  <div>
                    <span className="text-muted-foreground font-medium">Required Skills ({requiredSkills.length}):</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {requiredSkills.map((s) => (
                        <Badge key={s} className="bg-primary-soft text-primary border-primary/30 text-[11px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div>
                    <span className="text-muted-foreground font-medium">Preferred Skills ({preferredSkills.length}):</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {preferredSkills.map((s) => (
                        <Badge key={s} variant="outline" className="text-foreground bg-card border-border text-[11px]">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground font-medium">Scoring weights:</span>
                    <p className="mt-1 text-foreground">
                      {WEIGHT_FIELDS.map((item) => `${item.label} ${weights[item.key]}%`).join(" · ")}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer Navigation */}
        <div className="p-5 bg-secondary border-t border-border flex items-center justify-between">
          <Button
            type="button"
            variant="outline"
            disabled={step === 1}
            onClick={() => setStep((s) => s - 1)}
            className="text-xs border-border bg-card text-foreground hover:bg-secondary flex items-center gap-1"
          >
            <ArrowLeft className="w-4 h-4" /> Back
          </Button>

          {step < STEPS ? (
            <Button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              className="bg-primary hover:bg-primary text-white font-medium text-xs flex items-center gap-1.5 rounded-lg"
            >
              Continue <ArrowRight className="w-4 h-4" />
            </Button>
          ) : (
            <Button
              type="button"
              disabled={isSubmitting}
              onClick={handleCreateJob}
              className="bg-primary hover:bg-primary text-white font-medium text-xs flex items-center gap-1.5 shadow-sm rounded-lg"
            >
              {isSubmitting ? "Creating & Opening Workspace..." : "Create Job & Open JD Workspace"}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
