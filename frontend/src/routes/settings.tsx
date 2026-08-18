import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  getRecruiterSettings,
  saveRecruiterSettings,
  type CompanyDocCategory,
  type CompanyDocRef,
  type RecruiterSettings,
} from "@/lib/settings";
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
  Loader2,
  Sparkles,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import {
  getAgentModels,
  getChatAttachment,
  uploadChatAttachment,
  type ChatAttachmentInfo,
  type CopilotModelInfo,
} from "@/lib/api";
import { useAppState } from "@/lib/app-state";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings & Context — ResumeIQ" },
      {
        name: "description",
        content:
          "Manage your recruiter profile, choose the Copilot model, and upload company context documents.",
      },
    ],
  }),
  component: SettingsPage,
});

const DOC_CATEGORIES: { value: CompanyDocCategory; label: string }[] = [
  { value: "values", label: "Core Values" },
  { value: "vision", label: "Vision & Mission" },
  { value: "culture", label: "Engineering Culture" },
  { value: "guidelines", label: "Hiring Guidelines" },
];

const WEIGHT_FIELDS = [
  { key: "skills", label: "Technical Skills" },
  { key: "experience", label: "Role Experience" },
  { key: "education", label: "Education Level" },
  { key: "certifications", label: "Certifications" },
  { key: "projects", label: "Portfolio Projects" },
] as const;

/** A company doc: local category label + its live backend attachment record. */
type CompanyDocView = CompanyDocRef & {
  attachment: ChatAttachmentInfo | null;
  missing?: boolean;
};

function SettingsPage() {
  const { setWeights } = useAppState();
  const [settings, setSettings] = useState<RecruiterSettings>(getRecruiterSettings());
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [docs, setDocs] = useState<CompanyDocView[]>([]);
  const [uploading, setUploading] = useState(false);
  const [newDocCategory, setNewDocCategory] = useState<CompanyDocCategory>("values");
  const [models, setModels] = useState<CopilotModelInfo[]>([]);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // The Copilot model list is server-enforced — never a hardcoded menu here.
  useEffect(() => {
    let cancelled = false;
    getAgentModels()
      .then((res) => {
        if (cancelled) return;
        setModels(res.models);
        setSettings((prev) =>
          res.models.some((m) => m.id === prev.copilotConfig.modelId)
            ? prev
            : {
                ...prev,
                copilotConfig: { ...prev.copilotConfig, modelId: res.default_model_id },
              },
        );
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setModelsError(err instanceof Error ? err.message : "Could not load models");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-hydrate each stored document from the backend so the list reflects real
  // processing status and the AI-extracted summary, not a local placeholder.
  useEffect(() => {
    let cancelled = false;
    const refs = getRecruiterSettings().companyDocs;
    if (refs.length === 0) {
      setDocs([]);
      return;
    }
    void Promise.all(
      refs.map(async (ref) => {
        try {
          return { ...ref, attachment: await getChatAttachment(ref.attachmentId) };
        } catch {
          return { ...ref, attachment: null, missing: true };
        }
      }),
    ).then((rows) => {
      if (!cancelled) setDocs(rows);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Documents are processed in the background — poll until each settles.
  useEffect(() => {
    const pending = docs.filter(
      (d) => d.attachment && (d.attachment.status === "queued" || d.attachment.status === "processing"),
    );
    if (pending.length === 0) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void Promise.all(
        pending.map(async (d) => {
          try {
            return { id: d.attachmentId, attachment: await getChatAttachment(d.attachmentId) };
          } catch {
            return null;
          }
        }),
      ).then((updates) => {
        if (cancelled) return;
        setDocs((prev) =>
          prev.map((row) => {
            const update = updates.find((u) => u?.id === row.attachmentId);
            return update ? { ...row, attachment: update.attachment } : row;
          }),
        );
      });
    }, 1500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [docs]);

  function persist(next: RecruiterSettings) {
    setSettings(next);
    saveRecruiterSettings(next);
  }

  const handleSave = () => {
    saveRecruiterSettings(settings);
    // Default weights are only meaningful if they actually take effect.
    setWeights(settings.defaultWeights);
    setSavedSuccess(true);
    toast.success("Preferences saved — default scoring weights applied.");
    setTimeout(() => setSavedSuccess(false), 2500);
  };

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      // Real upload: the backend stores the file in blob storage and runs
      // text extraction + AI classification over it in the background.
      const attachment = await uploadChatAttachment(file);
      const ref: CompanyDocRef = {
        attachmentId: attachment.id,
        category: newDocCategory,
      };
      persist({ ...settings, companyDocs: [...settings.companyDocs, ref] });
      setDocs((prev) => [...prev, { ...ref, attachment }]);
      toast.success(`Uploaded ${attachment.filename} — extracting context…`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  const handleDeleteDoc = (attachmentId: string) => {
    persist({
      ...settings,
      companyDocs: settings.companyDocs.filter((d) => d.attachmentId !== attachmentId),
    });
    setDocs((prev) => prev.filter((d) => d.attachmentId !== attachmentId));
    toast.info("Company context document removed from this list.");
  };

  const totalWeight = Object.values(settings.defaultWeights).reduce((a, b) => a + b, 0);

  return (
    <div className="mx-auto max-w-6xl space-y-8">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-6">
        <div>
          <div className="mb-1 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
            <SettingsIcon className="h-4 w-4" /> Recruiter Settings &amp; Organizational Context
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
            Settings &amp; Organizational Context
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage your recruiter profile, choose the Copilot model, and upload company
            vision/culture documents.
          </p>
        </div>

        <Button onClick={handleSave} className="rounded-xl">
          {savedSuccess ? (
            <CheckCircle className="mr-2 h-4 w-4" />
          ) : (
            <Sparkles className="mr-2 h-4 w-4" />
          )}
          {savedSuccess ? "Saved!" : "Save preferences"}
        </Button>
      </header>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-8 lg:col-span-2">
          {/* Company context documents */}
          <Card className="card-surface">
            <CardHeader>
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Building2 className="h-4 w-4" /> Company Context &amp; Culture Hub
              </div>
              <CardTitle className="text-xl">Company vision &amp; culture documents</CardTitle>
              <CardDescription className="text-xs">
                Upload company documents (vision, core values, leadership principles, culture
                guidelines). Each file is stored in blob storage and its text is extracted and
                summarized so it can be referenced as Copilot context.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                {docs.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                    No company context documents uploaded yet.
                  </div>
                ) : (
                  docs.map((doc) => {
                    const a = doc.attachment;
                    const processing = a?.status === "queued" || a?.status === "processing";
                    return (
                      <div
                        key={doc.attachmentId}
                        className="flex items-start justify-between gap-4 rounded-lg border border-border bg-secondary/40 p-4 transition-colors hover:border-primary/40"
                      >
                        <div className="flex min-w-0 items-start gap-3">
                          <div className="mt-0.5 rounded-lg border border-primary/20 bg-primary-soft p-2 text-primary-soft-foreground">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-sm font-semibold">
                                {a?.filename ?? "Unavailable document"}
                              </span>
                              <Badge variant="outline" className="text-[10px] uppercase">
                                {doc.category}
                              </Badge>
                              {processing && (
                                <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
                                  <Loader2 className="h-3 w-3 animate-spin" /> Extracting…
                                </span>
                              )}
                              {a?.status === "failed" && (
                                <Badge className="border-destructive/30 bg-destructive/15 text-[10px] text-destructive">
                                  Failed
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {doc.missing
                                ? "This document is no longer available on the server."
                                : (a?.extracted_summary ??
                                  a?.error ??
                                  "Waiting for text extraction…")}
                            </p>
                            {a && (
                              <span className="mt-2 block text-[10px] text-muted-foreground">
                                Uploaded {new Date(a.created_at).toLocaleDateString()} ·{" "}
                                {Math.max(1, Math.round(a.size_bytes / 1024))} KB
                              </span>
                            )}
                          </div>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteDoc(doc.attachmentId)}
                          className="text-muted-foreground hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>

              <div className="space-y-4 rounded-lg border border-border bg-secondary/30 p-4">
                <div className="flex items-center gap-2 text-xs font-semibold">
                  <Upload className="h-4 w-4 text-primary" /> Upload a company context document
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  <div className="md:col-span-2">
                    <input
                      ref={fileRef}
                      type="file"
                      accept=".pdf,.docx,.txt,.png,.jpg"
                      className="block w-full cursor-pointer rounded-md border border-border bg-background text-xs file:mr-3 file:cursor-pointer file:rounded-l-md file:border-0 file:bg-secondary file:px-3 file:py-2 file:text-xs file:font-semibold"
                      onChange={(e) => void handleUpload(e.target.files?.[0])}
                      disabled={uploading}
                    />
                  </div>
                  <select
                    value={newDocCategory}
                    onChange={(e) => setNewDocCategory(e.target.value as CompanyDocCategory)}
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs"
                  >
                    {DOC_CATEGORIES.map((c) => (
                      <option key={c.value} value={c.value}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </div>
                {uploading && (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Uploading to blob storage…
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Copilot model */}
          <Card className="card-surface">
            <CardHeader>
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Bot className="h-4 w-4" /> Recruiter Copilot Intelligence Model
              </div>
              <CardTitle className="text-xl">AI model selection</CardTitle>
              <CardDescription className="text-xs">
                Choose the model powering Recruiter Copilot. The list comes from the server's
                allowlist for your account.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="space-y-3">
                <label className="text-xs font-medium">Default AI model engine</label>
                {modelsError ? (
                  <p className="text-xs text-destructive">
                    Could not load available models: {modelsError}
                  </p>
                ) : models.length === 0 ? (
                  <p className="flex items-center gap-2 text-xs text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading available models…
                  </p>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                    {models.map((m) => {
                      const selected = settings.copilotConfig.modelId === m.id;
                      return (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() =>
                            setSettings({
                              ...settings,
                              copilotConfig: { ...settings.copilotConfig, modelId: m.id },
                            })
                          }
                          className={cn(
                            "rounded-lg border p-3 text-left transition-colors",
                            selected
                              ? "border-primary bg-primary-soft"
                              : "border-border bg-background hover:border-primary/40",
                          )}
                        >
                          <div className="flex items-center justify-between text-xs font-semibold">
                            {m.label}
                            {selected && <CheckCircle className="h-3.5 w-3.5 text-primary" />}
                          </div>
                          <p className="mt-1 text-[11px] text-muted-foreground">{m.description}</p>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex justify-between text-xs">
                    <label className="font-medium">Creativity / temperature</label>
                    <span className="font-mono text-primary">
                      {settings.copilotConfig.temperature}
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={1}
                    step={0.05}
                    value={[settings.copilotConfig.temperature]}
                    onValueChange={([val]) =>
                      setSettings({
                        ...settings,
                        copilotConfig: {
                          ...settings.copilotConfig,
                          temperature: val ?? settings.copilotConfig.temperature,
                        },
                      })
                    }
                  />
                  <span className="text-[10px] text-muted-foreground">
                    Lower values produce stricter, more factual evidence analysis.
                  </span>
                </div>

                <div className="space-y-2">
                  <label className="text-xs font-medium">Reasoning depth</label>
                  <select
                    value={settings.copilotConfig.reasoningEffort}
                    onChange={(e) =>
                      setSettings({
                        ...settings,
                        copilotConfig: {
                          ...settings.copilotConfig,
                          reasoningEffort: e.target
                            .value as RecruiterSettings["copilotConfig"]["reasoningEffort"],
                        },
                      })
                    }
                    className="h-9 w-full rounded-md border border-border bg-background px-3 text-xs"
                  >
                    <option value="low">Low (fast summaries)</option>
                    <option value="medium">Medium (standard analytical rigor)</option>
                    <option value="high">High (exhaustive evidence verification)</option>
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs font-medium">Custom recruiter system instructions</label>
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
                  className="text-xs"
                  placeholder="Additional instructions for Copilot when reviewing candidates…"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right column */}
        <div className="space-y-8">
          <Card className="card-surface">
            <CardHeader>
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <User className="h-4 w-4" /> Profile details
              </div>
              <CardTitle className="text-lg">Recruiter identity</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Full name</label>
                <Input
                  value={settings.recruiterName}
                  onChange={(e) => setSettings({ ...settings, recruiterName: e.target.value })}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Work email</label>
                <Input
                  type="email"
                  value={settings.recruiterEmail}
                  onChange={(e) => setSettings({ ...settings, recruiterEmail: e.target.value })}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Department</label>
                <Input
                  value={settings.department}
                  onChange={(e) => setSettings({ ...settings, department: e.target.value })}
                  className="text-xs"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs font-medium">Email signature for invites</label>
                <Textarea
                  value={settings.emailSignature}
                  onChange={(e) => setSettings({ ...settings, emailSignature: e.target.value })}
                  rows={3}
                  className="font-mono text-xs"
                />
              </div>
            </CardContent>
          </Card>

          <Card className="card-surface">
            <CardHeader>
              <div className="flex items-center gap-2 text-sm font-semibold text-primary">
                <Sliders className="h-4 w-4" /> Default scoring weights
              </div>
              <CardTitle className="text-lg">Default category importance</CardTitle>
              <CardDescription className="text-xs">
                Applied to the candidate ranking when you save. Can still be adjusted per session
                from the ranking page.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              {WEIGHT_FIELDS.map((item) => (
                <div key={item.key} className="space-y-1.5">
                  <div className="flex justify-between text-xs">
                    <span className="font-medium">{item.label}</span>
                    <span className="font-semibold text-primary">
                      {settings.defaultWeights[item.key]}%
                    </span>
                  </div>
                  <Slider
                    min={0}
                    max={50}
                    step={5}
                    value={[settings.defaultWeights[item.key]]}
                    onValueChange={([v]) =>
                      setSettings({
                        ...settings,
                        defaultWeights: {
                          ...settings.defaultWeights,
                          [item.key]: v ?? settings.defaultWeights[item.key],
                        },
                      })
                    }
                  />
                </div>
              ))}

              <div className="flex items-start gap-2 rounded-lg border border-primary/20 bg-primary-soft p-3 text-xs text-primary-soft-foreground">
                <Info className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  Total weight: <strong>{totalWeight}%</strong>
                  {totalWeight !== 100 && " — scores are normalized, so this need not sum to 100."}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
