import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  getAtsBenchmark,
  getJob,
  getJobPipeline,
  getResumeStatus,
  listJobs,
  uploadResumesToBackend,
  type AtsBenchmark,
  type JobResponse,
} from "@/lib/api";

import { rankCandidates, type Candidate } from "@/lib/candidates";
import { useCandidatePool } from "@/lib/use-candidate-pool";
import { useAppState } from "@/lib/app-state";

/** Stages the backend is still actively working through — mirrors app-state.tsx. */
const IN_FLIGHT_STAGES = ["queued", "uploading", "ocr", "parsing"];

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { CandidateDetailModal } from "@/components/candidate-detail-modal";
import {
  Briefcase,
  Users,
  Search,
  CheckCircle2,
  Sparkles,
  ArrowRight,
  TrendingUp,
  Sliders,
  ShieldAlert,
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
  atsScore: number | null;
  semanticScore: number | null;
  delta: string | null;
  skillsScore: number;
  expScore: number;
  statusBadge: "Top Match" | "Review Required" | "Low Match";
  isBench?: boolean;
  skills: string[];
  stage: string;
};

/** Rows are derived from the backend-scored pool joined with the job's
 * pipeline stages; nothing here is hand-authored. */
function toRow(
  candidate: Candidate,
  stage: string | undefined,
  benchmark: AtsBenchmark | null,
): CandidateRow {
  if (!candidate) {
    return {
      id: "unknown",
      name: "Candidate",
      score: 0,
      atsScore: null,
      semanticScore: null,
      delta: null,
      skillsScore: 0,
      expScore: 0,
      statusBadge: "Low Match",
      isBench: false,
      skills: [],
      stage: "Applied",
    };
  }

  const semantic = benchmark && !isNaN(Number(benchmark.semantic_score)) ? Number(benchmark.semantic_score) : null;
  const keyword = benchmark && !isNaN(Number(benchmark.keyword_score)) ? Number(benchmark.keyword_score) : null;
  const delta = benchmark && !isNaN(Number(benchmark.score_delta)) ? Number(benchmark.score_delta) : null;
  const score = typeof candidate.score === "number" && !isNaN(candidate.score) ? candidate.score : 0;

  return {
    id: candidate.id || "c-id",
    name: candidate.name || "Candidate",
    score,
    atsScore: keyword,
    semanticScore: semantic,
    delta: delta === null ? null : `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%`,
    skillsScore: candidate.categories?.skills ?? 0,
    expScore: candidate.categories?.experience ?? 0,
    statusBadge: score >= 85 ? "Top Match" : score >= 65 ? "Review Required" : "Low Match",
    isBench: candidate.employmentStatus === "bench",
    skills: Array.isArray(candidate.skills) ? candidate.skills : [],
    stage: stage ?? "Applied",
  };
}



function JobWorkspacePage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { refreshPool, setActiveJobId } = useAppState();

  // This workspace is scoped to `jobId` from the URL — keep the shared
  // candidate pool (which ranks against `activeJobId`) pointed at it too.
  useEffect(() => {
    if (jobId) setActiveJobId(jobId);
  }, [jobId, setActiveJobId]);

  const [activeTab, setActiveTab] = useState<"overview" | "candidates" | "jd" | "upload" | "pipeline" | "insights">("candidates");
  const [searchQuery, setSearchQuery] = useState("");
  const [job, setJob] = useState<JobResponse | null>(null);
  const [stages, setStages] = useState<Record<string, string>>({});
  const [benchmarks, setBenchmarks] = useState<Record<string, AtsBenchmark | null>>({});
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showWeightSliders, setShowWeightSliders] = useState(false);
  const [weights, setWeights] = useState({ skills: 35, experience: 25, education: 15, certifications: 10, projects: 15 });
  const [blindMode, setBlindMode] = useState(true);
  const [uploadedFiles, setUploadedFiles] = useState<
    Array<{ name: string; size: string; status: string; color: string }>
  >([]);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const fileList = e.target.files;
    if (!fileList || fileList.length === 0) return;

    const fileArray = Array.from(fileList);
    const newItems = fileArray.map((f) => ({
      name: f.name,
      size: `${(f.size / 1024).toFixed(1)} KB`,
      status: "⟳ Processing OCR & AI Parsing...",
      color: "text-blue-600",
    }));

    setUploadedFiles((prev) => [...newItems, ...prev]);

    try {
      const res = await uploadResumesToBackend(fileArray);
      toast.success(`Uploaded ${res.files.length} resume(s) — parsing in the background…`, {
        action: {
          label: "View Candidates",
          onClick: () => setActiveTab("candidates"),
        },
      });

      // Parsing runs as a background job on the server, so the upload
      // response alone doesn't mean a candidate exists yet — poll each
      // file's real status (same approach as the main /upload page) before
      // marking it done and refreshing the candidate pool.
      await Promise.all(
        res.files.map(async (item) => {
          let status = item.status;
          let error = item.error ?? undefined;

          if (!item.duplicate) {
            while (IN_FLIGHT_STAGES.includes(status)) {
              await new Promise((resolve) => window.setTimeout(resolve, 1200));
              try {
                const detail = await getResumeStatus(item.resume_id);
                status = detail.status;
                error = detail.error ?? undefined;
              } catch {
                break;
              }
            }
          }

          const label =
            status === "duplicate"
              ? "⚠ Duplicate — use the main Upload page to replace"
              : status === "complete"
                ? "✓ Parsed & Saved to Candidates Store"
                : status === "failed"
                  ? `✗ ${error || "Parsing failed"}`
                  : "⟳ Processing OCR & AI Parsing...";
          const color =
            status === "complete"
              ? "text-emerald-700"
              : status === "failed"
                ? "text-rose-600"
                : status === "duplicate"
                  ? "text-amber-600"
                  : "text-blue-600";

          setUploadedFiles((prev) =>
            prev.map((row) => (row.name === item.filename ? { ...row, status: label, color } : row)),
          );
        }),
      );

      // Newly parsed candidates are now in the store — refetch the ranked pool.
      refreshPool();
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
        setStages(Object.fromEntries(rows.map((r) => [r.candidate_id, r.stage])));
      })
      .catch(() => {
        if (!cancelled) setStages({});
      });

    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const ranked = useMemo(() => rankCandidates(pool || [], weights), [pool, weights]);

  useEffect(() => {
    const visible = (ranked || []).slice(0, 25);
    if (visible.length === 0) return;
    let cancelled = false;
    void Promise.all(
      visible.map(async (c) => {
        try {
          const bm = await getAtsBenchmark(c.id, jobId);
          return [c.id, bm] as const;
        } catch {
          return [c.id, null] as const;
        }
      }),
    )
      .then((entries) => {
        if (!cancelled) setBenchmarks(Object.fromEntries(entries));
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [ranked, jobId]);

  const candidates = useMemo(() => {
    if (!Array.isArray(ranked)) return [];
    return ranked
      .map((c) => {
        try {
          return toRow(c, stages?.[c.id], benchmarks?.[c.id] ?? null);
        } catch {
          return null;
        }
      })
      .filter((r): r is CandidateRow => r !== null);
  }, [ranked, stages, benchmarks]);

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
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs uppercase font-bold">
              {job?.sourcing_mode === "internal" ? "Internal Hiring" : "External Hiring"}
            </Badge>
            <Badge variant="outline" className="text-slate-600 border-slate-200 bg-white text-xs">
              📍 {(job as any)?.location || "Flexible / Remote"}
            </Badge>
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-bold">
              {job?.status ? job.status.toUpperCase() : "ACTIVE HIRING"}
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-3 mt-1">
            {job ? job.title : "Job Workspace"}
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Central Hiring Workspace • {candidates.length} Candidate{candidates.length === 1 ? "" : "s"} • {topMatchesCount} Top Match{topMatchesCount === 1 ? "" : "es"} • {readyCount} Ready for Review
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setActiveTab("upload")}
            className="border-slate-200 bg-white text-slate-700 hover:bg-slate-50 text-xs flex items-center gap-1.5 shadow-xs"
          >
            <UploadCloud className="w-3.5 h-3.5 text-blue-600" /> Upload Resumes
          </Button>

          {selectedForCompare.length >= 2 && (
            <Button
              onClick={handleLaunchCompare}
              className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-medium flex items-center gap-1.5 shadow-sm rounded-lg"
            >
              <Columns3 className="w-3.5 h-3.5" /> Compare Selected ({selectedForCompare.length}) →
            </Button>
          )}
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-3">
        <div className="flex items-center gap-2">
          {[
            { id: "candidates", label: `Candidates (${candidates.length})` },
            { id: "jd", label: "Original JD & Requirements" },
            { id: "overview", label: "Pipeline Overview" },
            { id: "upload", label: "Bulk Resume Upload" },
            { id: "pipeline", label: "Stage Kanban Board" },
            { id: "insights", label: "JD Insights & Skew Analysis" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-white text-blue-600 border border-slate-200 shadow-xs"
                  : "text-slate-600 hover:text-slate-900 hover:bg-slate-100"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {activeTab === "candidates" && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setBlindMode(!blindMode)}
              className="border-slate-200 bg-white text-slate-700 text-xs flex items-center gap-1 shadow-xs"
            >
              {blindMode ? <EyeOff className="w-3.5 h-3.5 text-amber-600" /> : <Eye className="w-3.5 h-3.5 text-blue-600" />}
              {blindMode ? "Blind Mode ON" : "Blind Mode"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWeightSliders(!showWeightSliders)}
              className="border-slate-200 bg-white text-slate-700 text-xs flex items-center gap-1.5 shadow-xs"
            >
              <Sliders className="w-3.5 h-3.5 text-blue-600" /> Adjust Scoring Weights
            </Button>
          </div>
        )}
      </div>

      {/* WEIGHT SLIDERS DRAWER IF OPEN */}

      {showWeightSliders && (
        <Card className="bg-white border-blue-200 p-5 space-y-4 shadow-sm rounded-xl">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-blue-700 text-xs font-bold">
              <Sliders className="w-4 h-4" /> Adjust Candidate Scoring Category Weights
            </div>
            <Button size="sm" onClick={handleSaveWeights} className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg">
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
                <span className="text-slate-700 font-medium">{item.label}</span>
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

      {/* TAB: ORIGINAL JD & REQUIREMENTS */}
      {activeTab === "jd" && (
        <div className="space-y-6">
          <Card className="bg-white border-slate-200 p-6 space-y-6 rounded-xl shadow-xs">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 pb-4">
              <div>
                <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                  <FileText className="w-4 h-4 text-blue-600" /> Original Job Description & Requirements Spec
                </h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Verbatim text and extracted technical/soft skill criteria powering candidate evaluation.
                </p>
              </div>
              <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-xs px-3 py-1 font-semibold">
                {job?.sourcing_mode === "internal" ? "Internal Bench Workspace" : "External Sourcing Workspace"}
              </Badge>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="md:col-span-2 space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Job Description Text</h4>
                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-800 font-sans leading-relaxed whitespace-pre-wrap max-h-96 overflow-y-auto">
                  {job?.description || "No job description text recorded for this role."}
                </div>
              </div>

              <div className="space-y-5">
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Required Mandatory Skills</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {(job?.required_skills || []).length === 0 ? (
                      <span className="text-xs text-slate-400 italic">None specified</span>
                    ) : (
                      (job?.required_skills || []).map((sk) => (
                        <Badge key={String(sk)} className="bg-blue-50 text-blue-700 border-blue-200 text-xs px-2.5 py-1">
                          ✓ {String(sk)}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">Preferred Nice-to-Have Skills</h4>
                  <div className="flex flex-wrap gap-1.5">
                    {(job?.nice_to_have_skills || []).length === 0 ? (
                      <span className="text-xs text-slate-400 italic">None specified</span>
                    ) : (
                      (job?.nice_to_have_skills || []).map((sk) => (
                        <Badge key={String(sk)} variant="outline" className="bg-white text-slate-700 border-slate-200 text-xs px-2.5 py-1">
                          + {String(sk)}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs">
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Required Experience:</span>
                    <span className="font-bold text-slate-900">{job?.required_experience_years ? `${job.required_experience_years}+ Years` : "Not specified"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Education Requirement:</span>
                    <span className="font-bold text-slate-900">{job?.education_requirements || "Flexible"}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-slate-500 font-medium">Target Location:</span>
                    <span className="font-bold text-slate-900">{(job as any)?.location || "Flexible / Remote"}</span>
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
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <Input
                placeholder="Search candidates by name, skill (Python, Azure)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-white border-slate-200 text-slate-900 text-xs pl-9 focus:border-blue-500 rounded-lg"
              />
            </div>
            <span className="text-xs text-slate-500">
              Showing {filteredCandidates.length} candidate scores sorted by Overall Fit %
            </span>
          </div>

          <div className="rounded-xl border border-slate-200 overflow-hidden bg-white shadow-xs">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase font-semibold">
                  <th className="p-3.5 w-10 text-center">Select</th>
                  <th className="p-3.5">Candidate</th>
                  <th className="p-3.5">AI Fit Score</th>
                  <th className="p-3.5">ATS Score</th>
                  <th className="p-3.5">Delta</th>
                  <th className="p-3.5">Skills</th>
                  <th className="p-3.5">Stage</th>
                  <th className="p-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredCandidates.map((c, i) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 transition-all">
                    <td className="p-3.5 text-center">
                      <input
                        type="checkbox"
                        checked={selectedForCompare.includes(c.id)}
                        onChange={() => toggleCompare(c.id)}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                      />
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() => setSelectedCandidateId(c.id)}
                          className="font-bold text-slate-900 text-sm hover:text-blue-600 cursor-pointer"
                        >
                          {blindMode ? `Candidate #${i + 1}` : c.name}
                        </span>
                        {c.isBench && (
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-bold">
                            👥 Bench
                          </Badge>
                        )}
                        {c.statusBadge === "Review Required" && (
                          <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] flex items-center gap-1 font-bold">
                            <ShieldAlert className="w-3 h-3 text-rose-600" /> Review
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.skills.slice(0, 3).map((sk) => (
                          <span key={sk} className="text-[10px] text-slate-500 font-medium">
                            {sk} •
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span className="font-extrabold text-sm text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">{c.score}%</span>
                    </td>
                    <td className="p-3.5 text-slate-500">{c.atsScore === null ? "—" : `${Math.round(c.atsScore)}%`}</td>
                    <td className="p-3.5 font-semibold text-emerald-600">{c.delta ?? "—"}</td>
                    <td className="p-3.5 text-slate-700 font-mono">{c.skillsScore}%</td>
                    <td className="p-3.5">
                      <Badge variant="outline" className="text-slate-700 bg-slate-50 border-slate-200 text-xs">
                        {c.stage}
                      </Badge>
                    </td>
                    <td className="p-3.5 text-right">
                      <Button
                        size="sm"
                        onClick={() => setSelectedCandidateId(c.id)}
                        className="bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 text-xs font-semibold rounded-lg"
                      >
                        View Profile & Evidence →
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TAB 3: BULK RESUME UPLOAD */}
      {activeTab === "upload" && (
        <Card className="bg-white border-slate-200 p-8 space-y-6 rounded-xl shadow-xs">
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
            className="border-2 border-dashed border-slate-200 rounded-xl p-12 text-center space-y-4 hover:border-blue-400 transition-all cursor-pointer bg-slate-50/50"
          >
            <UploadCloud className="w-10 h-10 text-blue-600 mx-auto" />
            <div>
              <h3 className="text-base font-bold text-slate-900">Drag & drop candidate resumes here</h3>
              <p className="text-xs text-slate-500 mt-1">Supports PDF, DOCX, Scanned Resumes (Automated OCR Parsing)</p>
            </div>
            <Button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                fileInputRef.current?.click();
              }}
              className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg"
            >
              Select PDF Files
            </Button>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
              Processing Status Tracker ({uploadedFiles.length})
            </h4>
            {uploadedFiles.length > 0 ? (
              <div className="space-y-2">
                {uploadedFiles.map((f, idx) => (
                  <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                    <span className="font-mono text-slate-700">{f.name} ({f.size})</span>
                    <span className={`font-semibold ${f.color}`}>{f.status}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-xs text-slate-400 border border-slate-100 rounded-lg bg-slate-50/50">
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
        />
      )}
    </div>

  );
}
