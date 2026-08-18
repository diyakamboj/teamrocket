import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { getRecruiterSettings, saveRecruiterSettings, RecruiterSettings, CompanyDoc } from "@/lib/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import {
  Settings as SettingsIcon,
  Building2,
  Bot,
  Sliders,
  User,
  Upload,
  FileText,
  Trash2,
  CheckCircle,
  Sparkles,
  Info,
} from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const [settings, setSettings] = useState<RecruiterSettings>(getRecruiterSettings());
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [isUploadingDoc, setIsUploadingDoc] = useState(false);
  const [newDocName, setNewDocName] = useState("");
  const [newDocCategory, setNewDocCategory] = useState<"vision" | "values" | "culture" | "guidelines">("values");

  const handleSave = () => {
    saveRecruiterSettings(settings);
    setSavedSuccess(true);
    toast.success("Recruiter settings and AI Copilot preferences saved!");
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  const handleAddCompanyDoc = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newDocName.trim()) return;

    setIsUploadingDoc(true);
    setTimeout(() => {
      const doc: CompanyDoc = {
        id: `doc_${Date.now()}`,
        filename: newDocName.trim().endsWith(".pdf") ? newDocName.trim() : `${newDocName.trim()}.pdf`,
        uploadedAt: new Date().toISOString().split("T")[0],
        category: newDocCategory,
        summary: `Uploaded company ${newDocCategory} document used for AI cultural alignment and matching.`,
      };

      const updatedDocs = [...settings.companyDocs, doc];
      const updated = { ...settings, companyDocs: updatedDocs };
      setSettings(updated);
      saveRecruiterSettings(updated);
      setNewDocName("");
      setIsUploadingDoc(false);
      toast.success(`Uploaded ${doc.filename} to Company Context Hub!`);
    }, 600);
  };

  const handleDeleteDoc = (docId: string) => {
    const updatedDocs = settings.companyDocs.filter((d) => d.id !== docId);
    const updated = { ...settings, companyDocs: updatedDocs };
    setSettings(updated);
    saveRecruiterSettings(updated);
    toast.info("Company context document removed.");
  };

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-8 bg-slate-50/50 text-slate-900 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 pb-6">
        <div>
          <div className="flex items-center gap-2 text-blue-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <SettingsIcon className="w-4 h-4" /> Recruiter Settings & Organizational Context Hub
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900">
            Settings & Organizational Context
          </h1>
          <p className="text-slate-500 text-xs mt-1">
            Manage recruiter profile, select Copilot LLM engine models, and upload company vision/culture docs.
          </p>
        </div>

        <Button
          onClick={handleSave}
          className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-xs px-4 py-2 rounded-lg shadow-sm"
        >
          {savedSuccess ? <CheckCircle className="w-4 h-4 mr-2" /> : <Sparkles className="w-4 h-4 mr-2" />}
          {savedSuccess ? "Saved!" : "Save Preferences"}
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Left 2 Columns: Main Settings */}
        <div className="lg:col-span-2 space-y-8">
          {/* SECTION 1: Company Context & Culture Documents */}
          <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
            <CardHeader>
              <div className="flex items-center gap-2 text-indigo-400 text-sm font-semibold">
                <Building2 className="w-4 h-4" /> Company Context & Culture Hub
              </div>
              <CardTitle className="text-xl text-white">Company Vision & Culture Documents</CardTitle>
              <CardDescription className="text-slate-400 text-xs">
                Upload one-time company documents (vision, core values, leadership principles, culture guidelines). Once uploaded, AI automatically factors this context into candidate matching, culture fit scoring, and JD optimization.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Document List */}
              <div className="space-y-3">
                {settings.companyDocs.length === 0 ? (
                  <div className="p-6 text-center border border-dashed border-slate-800 rounded-lg text-slate-500 text-xs">
                    No company context documents uploaded yet. Upload a document below to inform AI candidate evaluations.
                  </div>
                ) : (
                  settings.companyDocs.map((doc) => (
                    <div
                      key={doc.id}
                      className="p-4 rounded-lg bg-slate-950/70 border border-slate-800 flex items-start justify-between gap-4 transition-all hover:border-slate-700"
                    >
                      <div className="flex items-start gap-3">
                        <div className="p-2 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-400 mt-0.5">
                          <FileText className="w-5 h-5" />
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200 text-sm">{doc.filename}</span>
                            <Badge className="bg-indigo-500/20 text-indigo-300 border-indigo-500/30 text-[10px] uppercase">
                              {doc.category}
                            </Badge>
                          </div>
                          <p className="text-xs text-slate-400 mt-1">{doc.summary}</p>
                          <span className="text-[10px] text-slate-500 mt-2 block">
                            Uploaded on {doc.uploadedAt} • Active in AI Matching Engine
                          </span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteDoc(doc.id)}
                        className="text-slate-500 hover:text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  ))
                )}
              </div>

              {/* Upload Form */}
              <form onSubmit={handleAddCompanyDoc} className="p-4 rounded-lg bg-slate-950/40 border border-slate-800/80 space-y-4">
                <div className="text-xs font-semibold text-slate-300 flex items-center gap-2">
                  <Upload className="w-4 h-4 text-sky-400" /> Upload New Company Context Document
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="md:col-span-2">
                    <Input
                      placeholder="Document name (e.g. Leadership_Principles_2026.pdf)"
                      value={newDocName}
                      onChange={(e) => setNewDocName(e.target.value)}
                      className="bg-slate-950 border-slate-800 text-slate-200 placeholder:text-slate-600 text-xs"
                    />
                  </div>
                  <div>
                    <select
                      value={newDocCategory}
                      onChange={(e) => setNewDocCategory(e.target.value as any)}
                      className="w-full h-9 px-3 rounded-md bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                    >
                      <option value="values">Core Values</option>
                      <option value="vision">Vision & Mission</option>
                      <option value="culture">Engineering Culture</option>
                      <option value="guidelines">Hiring Guidelines</option>
                    </select>
                  </div>
                </div>
                <Button
                  type="submit"
                  disabled={isUploadingDoc || !newDocName.trim()}
                  className="bg-sky-500/10 hover:bg-sky-500/20 text-sky-400 border border-sky-500/30 text-xs font-medium w-full"
                >
                  {isUploadingDoc ? "Processing Document Context..." : "Upload & Integrate into AI Knowledge Base"}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* SECTION 2: AI Copilot Model Configuration */}
          <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
            <CardHeader>
              <div className="flex items-center gap-2 text-sky-400 text-sm font-semibold">
                <Bot className="w-4 h-4" /> Recruiter Copilot Intelligence Model
              </div>
              <CardTitle className="text-xl text-white">AI Model Selection & Reasoning Configuration</CardTitle>
              <CardDescription className="text-slate-400 text-xs">
                Configure the LLM engine powering Recruiter Copilot, JD optimization, evidence tracing, and L1 screening.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Model Choice */}
              <div className="space-y-3">
                <label className="text-xs font-medium text-slate-300">Default AI Model Engine</label>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  {[
                    { id: "gpt-4o", name: "Azure OpenAI GPT-4o", desc: "Flagship multi-modal reasoning. Best for candidate evaluation & evidence extraction." },
                    { id: "gpt-4o-mini", name: "Azure OpenAI GPT-4o mini", desc: "High speed, low latency model for fast bulk operations." },
                    { id: "gpt-4.1", name: "Azure OpenAI GPT-4.1 Preview", desc: "Deep analytical reasoning for JD optimization & complex candidate comparisons." },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() =>
                        setSettings({
                          ...settings,
                          copilotConfig: { ...settings.copilotConfig, modelId: m.id as any },
                        })
                      }
                      className={`p-3 rounded-lg border text-left transition-all ${
                        settings.copilotConfig.modelId === m.id
                          ? "bg-sky-500/10 border-sky-500 text-white"
                          : "bg-slate-950/60 border-slate-800 text-slate-400 hover:border-slate-700"
                      }`}
                    >
                      <div className="font-semibold text-xs text-slate-200 flex items-center justify-between">
                        {m.name}
                        {settings.copilotConfig.modelId === m.id && <CheckCircle className="w-3.5 h-3.5 text-sky-400" />}
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1">{m.desc}</p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Temperature & Reasoning */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <label className="font-medium text-slate-300">Creativity / Temperature</label>
                    <span className="text-sky-400 font-mono">{settings.copilotConfig.temperature}</span>
                  </div>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[settings.copilotConfig.temperature]}
                    onValueChange={([val]) =>
                      setSettings({
                        ...settings,
                        copilotConfig: { ...settings.copilotConfig, temperature: val },
                      })
                    }
                  />
                  <span className="text-[10px] text-slate-500">Lower values produce strict factual evidence analysis.</span>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium text-slate-300">Reasoning Depth</label>
                  <select
                    value={settings.copilotConfig.reasoningEffort}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        copilotConfig: {
                          ...settings.copilotConfig,
                          reasoningEffort: e.target.value as any,
                        },
                      })
                    }
                    className="w-full h-9 px-3 rounded-md bg-slate-950 border border-slate-800 text-slate-200 text-xs focus:outline-none focus:border-sky-500"
                  >
                    <option value="low">Low (Fast summaries)</option>
                    <option value="medium">Medium (Standard analytical rigor)</option>
                    <option value="high">High (Exhaustive evidence verification)</option>
                  </select>
                </div>
              </div>

              {/* System Prompt Addendum */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-slate-300">Custom Recruiter System Instructions</label>
                <Textarea
                  value={settings.copilotConfig.systemPromptAddendum}
                  onChange={(e) =>
                    setSettings({
                      ...settings,
                      copilotConfig: {
                        ...settings.copilotConfig,
                        systemPromptAddendum: e.target.value,
                      },
                    })
                  }
                  rows={3}
                  className="bg-slate-950 border-slate-800 text-slate-200 text-xs placeholder:text-slate-600 focus:border-sky-500"
                  placeholder="Additional instructions for Copilot when reviewing candidates..."
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Profile & Category Default Weights */}
        <div className="space-y-8">
          {/* Recruiter Profile */}
          <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
            <CardHeader>
              <div className="flex items-center gap-2 text-sky-400 text-sm font-semibold">
                <User className="w-4 h-4" /> Profile Details
              </div>
              <CardTitle className="text-lg text-white">Recruiter Identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Full Name</label>
                <Input
                  value={settings.recruiterName}
                  onChange={(e) => setSettings({ ...settings, recruiterName: e.target.value })}
                  className="bg-slate-950 border-slate-800 text-slate-200 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Work Email</label>
                <Input
                  value={settings.recruiterEmail}
                  onChange={(e) => setSettings({ ...settings, recruiterEmail: e.target.value })}
                  className="bg-slate-950 border-slate-800 text-slate-200 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Department</label>
                <Input
                  value={settings.department}
                  onChange={(e) => setSettings({ ...settings, department: e.target.value })}
                  className="bg-slate-950 border-slate-800 text-slate-200 text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-slate-300">Email Signature for Invites</label>
                <Textarea
                  value={settings.emailSignature}
                  onChange={(e) => setSettings({ ...settings, emailSignature: e.target.value })}
                  rows={3}
                  className="bg-slate-950 border-slate-800 text-slate-200 text-xs font-mono"
                />
              </div>
            </CardContent>
          </Card>

          {/* Default Scoring Category Weights */}
          <Card className="bg-slate-900/80 border-slate-800 shadow-xl">
            <CardHeader>
              <div className="flex items-center gap-2 text-indigo-400 text-sm font-semibold">
                <Sliders className="w-4 h-4" /> Global Default Scoring Weights
              </div>
              <CardTitle className="text-lg text-white">Default Category Importance</CardTitle>
              <CardDescription className="text-slate-400 text-xs">
                Sets default weighting breakdown across newly created jobs. Can be adjusted per-job inside the Candidate Workspace.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {[
                { key: "skills", label: "Technical Skills", val: settings.defaultWeights.skills },
                { key: "experience", label: "Role Experience", val: settings.defaultWeights.experience },
                { key: "education", label: "Education Level", val: settings.defaultWeights.education },
                { key: "certifications", label: "Certifications", val: settings.defaultWeights.certifications },
                { key: "projects", label: "Portfolio Projects", val: settings.defaultWeights.projects },
              ].map((item) => (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-300 font-medium">{item.label}</span>
                    <span className="text-sky-400 font-semibold">{item.val}%</span>
                  </div>
                  <Slider
                    min={0}
                    max={50}
                    step={5}
                    value={[item.val]}
                    onValueChange={([v]) =>
                      setSettings({
                        ...settings,
                        defaultWeights: { ...settings.defaultWeights, [item.key]: v },
                      })
                    }
                  />
                </div>
              ))}

              <div className="p-3 rounded-lg bg-sky-500/10 border border-sky-500/20 text-sky-300 text-xs flex items-start gap-2">
                <Info className="w-4 h-4 text-sky-400 shrink-0 mt-0.5" />
                <span>
                  Total Weight:{" "}
                  <strong>
                    {Object.values(settings.defaultWeights).reduce((a, b) => a + b, 0)}%
                  </strong>
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
