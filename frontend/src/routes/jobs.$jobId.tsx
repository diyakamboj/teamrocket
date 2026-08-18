import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
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
  atsScore: number;
  delta: string;
  skillsScore: number;
  expScore: number;
  statusBadge: "Top Match" | "Review Required" | "Low Match";
  isBench?: boolean;
  fraudWarning?: boolean;
  skills: string[];
  stage: string;
};

const INITIAL_CANDIDATES: CandidateRow[] = [
  {
    id: "cand_1",
    name: "Alex Johnson",
    score: 94,
    atsScore: 79,
    delta: "+15%",
    skillsScore: 96,
    expScore: 91,
    statusBadge: "Top Match",
    skills: ["Python", "Azure", "Kubernetes", "FastAPI"],
    stage: "Interview Round 1",
  },
  {
    id: "cand_2",
    name: "Employee A (David Chen)",
    score: 91,
    atsScore: 82,
    delta: "+9%",
    skillsScore: 94,
    expScore: 88,
    statusBadge: "Top Match",
    isBench: true,
    skills: ["Azure", "Python", "Docker", "Terraform"],
    stage: "Screening",
  },
  {
    id: "cand_3",
    name: "Marcus Vance",
    score: 76,
    atsScore: 68,
    delta: "+8%",
    skillsScore: 72,
    expScore: 80,
    statusBadge: "Review Required",
    fraudWarning: true,
    skills: ["Python", "AWS", "Docker"],
    stage: "Screening",
  },
  {
    id: "cand_4",
    name: "Elena Rostova",
    score: 63,
    atsScore: 60,
    delta: "+3%",
    skillsScore: 61,
    expScore: 65,
    statusBadge: "Low Match",
    skills: ["Java", "Docker"],
    stage: "Applied",
  },
];

function JobWorkspacePage() {
  const { jobId } = Route.useParams();
  const navigate = useNavigate();

  const [activeTab, setActiveTab] = useState<"overview" | "candidates" | "upload" | "pipeline" | "insights">("candidates");
  const [candidates, setCandidates] = useState<CandidateRow[]>(INITIAL_CANDIDATES);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [selectedForCompare, setSelectedForCompare] = useState<string[]>([]);
  const [showWeightSliders, setShowWeightSliders] = useState(false);
  const [weights, setWeights] = useState({ skills: 35, experience: 25, education: 15, certifications: 10, projects: 15 });
  const [blindMode, setBlindMode] = useState(false);

  // Filter candidates
  const filteredCandidates = candidates.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.skills.some((s) => s.toLowerCase().includes(searchQuery.toLowerCase()));
    return matchesSearch;
  });

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
    toast.success("Recalculated 124 candidate scores with updated category weights!");
  };

  return (
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-950 text-slate-100 min-h-screen">
      {/* JD Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800/80 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-xs uppercase">
              External Hiring
            </Badge>
            <Badge variant="outline" className="text-slate-400 border-slate-700 text-xs">
              Seattle, WA (Hybrid)
            </Badge>
            <Badge className="bg-emerald-500/20 text-emerald-300 border-emerald-500/30 text-xs">
              Active Hiring
            </Badge>
          </div>
          <h1 className="text-3xl font-extrabold tracking-tight text-white flex items-center gap-3 mt-1">
            Senior Software Engineer
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Central Hiring Workspace • 124 Candidates • 18 Top Matches • 7 Ready for Interview
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            onClick={() => setActiveTab("upload")}
            className="border-slate-700 text-slate-300 hover:bg-slate-800 text-xs flex items-center gap-1.5"
          >
            <UploadCloud className="w-4 h-4 text-sky-400" /> Upload Resumes
          </Button>

          {selectedForCompare.length >= 2 && (
            <Button
              onClick={handleLaunchCompare}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-lg shadow-indigo-500/20"
            >
              <Columns3 className="w-4 h-4" /> Compare Selected ({selectedForCompare.length}) →
            </Button>
          )}
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <div className="flex items-center gap-3">
          {[
            { id: "candidates", label: "Candidates (124)" },
            { id: "overview", label: "Pipeline Overview" },
            { id: "upload", label: "Bulk Resume Upload" },
            { id: "pipeline", label: "Stage Kanban Board" },
            { id: "insights", label: "JD Insights & Skew Analysis" },
          ].map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold transition-all ${
                activeTab === tab.id
                  ? "bg-sky-500/20 text-sky-300 border border-sky-500/40"
                  : "text-slate-400 hover:text-slate-200 hover:bg-slate-900/60"
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
              className="border-slate-800 text-slate-300 text-xs flex items-center gap-1"
            >
              {blindMode ? <EyeOff className="w-3.5 h-3.5 text-amber-400" /> : <Eye className="w-3.5 h-3.5 text-sky-400" />}
              {blindMode ? "Blind Mode ON" : "Blind Mode"}
            </Button>

            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowWeightSliders(!showWeightSliders)}
              className="border-slate-800 text-slate-300 text-xs flex items-center gap-1.5"
            >
              <Sliders className="w-3.5 h-3.5 text-sky-400" /> Adjust Scoring Weights
            </Button>
          </div>
        )}
      </div>

      {/* WEIGHT SLIDERS DRAWER IF OPEN */}
      {showWeightSliders && (
        <Card className="bg-slate-900 border-sky-500/40 p-6 space-y-4 animate-in fade-in">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sky-400 text-sm font-bold">
              <Sliders className="w-4 h-4" /> Adjust Candidate Scoring Category Weights
            </div>
            <Button size="sm" onClick={handleSaveWeights} className="bg-sky-500 text-slate-950 font-bold text-xs">
              Save & Recalculate All Candidates
            </Button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {[
              { key: "skills", label: "Skills (35%)", val: weights.skills },
              { key: "experience", label: "Experience (25%)", val: weights.experience },
              { key: "education", label: "Education (15%)", val: weights.education },
              { key: "certifications", label: "Certs (10%)", val: weights.certifications },
              { key: "projects", label: "Projects (15%)", val: weights.projects },
            ].map((item) => (
              <div key={item.key} className="space-y-1 text-xs">
                <span className="text-slate-300 font-medium">{item.label}</span>
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

      {/* TAB 2: CANDIDATES SPREADSHEET TABLE */}
      {activeTab === "candidates" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="relative max-w-md w-full">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
              <Input
                placeholder="Search candidates by name, skill (Python, Azure)..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="bg-slate-900 border-slate-800 text-slate-200 text-xs pl-9"
              />
            </div>
            <span className="text-xs text-slate-400">
              Showing {filteredCandidates.length} candidate scores sorted by Overall Fit %
            </span>
          </div>

          <div className="rounded-xl border border-slate-800 overflow-hidden bg-slate-900/80">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-950 border-b border-slate-800 text-slate-400 uppercase font-semibold">
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
              <tbody className="divide-y divide-slate-800/60">
                {filteredCandidates.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-950/60 transition-all">
                    <td className="p-3.5 text-center">
                      <input
                        type="checkbox"
                        checked={selectedForCompare.includes(c.id)}
                        onChange={() => toggleCompare(c.id)}
                        className="rounded border-slate-800 bg-slate-950 text-sky-500"
                      />
                    </td>
                    <td className="p-3.5">
                      <div className="flex items-center gap-2">
                        <span
                          onClick={() => setSelectedCandidateId(c.id)}
                          className="font-bold text-slate-200 text-sm hover:text-sky-400 cursor-pointer"
                        >
                          {blindMode ? `Candidate #${c.id.replace("cand_", "900")}` : c.name}
                        </span>
                        {c.isBench && (
                          <Badge className="bg-sky-500/20 text-sky-300 border-sky-500/30 text-[10px]">
                            👥 Bench
                          </Badge>
                        )}
                        {c.fraudWarning && (
                          <Badge className="bg-rose-500/20 text-rose-300 border-rose-500/30 text-[10px] flex items-center gap-1">
                            <ShieldAlert className="w-3 h-3 text-rose-400" /> ⚠️ Review
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {c.skills.slice(0, 3).map((sk) => (
                          <span key={sk} className="text-[10px] text-slate-500 font-mono">
                            {sk} •
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="p-3.5">
                      <span className="font-extrabold text-sm text-sky-400">{c.score}%</span>
                    </td>
                    <td className="p-3.5 text-slate-400">{c.atsScore}%</td>
                    <td className="p-3.5 font-semibold text-emerald-400">{c.delta}</td>
                    <td className="p-3.5 text-slate-300 font-mono">{c.skillsScore}%</td>
                    <td className="p-3.5">
                      <Badge variant="outline" className="text-slate-300 border-slate-700 text-xs">
                        {c.stage}
                      </Badge>
                    </td>
                    <td className="p-3.5 text-right">
                      <Button
                        size="sm"
                        onClick={() => setSelectedCandidateId(c.id)}
                        className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-300 border border-sky-500/30 text-xs"
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
        <Card className="bg-slate-900/80 border-slate-800 p-8 space-y-6">
          <div className="border-2 border-dashed border-slate-800 rounded-2xl p-12 text-center space-y-4 hover:border-sky-500/50 transition-all cursor-pointer">
            <UploadCloud className="w-12 h-12 text-sky-400 mx-auto" />
            <div>
              <h3 className="text-lg font-bold text-white">Drag & drop candidate resumes here</h3>
              <p className="text-xs text-slate-400 mt-1">Supports PDF, DOCX, Scanned Resumes (Automated OCR Parsing)</p>
            </div>
            <Button className="bg-sky-500 text-slate-950 font-bold text-xs">
              Select PDF Files
            </Button>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-300 uppercase">Processing Status Tracker</h4>
            {[
              { name: "resume_alex_johnson.pdf", status: "✓ Parsed & Scored", color: "text-emerald-400" },
              { name: "resume_david_chen.pdf", status: "✓ Parsed & Scored", color: "text-emerald-400" },
              { name: "resume_marcus_vance.pdf", status: "⟳ Enrichment Processing", color: "text-sky-400" },
              { name: "scanned_doc_4.pdf", status: "⚠️ Timeline Anomaly Detected", color: "text-amber-400" },
            ].map((f, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-slate-950 border border-slate-800/80 flex items-center justify-between text-xs">
                <span className="font-mono text-slate-300">{f.name}</span>
                <span className={`font-semibold ${f.color}`}>{f.status}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* CANDIDATE DETAIL MODAL */}
      {selectedCandidateId && (
        <CandidateDetailModal
          candidateId={selectedCandidateId}
          isOpen={!!selectedCandidateId}
          onClose={() => setSelectedCandidateId(null)}
        />
      )}
    </div>
  );
}
