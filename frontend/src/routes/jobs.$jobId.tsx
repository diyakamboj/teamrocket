import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  JdInsightsTab,
  PipelineOverviewTab,
  StageBoardTab,
} from "@/components/job-workspace-tabs";
import {
  getJob,
  getJobPipeline,
  listJobPipelines,
  type JobPipelineSummary,
  listJobs,
  uploadResumesToBackend,
  type JobResponse,
  type PipelineCandidate,
} from "@/lib/api";

import { rankCandidates, type Candidate } from "@/lib/candidates";
import { useCandidatePool } from "@/lib/use-candidate-pool";
import { useAppState } from "@/lib/app-state";


import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import { CandidateRoleActions } from "@/components/candidate-role-actions";
import { HiringStepsBoard } from "@/components/hiring-steps-board";
import { InternalIntakeDialog, type InternalIntake } from "@/components/internal-intake-dialog";
import { CurrentRoleButton, SourceBadge } from "@/components/source-badge";
import { atsTierLabel, atsToneClass, atsVerdictLabel } from "@/lib/ats-score";
import { cn } from "@/lib/utils";
import {
  Briefcase,
  Users,
  Search,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Sliders,
  UploadCloud,
  Layers,
  Columns3,
  Eye,
  EyeOff,
  PlusCircle,
  FileText,
  AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/jobs/$jobId")({
  component: JobWorkspacePage,
});

type CandidateRow = {
  id: string;
  name: string;
  score: number;
  skillsScore: number;
  expScore: number;
  eduScore: number;
  projectScore: number;
  statusBadge: string;
  isBench?: boolean;
  skills: string[];
  stage: string;
  /** Needed by the row actions: which pool they are in, the role they are
   *  currently attached to, and what they do in the company today. */
  origin?: "internal" | "external";
  employmentStatus?: string | null;
  currentAssignment?: string | null;
  jobId?: string | null;
};

/** Rows are derived from the backend-scored pool joined with the job's
 * pipeline stages; nothing here is hand-authored. */

function toRow(
  candidate: Candidate,
  stage: string | undefined,
): CandidateRow {
  if (!candidate) {
    return {
      id: "unknown",
      name: "Candidate",
      score: 0,
      skillsScore: 0,
      expScore: 0,
      eduScore: 0,
      projectScore: 0,
      statusBadge: "Poor",
      isBench: false,
      skills: [],
      stage: "Reviewed",
    };
  }

  const score = typeof candidate.score === "number" && !isNaN(candidate.score) ? candidate.score : 0;
  const rawStage = stage ?? "screened";

  return {
    id: candidate.id || "c-id",
    name: candidate.name || "Candidate",
    score,
    skillsScore: candidate.categories?.skills ?? 0,
    expScore: candidate.categories?.experience ?? 0,
    eduScore: candidate.categories?.education ?? 0,
    projectScore: candidate.categories?.projects ?? 0,
    statusBadge: atsTierLabel(score),
    isBench: candidate.employmentStatus === "bench",
    skills: Array.isArray(candidate.skills) ? candidate.skills : [],
    stage: rawStage === "screened" ? "Reviewed" : rawStage,
    origin: candidate.origin,
    employmentStatus: candidate.employmentStatus ?? null,
    currentAssignment: candidate.currentAssignment ?? null,
    jobId: candidate.jobId ?? null,
  };
}

function extractLocation(job: JobResponse | null): string {
  if (!job) return "Flexible / Remote";
  const desc = job.description || "";
  const match = desc.match(/(?:location|based in|city|office):\s*([^\n,]+(?:,\s*[^\n]+)?)/i);
  if (match && match[1]) return match[1].trim();
  if (desc.toLowerCase().includes("remote")) return "Remote";
  if (desc.toLowerCase().includes("hybrid")) return "Hybrid / Flexible";
  if (desc.toLowerCase().includes("seattle")) return "Seattle, WA";
  if (desc.toLowerCase().includes("san francisco")) return "San Francisco, CA";
  if (desc.toLowerCase().includes("new york")) return "New York, NY";
  if (desc.toLowerCase().includes("austin")) return "Austin, TX";
  return "Flexible / Remote";
}

function JobWorkspacePage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { setActiveJobId, addFiles, refreshPool, blindMode, setBlindMode } = useAppState();

  // "steps" is the default: it is the view that tells you what to do next,
  // which is what someone running their first hiring loop needs to land on.
  const [activeTab, setActiveTab] = useState<
    "steps" | "candidates" | "jd" | "upload" | "pipeline" | "insights"
  >("steps");
  const [searchQuery, setSearchQuery] = useState("");
  const [job, setJob] = useState<JobResponse | null>(null);
  // Full pipeline rows, keyed by candidate — the board needs the round a
  // candidate sits in, not just their stage.
  const [placements, setPlacements] = useState<Record<string, PipelineCandidate>>({});
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showWeightSliders, setShowWeightSliders] = useState(false);
  const [weights, setWeights] = useState({ skills: 35, experience: 25, education: 15, certifications: 10, projects: 15 });
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ name: string; size: string; status: string; color: string }>
  >([]);
  //: Files held back while we ask what the employee does here today. Only
  //: internal roles ask; external intake uploads straight through.
  const [pendingInternal, setPendingInternal] = useState<File[] | null>(null);

  useEffect(() => {
    if (jobId) setActiveJobId(jobId);
  }, [jobId, setActiveJobId]);

  const isInternalRole = (job?.sourcing_mode ?? "").toLowerCase() === "internal";

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const selected = Array.from(fileList);
    // Clear the input so picking the same file twice still fires a change.
    e.target.value = "";

    if (isInternalRole) {
      setPendingInternal(selected);
      return;
    }
    await uploadFiles(selected, "external");
  };

  const uploadFiles = async (
    fileArray: File[],
    source: "internal" | "external",
    intake?: InternalIntake,
  ) => {
    const newItems = fileArray.map((f) => ({
      name: f.name,
      size: `${(f.size / 1024).toFixed(1)} KB`,
      status: "⟳ Processing OCR & AI Parsing...",
      color: "text-primary",
    }));

    setUploadedFiles((prev) => [...newItems, ...prev]);

    try {
      // Uploading from a job workspace means "these are for this role".
      await addFiles(fileArray, jobId, source, intake ?? undefined);
      refreshPool();
      setUploadedFiles((prev) =>
        prev.map((item) =>
          fileArray.some((f) => f.name === item.name)
            ? { ...item, status: "✓ Parsed & Saved to Candidates Store", color: "text-success" }
            : item
        )
      );
      toast.success(`Uploaded & parsed ${fileArray.length} resume(s) into job candidates database!`, {
        action: {
          label: "View Candidates",
          onClick: () => setActiveTab("candidates"),
        },
      });
    } catch (err: any) {
      toast.error(`Upload error: ${err.message || "Failed to parse resume files"}`);
    }
  };

  const { candidates: pool, loading: poolLoading, error: poolError } = useCandidatePool();

  useEffect(() => {
    let cancelled = false;
    getJob(jobId)
      .then((j: JobResponse) => {
        if (!cancelled && j) setJob(j);
      })
      .catch(() => {
        listJobs()
          .then((jobs: JobResponse[]) => {
            if (!cancelled) {
              const matched = jobs.find((j) => j.id === jobId || (j as any).job_id === jobId) ?? jobs[0] ?? null;
              setJob(matched);
            }
          })
          .catch(() => {
            if (!cancelled) setJob(null);
          });
      });

    getJobPipeline(jobId, "all")
      .then((rows) => {
        if (cancelled) return;
        setPlacements(Object.fromEntries(rows.map((r) => [r.candidate_id, r])));
      })
      .catch(() => {
        if (!cancelled) setPlacements({});
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  useEffect(() => {
    if (!job?.scoring_weights) return;
    setWeights({
      skills: job.scoring_weights.skills,
      experience: job.scoring_weights.experience,
      education: job.scoring_weights.education,
      certifications: job.scoring_weights.certifications,
      projects: job.scoring_weights.projects,
    });
  }, [job?.id, job?.scoring_weights]);

  /** Every role this recruiter owns, so a candidate can be moved to another
   *  one straight from this table. */
  const [editingRounds, setEditingRounds] = useState(false);
  const [allJobs, setAllJobs] = useState<JobPipelineSummary[]>([]);
  useEffect(() => {
    let cancelled = false;
    listJobPipelines()
      .then((rows) => !cancelled && setAllJobs(rows))
      .catch(() => !cancelled && setAllJobs([]));
    return () => {
      cancelled = true;
    };
  }, []);

  /** Re-read what the backend persisted, rather than guessing locally — the
   * board must show the stored placement, not an optimistic one. */
  const refreshPipeline = useCallback(() => {
    void getJobPipeline(jobId, "all")
      .then((rows) => setPlacements(Object.fromEntries(rows.map((r) => [r.candidate_id, r]))))
      .catch(() => undefined);
  }, [jobId]);

  const stages = useMemo(
    () => Object.fromEntries(Object.entries(placements).map(([id, row]) => [id, row.stage])),
    [placements],
  );

  /** Only this job's candidates.
   *
   * `pool` is every candidate the recruiter owns, so ranking it directly
   * put the whole pool on every job's Candidates tab regardless of the role
   * their résumé was uploaded for — the same leak the pipeline was fixed for,
   * still alive in this view. `placements` is the server's own membership
   * list for this job, so it is the authority on who belongs here.
   */
  const ranked = useMemo(() => {
    const members = new Set(Object.keys(placements));
    const mine = (pool || []).filter((c) => members.has(c.id));
    return rankCandidates(mine, weights);
  }, [pool, weights, placements]);

  const boardCandidates = useMemo(
    () =>
      (ranked ?? []).map((c) => ({
        id: c.id,
        name: c.name,
        email: c.email,
        title: c.title,
        score: c.score,
      })),
    [ranked],
  );

  const candidates = useMemo(() => {
    if (!Array.isArray(ranked)) return [];
    return ranked
      .map((c) => {
        try {
          return toRow(c, stages?.[c.id]);
        } catch {
          return null;
        }
      })
      .filter((r): r is CandidateRow => r !== null);
  }, [ranked, stages]);

  // Filter candidates safely
  const filteredCandidates = useMemo(() => {
    const query = (searchQuery || "").toLowerCase();
    return candidates.filter((c) => {
      if (!c) return false;
      const matchesName = (c.name || "").toLowerCase().includes(query);
      const matchesSkills = (c.skills || []).some((s) => typeof s === "string" && s.toLowerCase().includes(query));
      return matchesName || matchesSkills;
    });
  }, [candidates, searchQuery]);

  const toggleCompare = (id: string) => {
    setSelectedForCompare((prev) =>
      prev.includes(id) ? prev.filter((i) => i !== id) : [...prev, id]
    );
  };

  const handleLaunchCompare = () => {
    if (selectedForCompare.length < 2) {
      toast.error("Please select at least 2 candidates to compare.");
      return;
    }
    navigate({ to: "/compare" });
  };

  const handleSaveWeights = () => {
    setShowWeightSliders(false);
    toast.success(`Recalculated ${candidates.length} candidate scores with updated category weights!`);
  };

  const topMatchesCount = useMemo(() => candidates.filter((c) => c.score >= 85).length, [candidates]);
  const readyCount = useMemo(() => candidates.filter((c) => c.score >= 70).length, [candidates]);

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      {/* JD Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge className="bg-primary-soft text-primary border-primary/30 text-xs uppercase font-bold">
              {job?.sourcing_mode === "internal" ? "Internal Hiring" : "External Hiring"}
            </Badge>
            <Badge variant="outline" className="text-muted-foreground border-border bg-card text-xs">
              📍 {extractLocation(job)}
            </Badge>
            <Badge className="bg-success/10 text-success border-success/30 text-xs font-bold">
              {job?.status ? job.status.toUpperCase() : "ACTIVE HIRING"}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-3 mt-1">
            {job ? job.title : "Job Workspace"}
          </h1>
          <p className="text-muted-foreground text-xs mt-1">
            Central Hiring Workspace • {candidates.length} Candidate{candidates.length === 1 ? "" : "s"} • {topMatchesCount} Top Match{topMatchesCount === 1 ? "" : "es"} • {readyCount} Ready for Review
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setActiveTab("upload")}
            className="border-border bg-card text-foreground hover:bg-secondary text-xs flex items-center gap-1.5 shadow-xs"
          >
            <UploadCloud className="w-3.5 h-3.5 text-primary" /> Upload Resumes
          </Button>

          {selectedForCompare.length >= 2 && (
            <Button
              onClick={handleLaunchCompare}
              className="bg-primary hover:bg-primary/90 text-primary-foreground text-xs font-medium flex items-center gap-1.5 shadow-sm rounded-lg"
            >
              <Columns3 className="w-3.5 h-3.5" /> Compare Selected ({selectedForCompare.length}) →
            </Button>
          )}
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b border-border pb-3">
        <div className="flex items-center gap-2">
          {[
            { id: "steps", label: "Hiring steps" },
            { id: "candidates", label: `Candidates (${candidates.length})` },
            { id: "jd", label: "Original JD & Requirements" },
            // Named for what they do, not what they are. "Pipeline
            // Overview" and "Stage Kanban Board" gave no clue which one
            // you move people on.
            { id: "pipeline", label: "Move people (board)" },
            { id: "upload", label: "Bulk Resume Upload" },
            { id: "insights", label: "Job Description Insights" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-card text-primary border border-border shadow-xs"
                  : "text-muted-foreground hover:text-foreground hover:bg-secondary"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          {/* Blind review applies to every view that shows a name, so the
              control belongs on each of them. It used to render only on the
              Candidates tab, which meant switching to a board left names on
              screen with no way to turn masking back on. */}
          {(activeTab === "candidates" ||
            activeTab === "pipeline") && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBlindMode(!blindMode)}
              className="border-border bg-card text-foreground text-xs flex items-center gap-1 shadow-xs"
            >
              {blindMode ? <EyeOff className="w-3.5 h-3.5 text-warning" /> : <Eye className="w-3.5 h-3.5 text-primary" />}
              {blindMode ? "Blind Mode ON" : "Blind Mode"}
            </Button>
          )}

          {activeTab === "candidates" && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWeightSliders(!showWeightSliders)}
              className="border-border bg-card text-foreground text-xs flex items-center gap-1.5 shadow-xs"
            >
              <Sliders className="w-3.5 h-3.5 text-primary" /> Adjust Scoring Weights
            </Button>
          )}
        </div>
      </div>

      {/* WEIGHT SLIDERS DRAWER IF OPEN */}

      {showWeightSliders && (
        <Card className="bg-card border-primary/30 p-5 space-y-4 shadow-sm rounded-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary text-xs font-bold">
              <Sliders className="w-4 h-4" /> Adjust Candidate Scoring Category Weights
            </div>
            <Button size="sm" onClick={handleSaveWeights} className="bg-primary hover:bg-primary text-white font-medium text-xs rounded-lg">
              Save & Recalculate All Candidates
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[
              { key: "skills", label: `Skills (${weights.skills}%)`, val: weights.skills },
              { key: "experience", label: `Experience (${weights.experience}%)`, val: weights.experience },
              { key: "education", label: `Education (${weights.education}%)`, val: weights.education },
              { key: "certifications", label: `Certs (${weights.certifications}%)`, val: weights.certifications },
              { key: "projects", label: `Projects (${weights.projects}%)`, val: weights.projects },
            ].map((item) => (

              <div key={item.key} className="space-y-1 text-xs">
                <span className="text-foreground font-medium">{item.label}</span>
                <Slider
                  min={0}
                  max={50}
                  step={5}
                  value={[item.val]}
                  onValueChange={([v]) => setWeights({ ...weights, [item.key]: v })}
                />
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* TAB: PIPELINE OVERVIEW — the job's interview loop */}
      {activeTab === "steps" && (
        <div className="animate-rise flow-stack">
          <div className="surface-lift edge-glow p-5">
            <h2 className="font-display text-base font-bold">How this works</h2>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Each candidate below has the same checklist. Work down it. The grey box on each
              card names the one thing to do next — you do not need to know the process, and you
              do not need to be technical to send a skills assessment or skip one.
            </p>
          </div>

          <HiringStepsBoard
            jobId={jobId}
            jobTitle={job?.title ?? null}
            onChanged={refreshPipeline}
            onGoto={(tab) => setActiveTab(tab)}
          />
        </div>
      )}

      {activeTab === "pipeline" && (
        <div className="animate-rise flow-stack">
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setEditingRounds((open) => !open)}
              className="press gap-1.5 rounded-xl text-xs"
            >
              <Layers className="h-3.5 w-3.5" />
              {editingRounds ? "Done editing" : "Edit rounds"}
            </Button>
          </div>

          {/* The loop editor used to live on the removed overview tab. It
              belongs with the board it defines the columns of. */}
          {editingRounds && (
            <PipelineOverviewTab
              roundsOnly
              blindMode={blindMode}
              job={job}
              placements={placements}
              candidates={boardCandidates}
              onJobUpdated={setJob}
              onMoved={refreshPipeline}
            />
          )}

          <StageBoardTab
            blindMode={blindMode}
            job={job}
            jobId={jobId}
            placements={placements}
            candidates={boardCandidates}
            onMoved={refreshPipeline}
          />
        </div>
      )}

      {/* TAB: JD INSIGHTS & SKEW ANALYSIS */}
      {activeTab === "insights" && (
        <div className="animate-rise">
          <JdInsightsTab jobId={jobId} />
        </div>
      )}

      {/* TAB: ORIGINAL JD & REQUIREMENTS */}
      {activeTab === "jd" && (
        <div className="space-y-6">
          <Card className="bg-card border-border p-6 space-y-6 rounded-xl shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-border pb-4">
              <div>
                <h3 className="text-base font-bold text-foreground flex items-center gap-2">
                  <FileText className="w-4 h-4 text-primary" /> Original Job Description & Requirements Spec
                </h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Verbatim text and extracted technical/soft skill criteria powering candidate evaluation.
                </p>
              </div>
              <Badge className="bg-primary-soft text-primary border-primary/30 text-xs px-3 py-1 font-semibold">
                {job?.sourcing_mode === "internal" ? "Internal Bench Workspace" : "External Sourcing Workspace"}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-3">
                <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Job Description Text</h4>
                <div className="p-4 rounded-xl bg-secondary border border-border text-xs text-foreground font-sans leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {job?.description || "No job description text recorded for this role."}
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Required Mandatory Skills</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {(job?.required_skills || []).length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">None specified</span>
                    ) : (
                      (job?.required_skills || []).map((sk) => (
                        <Badge key={String(sk)} className="bg-primary-soft text-primary border-primary/30 text-xs px-2.5 py-1">
                          ✓ {String(sk)}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-foreground uppercase tracking-wider">Preferred Nice-to-Have Skills</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {(job?.nice_to_have_skills || []).length === 0 ? (
                      <span className="text-xs text-muted-foreground italic">None specified</span>
                    ) : (
                      (job?.nice_to_have_skills || []).map((sk) => (
                        <Badge key={String(sk)} variant="outline" className="bg-card text-foreground border-border text-xs px-2.5 py-1">
                          + {String(sk)}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-secondary border border-border space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Required Experience:</span>
                    <span className="font-bold text-foreground">{job?.required_experience_years ? `${job.required_experience_years}+ Years` : "Not specified"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Education Requirement:</span>
                    <span className="font-bold text-foreground">{job?.education_requirements || "Flexible"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground font-medium">Target Location:</span>
                    <span className="font-bold text-foreground">{extractLocation(job)}</span>
                  </div>
                </div>
              </div>
            </div>
          </Card>
        </div>
      )}

      {/* TAB 2: CANDIDATES SPREADSHEET TABLE */}
      {activeTab === "candidates" && (

        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
              <Input
                placeholder="Search candidates by name, skill (Python, Azure)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-card border-border text-foreground text-xs pl-9 focus:border-primary rounded-lg"
              />
            </div>
            <span className="text-xs text-muted-foreground">
              Showing {filteredCandidates.length} candidates sorted by ATS score
            </span>
          </div>

          {/* overflow-hidden cropped the Actions column outright. Scrolling
              keeps every control reachable at any width. */}
          <div className="overflow-x-auto rounded-xl border border-border bg-card shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-secondary border-b border-border text-muted-foreground uppercase font-semibold">
                  <th className="p-3.5 w-10 text-center">Select</th>
                  <th className="p-3.5">Candidate</th>
                  <th className="p-3.5">ATS score</th>
                  <th className="p-3.5">Skills</th>
                  <th className="p-3.5">Experience</th>
                  <th className="p-3.5">Education</th>
                  <th className="p-3.5">Stage</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCandidates.map((c, i) => (
                  <tr key={c.id} className="hover:bg-secondary/80 transition-all">
                    <td className="p-3.5 text-center">
                      <input
                        type="checkbox"
                        checked={selectedForCompare.includes(c.id)}
                        onChange={() => toggleCompare(c.id)}
                        className="rounded border-border text-primary focus:ring-ring"
                      />
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() => setSelectedCandidateId(c.id)}
                          className="font-bold text-foreground text-sm hover:text-primary cursor-pointer"
                        >
                          {blindMode ? `Candidate #${i + 1}` : c.name}
                        </span>
                        <SourceBadge
                          source={c.origin ?? null}
                          currentAssignment={c.currentAssignment ?? null}
                          onBench={c.isBench ?? false}
                        />
                        {c.origin === "internal" && (
                          <CurrentRoleButton
                            currentAssignment={c.currentAssignment ?? null}
                            onBench={c.isBench ?? false}
                          />
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.skills.slice(0, 3).map((sk) => (
                          <span key={sk} className="text-[11px] text-muted-foreground font-medium">
                            {sk} •
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <div className="flex flex-col gap-1">
                        <span className="font-extrabold text-base text-primary tabular-nums">
                          {c.score}
                        </span>
                        <div className="flex flex-wrap gap-1">
                          <Badge className={cn("text-[11px] font-bold", atsToneClass(c.score))}>
                            {atsTierLabel(c.score)}
                          </Badge>
                          <Badge variant="outline" className="text-[11px] font-bold">
                            {atsVerdictLabel(c.score)}
                          </Badge>
                        </div>
                      </div>
                    </td>
                    <td className="p-3.5 text-foreground font-mono">{c.skillsScore}</td>
                    <td className="p-3.5 text-foreground font-mono">{c.expScore}</td>
                    <td className="p-3.5 text-foreground font-mono">{c.eduScore}</td>
                    <td className="p-3.5">
                      <Badge variant="outline" className="text-foreground bg-secondary border-border text-xs">
                        {c.stage}
                      </Badge>
                    </td>
                    <td className="p-3.5 text-right">
                      <div className="flex flex-col items-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => setSelectedCandidateId(c.id)}
                        className="press rounded-lg border border-primary/20 bg-primary-soft text-xs font-semibold text-primary-soft-foreground hover:bg-primary/15"
                      >
                        View profile →
                      </Button>

                        {/* Removing someone from the role belongs here, on
                            the role's own candidate list, not only on the
                            global candidates page. */}
                        <CandidateRoleActions
                          candidateId={c.id}
                          candidateName={c.name}
                          currentJobId={c.jobId ?? jobId}
                          source={c.origin ?? null}
                          employmentStatus={c.employmentStatus ?? null}
                          jobs={allJobs}
                          onChanged={() => {
                            refreshPipeline();
                            // The pool is what builds these rows, so the
                            // removed person only disappears once it is
                            // re-read — refreshing placements is not enough.
                            void refreshPool();
                          }}
                          compact
                          className="justify-end"
                        />
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "upload" && (
        <Card className="bg-card border-border p-8 space-y-6 rounded-xl shadow-xs">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept=".pdf,.docx,.txt,.png,.jpg"
            className="hidden"
            onChange={handleFileUpload}
          />
          <div
            onClick={() => fileInputRef.current?.click()}
            className="border-2 border-dashed border-border rounded-xl p-12 text-center space-y-4 hover:border-primary transition-all cursor-pointer bg-secondary/50"
          >
            <UploadCloud className="w-10 h-10 text-primary mx-auto" />
            <div>
              <h3 className="text-base font-bold text-foreground">Drag & drop candidate resumes here</h3>
              <p className="text-xs text-muted-foreground mt-1">Supports PDF, DOCX, Scanned Resumes (Automated OCR Parsing)</p>
            </div>
            <Button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="bg-primary hover:bg-primary text-white font-medium text-xs rounded-lg"
            >
              Select PDF Files
            </Button>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-muted-foreground uppercase tracking-wider">
              Processing Status Tracker ({uploadedFiles.length})
            </h4>
            {uploadedFiles.length > 0 ? (
              <div className="space-y-2">
                {uploadedFiles.map((f, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-secondary border border-border flex items-center justify-between text-xs">
                    <span className="font-mono text-foreground">{f.name} ({f.size})</span>
                    <span className={`font-semibold ${f.color}`}>{f.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-muted-foreground border border-border rounded-lg bg-secondary/50">
                No candidate resumes uploaded to this workspace yet. Click above to select PDF/DOCX files.
              </div>
            )}
          </div>
        </Card>
      )}


      {/* CANDIDATE DETAIL MODAL */}
      {selectedCandidateId && (
        <CandidateDetailModal
          candidateId={selectedCandidateId}
          jobId={jobId}
          isOpen={selectedCandidateId !== null}
          onClose={() => setSelectedCandidateId(null)}
          listScore={boardCandidates.find((c) => c.id === selectedCandidateId)?.score ?? null}
        />
      )}

      {/* Internal intake: asked before the files are sent, so it must not be
          gated on a candidate being selected. */}
      <InternalIntakeDialog
        open={pendingInternal !== null}
        fileCount={pendingInternal?.length ?? 0}
        jobTitle={job?.title ?? "this role"}
        onCancel={() => setPendingInternal(null)}
        onConfirm={(intake) => {
          const batch = pendingInternal ?? [];
          setPendingInternal(null);
          void uploadFiles(batch, "internal", intake);
        }}
      />
    </div>

  );
}
