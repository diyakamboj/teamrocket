import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Building2, Check, CheckCircle2, Database, FileText, Info, Loader2, Lock, Moon, Palette, ShieldCheck, Sliders, Sparkles, Sun, Trash2, Upload, User } from "lucide-react";
import { toast } from "sonner";
import { verifySession } from "@/lib/auth";
import { DeleteAccount } from "@/components/delete-account";
import { useTheme } from "@/lib/theme";
import {
  getRecruiterSettings,
  saveRecruiterSettings,
  type CompanyDocCategory,
  type RecruiterSettings,
} from "@/lib/settings";
import {
  deleteCompanyDocument,
  listCompanyDocuments,
  uploadCompanyDocument,
  type CompanyDocument,
  updateMyProfile,
} from "@/lib/api";
import { VectorIndexCard } from "@/components/vector-index-card";
import { useAppState } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Slider } from "@/components/ui/slider";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings & Context — ResumeIQ" },
      {
        name: "description",
        content:
          "Manage your recruiter profile, upload company context documents, and set default scoring weights.",
      },
    ],
  }),
  component: SettingsPage,
});

const DOC_CATEGORIES: { value: CompanyDocCategory; label: string; hint: string }[] = [
  { value: "values", label: "Core values", hint: "What the company rewards" },
  { value: "vision", label: "Vision & mission", hint: "Where the company is going" },
  { value: "culture", label: "Culture", hint: "How teams actually work" },
  { value: "guidelines", label: "Hiring guidelines", hint: "How you assess and hire" },
];

const WEIGHT_FIELDS = [
  { key: "skills", label: "Technical skills" },
  { key: "experience", label: "Role experience" },
  { key: "education", label: "Education" },
  { key: "certifications", label: "Certifications" },
  { key: "projects", label: "Portfolio projects" },
] as const;

const SECTIONS = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "profile", label: "Recruiter identity", icon: User },
  { id: "context", label: "Company context", icon: Building2 },
  { id: "copilot", label: "AI grounding", icon: Bot },
  { id: "scoring", label: "Scoring defaults", icon: Sliders },
] as const;

const ACCEPTED = ".pdf,.docx,.doc,.txt,.md";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SectionCard({
  id,
  eyebrow,
  title,
  description,
  icon: Icon,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  icon: typeof User;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 rounded-2xl border bg-card shadow-sm">
      <header className="flex items-start gap-3 border-b px-6 py-5">
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Icon className="h-4.5 w-4.5" />
        </span>
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wider text-primary">
            {eyebrow}
          </p>
          <h2 className="mt-0.5 text-base font-semibold tracking-tight">{title}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </header>
      <div className="px-6 py-5">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium text-foreground">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function DocumentRow({
  doc,
  onDelete,
}: {
  doc: CompanyDocument;
  onDelete: (id: string) => void;
}) {
  const pending = doc.status === "queued" || doc.status === "processing";
  const category = DOC_CATEGORIES.find((c) => c.value === doc.category);

  return (
    <li className="group flex items-start gap-3 rounded-xl border bg-background p-4 transition-colors hover:border-primary/40">
      <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-secondary text-muted-foreground">
        <FileText className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-sm font-semibold">{doc.filename}</span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-secondary-foreground">
            {category?.label ?? doc.category}
          </span>
          {pending && (
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Extracting…
            </span>
          )}
          {doc.status === "processed" && (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-success dark:text-success">
              <CheckCircle2 className="h-3 w-3" /> Ready for AI
            </span>
          )}
          {doc.status === "failed" && (
            <span className="rounded-full bg-destructive/10 px-2 py-0.5 text-[11px] font-semibold text-destructive">
              Extraction failed
            </span>
          )}
        </div>

        <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">
          {doc.status === "failed"
            ? (doc.error ?? "The document could not be read.")
            : (doc.extracted_summary ?? "Reading the document…")}
        </p>

        <p className="mt-2 text-xs text-muted-foreground/80">
          {formatSize(doc.size_bytes)} · uploaded {new Date(doc.created_at).toLocaleDateString()}
        </p>
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Remove ${doc.filename}`}
        onClick={() => onDelete(doc.id)}
        className="h-8 w-8 shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
      >
        <Trash2 className="h-4 w-4" />
      </Button>
    </li>
  );
}

function SettingsPage() {
  const { theme, toggle } = useTheme();
  const { setWeights } = useAppState();
  const [settings, setSettings] = useState<RecruiterSettings>(getRecruiterSettings);

  // Identity is read from the account, not from browser storage, so it is
  // right for whoever is actually signed in.
  const [identity, setIdentity] = useState({
    name: "",
    email: "",
    department: "",
    role: "",
    authProvider: "password",
  });
  const [identitySaving, setIdentitySaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    verifySession()
      .then((account) => {
        if (cancelled || !account) return;
        setIdentity({
          name: account.name ?? "",
          email: account.email ?? "",
          department: account.department ?? "",
          role: account.role ?? "",
          authProvider: account.authProvider ?? "password",
        });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function saveIdentity() {
    setIdentitySaving(true);
    try {
      const updated = await updateMyProfile({
        name: identity.name,
        department: identity.department,
      });
      setIdentity((prev) => ({ ...prev, name: updated.name, department: updated.department }));
      toast.success("Profile updated");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not update your profile");
    } finally {
      setIdentitySaving(false);
    }
  }
  const [saved, setSaved] = useState(false);
  const [docs, setDocs] = useState<CompanyDocument[]>([]);
  const [docsError, setDocsError] = useState<string | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [category, setCategory] = useState<CompanyDocCategory>("values");
  const [active, setActive] = useState<string>(SECTIONS[0].id);
  const fileRef = useRef<HTMLInputElement>(null);

  const refreshDocs = useCallback(async () => {
    try {
      setDocs(await listCompanyDocuments());
      setDocsError(null);
    } catch (err) {
      setDocsError(err instanceof Error ? err.message : "Could not load documents");
    } finally {
      setLoadingDocs(false);
    }
  }, []);

  useEffect(() => {
    void refreshDocs();
  }, [refreshDocs]);

  // Extraction runs in the background — poll only while something is pending.
  const pendingCount = docs.filter(
    (d) => d.status === "queued" || d.status === "processing",
  ).length;
  useEffect(() => {
    if (pendingCount === 0) return;
    const timer = window.setInterval(() => void refreshDocs(), 1500);
    return () => window.clearInterval(timer);
  }, [pendingCount, refreshDocs]);

  // Highlight the section currently in view.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      },
      { rootMargin: "-96px 0px -60% 0px", threshold: [0.1, 0.5] },
    );
    SECTIONS.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, []);

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    try {
      const doc = await uploadCompanyDocument(file, category);
      setDocs((prev) => [doc, ...prev]);
      toast.success(`Uploaded ${doc.filename} — extracting its content…`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function handleDelete(id: string) {
    const previous = docs;
    setDocs((prev) => prev.filter((d) => d.id !== id));
    try {
      await deleteCompanyDocument(id);
      toast.info("Document deleted.");
    } catch (err) {
      setDocs(previous); // put it back — the server still has it
      toast.error(err instanceof Error ? err.message : "Could not delete the document");
    }
  }

  function handleSave() {
    saveRecruiterSettings(settings);
    setWeights(settings.defaultWeights);
    setSaved(true);
    toast.success("Preferences saved — default scoring weights applied.");
    window.setTimeout(() => setSaved(false), 2400);
  }

  const totalWeight = useMemo(
    () => Object.values(settings.defaultWeights).reduce((a, b) => a + b, 0),
    [settings.defaultWeights],
  );
  const readyDocs = docs.filter((d) => d.status === "processed").length;
  const failedDocs = docs.filter((d) => d.status === "failed").length;

  return (
    <div className="mx-auto max-w-6xl pb-16">
      <header className="sticky top-0 z-20 -mx-4 mb-8 border-b bg-background/85 px-4 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">Settings &amp; context</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Your profile, the company context AI reasons from, and how candidates are scored.
            </p>
          </div>
          <Button onClick={handleSave} className="rounded-xl">
            {saved ? (
              <CheckCircle2 className="mr-2 h-4 w-4" />
            ) : (
              <Sparkles className="mr-2 h-4 w-4" />
            )}
            {saved ? "Saved" : "Save preferences"}
          </Button>
        </div>
      </header>

      <div className="grid gap-8 lg:grid-cols-[200px_minmax(0,1fr)]">
        <nav aria-label="Settings sections" className="hidden lg:block">
          <ul className="sticky top-28 space-y-1">
            {SECTIONS.map(({ id, label, icon: Icon }) => (
              <li key={id}>
                <a
                  href={`#${id}`}
                  aria-current={active === id ? "true" : undefined}
                  className={cn(
                    "flex items-center gap-2.5 rounded-lg px-3 py-2 text-xs font-medium transition-colors",
                    active === id
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <Icon className="h-3.5 w-3.5" />
                  {label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="min-w-0 space-y-6">
          {/* ---------- Recruiter identity ---------- */}
          <SectionCard
            id="appearance"
            eyebrow="Appearance"
            title="Light or dark"
            description="Applies everywhere and is remembered on this device. ⌘K can also switch it."
            icon={Palette}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              {(
                [
                  { id: "light", label: "Light", hint: "Bright, for well-lit rooms", icon: Sun },
                  { id: "dark", label: "Dark", hint: "Dim, easier at night", icon: Moon },
                ] as const
              ).map((option) => {
                const selected = theme === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    onClick={() => {
                      if (!selected) toggle();
                    }}
                    aria-pressed={selected}
                    className={cn(
                      "press-fx flex items-center gap-3 rounded-xl border p-4 text-left transition-colors",
                      selected
                        ? "border-primary bg-primary-soft"
                        : "hover:border-primary/40 hover:bg-secondary/60",
                    )}
                  >
                    <span
                      className={cn(
                        "grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : "bg-secondary text-muted-foreground",
                      )}
                    >
                      <option.icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{option.label}</span>
                      <span className="block text-xs text-muted-foreground">{option.hint}</span>
                    </span>
                    {selected && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
                  </button>
                );
              })}
            </div>
          </SectionCard>

          <SectionCard
            id="profile"
            eyebrow="Profile"
            title="Recruiter identity"
            description="Read from the account you signed in with. Used on interview invitations and decision emails."
            icon={User}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Full name">
                <Input
                  value={identity.name}
                  onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
                  className="rounded-lg"
                />
              </Field>
              <Field
                label="Work email"
                hint="This is your sign-in, and everything you own is filed under it."
              >
                <Input
                  type="email"
                  value={identity.email}
                  readOnly
                  className="rounded-lg bg-secondary/60 text-muted-foreground"
                />
              </Field>
              <Field label="Department">
                <Input
                  value={identity.department}
                  onChange={(e) => setIdentity({ ...identity, department: e.target.value })}
                  className="rounded-lg"
                />
              </Field>
              <Field label="Email signature" hint="Appended to candidate emails you send.">
                <Textarea
                  value={settings.emailSignature}
                  onChange={(e) => setSettings({ ...settings, emailSignature: e.target.value })}
                  rows={3}
                  className="rounded-lg font-mono text-xs"
                />
              </Field>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Button
                size="sm"
                disabled={identitySaving}
                onClick={() => void saveIdentity()}
                className="press rounded-xl text-xs"
              >
                {identitySaving ? "Saving…" : "Save profile"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                Signed in as {identity.email || "—"}
                {identity.role ? ` · ${identity.role}` : ""}
              </span>
            </div>

            <div className="mt-6 border-t border-border pt-5">
              <DeleteAccount email={identity.email} authProvider={identity.authProvider} />
            </div>
          </SectionCard>

          {/* ---------- Company context ---------- */}
          <SectionCard
            id="context"
            eyebrow="Organizational context"
            title="Company vision & culture documents"
            description="Upload vision, values, culture or hiring-guideline documents. Each one is stored, its text extracted, and summarized so AI can answer from how your company actually hires."
            icon={Building2}
          >
            <div className="space-y-5">
              <div className="grid gap-3 sm:grid-cols-4">
                {DOC_CATEGORIES.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => setCategory(c.value)}
                    aria-pressed={category === c.value}
                    className={cn(
                      "rounded-xl border p-3 text-left transition-colors",
                      category === c.value
                        ? "border-primary bg-primary/5"
                        : "hover:border-primary/40",
                    )}
                  >
                    <span className="block text-xs font-semibold">{c.label}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground">{c.hint}</span>
                  </button>
                ))}
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragging(false);
                  void handleUpload(e.dataTransfer.files?.[0]);
                }}
                className={cn(
                  "rounded-xl border-2 border-dashed px-6 py-8 text-center transition-colors",
                  dragging ? "border-primary bg-primary/5" : "border-border",
                )}
              >
                <span className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-secondary text-muted-foreground">
                  {uploading ? (
                    <Loader2 className="h-4.5 w-4.5 animate-spin" />
                  ) : (
                    <Upload className="h-4.5 w-4.5" />
                  )}
                </span>
                <p className="mt-3 text-sm font-medium">
                  {uploading ? "Uploading…" : "Drop a document here"}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Filing under <strong>{DOC_CATEGORIES.find((c) => c.value === category)?.label}</strong>
                  {" · "}PDF, Word, text or Markdown · up to 10MB
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-4 rounded-lg"
                  disabled={uploading}
                  onClick={() => fileRef.current?.click()}
                >
                  Choose a file
                </Button>
                <input
                  ref={fileRef}
                  type="file"
                  accept={ACCEPTED}
                  className="hidden"
                  onChange={(e) => void handleUpload(e.target.files?.[0])}
                />
              </div>

              {loadingDocs ? (
                <p className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading your documents…
                </p>
              ) : docsError ? (
                <p className="rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
                  {docsError}
                </p>
              ) : docs.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-6 text-center text-xs text-muted-foreground">
                  No company documents yet. AI will answer from evaluation data alone.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {docs.map((doc) => (
                    <DocumentRow key={doc.id} doc={doc} onDelete={(id) => void handleDelete(id)} />
                  ))}
                </ul>
              )}

              <div className="flex items-start gap-2.5 rounded-xl border bg-secondary/40 p-3.5">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">How these are handled.</span>{" "}
                  Documents are stored in your own Azure blob container and are readable only by
                  this account — another recruiter cannot list or open them, even with the id. File
                  names are sanitized before storage, only document formats are accepted, and the
                  content is never parsed into candidate records.
                </p>
              </div>
            </div>
          </SectionCard>

          {/* ---------- Copilot grounding ---------- */}
          <SectionCard
            id="copilot"
            eyebrow="AI"
            title="What AI reasons from"
            description="AI answers from your stored evaluation data and the context you upload — never from guesswork. There is no model to choose: answers run on the GPT-5 deployment configured for this environment."
            icon={Bot}
          >
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Model
                  </p>
                  <p className="mt-1 text-sm font-semibold">GPT-5</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Set by the Azure deployment, not per recruiter.
                  </p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Company documents
                  </p>
                  <p className="mt-1 text-sm font-semibold tabular-nums">{readyDocs} in context</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {failedDocs > 0
                      ? `${failedDocs} could not be read.`
                      : pendingCount > 0
                        ? `${pendingCount} still being read.`
                        : "Summaries are attached to every question."}
                  </p>
                </div>
                <div className="rounded-xl border p-4">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    Evidence
                  </p>
                  <p className="mt-1 text-sm font-semibold">Stored verdicts</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Answers cite screening results, not the raw résumé text.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-2.5 rounded-xl border bg-secondary/40 p-3.5">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Blind review is toggled per session on the ranking page, and applies to AI
                  too — names and contact details are withheld from prompts while it is on.
                </p>
              </div>
            </div>
          </SectionCard>

          {/* ---------- Scoring defaults ---------- */}
          <SectionCard
            id="search-index"
            eyebrow="Semantic search"
            title="Vector index"
            description="Which engine answers semantic candidate search, read live rather than asserted."
            icon={Database}
          >
            <VectorIndexCard />
          </SectionCard>

          <SectionCard
            id="scoring"
            eyebrow="Ranking"
            title="Default scoring weights"
            description="Applied to candidate ranking when you save. Still adjustable per session from the ranking page."
            icon={Sliders}
          >
            <div className="space-y-5">
              {WEIGHT_FIELDS.map((item) => (
                <div key={item.key} className="space-y-2">
                  <div className="flex items-center justify-between text-xs">
                    <span className="font-medium">{item.label}</span>
                    <span className="font-semibold tabular-nums text-primary">
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

              <div className="flex items-start gap-2.5 rounded-xl border bg-secondary/40 p-3.5">
                <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Total <strong className="text-foreground tabular-nums">{totalWeight}%</strong> —
                  weights are normalized, so they need not add up to 100.
                </p>
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
