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
    <div className="p-8 max-w-7xl mx-auto space-y-8 bg-slate-50/50 text-slate-900 min-h-screen">
      {/* JD Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Badge className="bg-indigo-50 text-indigo-700 border-indigo-200 text-xs uppercase font-bold">
              External Hiring
            </Badge>
            <Badge variant="outline" className="text-slate-600 border-slate-200 bg-white text-xs">
              Seattle, WA (Hybrid)
            </Badge>
            <Badge className="bg-emerald-50 text-emerald-700 border-emerald-200 text-xs font-bold">
              Active Hiring
            </Badge>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 flex items-center gap-3 mt-1">
            Senior Software Engineer
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Central Hiring Workspace • 124 Candidates • 18 Top Matches • 7 Ready for Interview
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
            { id: "candidates", label: "Candidates (124)" },
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
              { key: "skills", label: "Skills (35%)", val: weights.skills },
              { key: "experience", label: "Experience (25%)", val: weights.experience },
              { key: "education", label: "Education (15%)", val: weights.education },
              { key: "certifications", label: "Certs (10%)", val: weights.certifications },
              { key: "projects", label: "Projects (15%)", val: weights.projects },
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
                {filteredCandidates.map((c) => (
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
                          {blindMode ? `Candidate #${c.id.replace("cand_", "900")}` : c.name}
                        </span>
                        {c.isBench && (
                          <Badge className="bg-blue-50 text-blue-700 border-blue-200 text-[10px] font-bold">
                            👥 Bench
                          </Badge>
                        )}
                        {c.fraudWarning && (
                          <Badge className="bg-rose-50 text-rose-700 border-rose-200 text-[10px] flex items-center gap-1 font-bold">
                            <ShieldAlert className="w-3 h-3 text-rose-600" /> ⚠️ Review
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
                    <td className="p-3.5 text-slate-500">{c.atsScore}%</td>
                    <td className="p-3.5 font-semibold text-emerald-600">{c.delta}</td>
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
          <div className="border-2 border-dashed border-slate-200 rounded-xl p-12 text-center space-y-4 hover:border-blue-400 transition-all cursor-pointer bg-slate-50/50">
            <UploadCloud className="w-10 h-10 text-blue-600 mx-auto" />
            <div>
              <h3 className="text-base font-bold text-slate-900">Drag & drop candidate resumes here</h3>
              <p className="text-xs text-slate-500 mt-1">Supports PDF, DOCX, Scanned Resumes (Automated OCR Parsing)</p>
            </div>
            <Button className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs rounded-lg">
              Select PDF Files
            </Button>
          </div>

          <div className="space-y-2">
            <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">Processing Status Tracker</h4>
            {[
              { name: "resume_alex_johnson.pdf", status: "✓ Parsed & Scored", color: "text-emerald-700" },
              { name: "resume_david_chen.pdf", status: "✓ Parsed & Scored", color: "text-emerald-700" },
              { name: "resume_marcus_vance.pdf", status: "⟳ Enrichment Processing", color: "text-blue-600" },
              { name: "scanned_doc_4.pdf", status: "⚠️ Timeline Anomaly Detected", color: "text-amber-700" },
            ].map((f, idx) => (
              <div key={idx} className="p-3 rounded-lg bg-slate-50 border border-slate-200 flex items-center justify-between text-xs">
                <span className="font-mono text-slate-700">{f.name}</span>
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
