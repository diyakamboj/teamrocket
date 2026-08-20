import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  FolderUp,
  RotateCw,
  UploadCloud,
  X,
} from "lucide-react";
import { useAppState, type UploadStage } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { listJobs, type JobResponse } from "@/lib/api";


export const Route = createFileRoute("/upload")({
  validateSearch: (search: Record<string, unknown>): { job?: string } =>
    typeof search["job"] === "string" ? { job: search["job"] } : {},
  head: () => ({
    meta: [
      { title: "Resume Upload — ResumeIQ" },
      {
        name: "description",
        content:
          "Drop hundreds of PDF resumes at once and watch each file move through OCR and AI parsing with retry and duplicate handling.",
      },
      { property: "og:title", content: "Resume Upload — ResumeIQ" },
      {
        property: "og:description",
        content: "Upload 100+ resumes at once with live OCR and AI parsing status.",
      },
    ],
  }),
  component: UploadPage,
});

const STAGE_LABEL: Record<UploadStage, string> = {
  queued: "Queued",
  uploading: "Uploading",
  ocr: "OCR",
  parsing: "AI Parsing",
  complete: "Complete",
  failed: "Failed",
  duplicate: "Duplicate",
  skipped: "Skipped",
};

const STAGE_CLASS: Record<UploadStage, string> = {
  queued: "bg-secondary text-muted-foreground",
  uploading: "bg-primary-soft text-primary-soft-foreground",
  ocr: "bg-primary-soft text-primary-soft-foreground",
  parsing: "bg-primary-soft text-primary-soft-foreground",
  complete: "bg-success/15 text-success",
  failed: "bg-destructive/15 text-destructive",
  duplicate: "bg-warning/20 text-warning-foreground dark:text-warning",
  skipped: "bg-secondary text-muted-foreground",
};

const FILTERS = ["all", "queued", "processing", "complete", "failed", "duplicate"] as const;
const PAGE_SIZE = 25;

function UploadPage() {

  const {
    files,
    addFiles,
    retry,
    retryAllFailed,
    cancelRemaining,
    resolveDuplicate,
    clearAll,
    counts,
    overallProgress,
    setActiveJobId,
  } = useAppState();
  const { job: jobParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [job, setJob] = useState<JobResponse | null>(null);
  const [allJobs, setAllJobs] = useState<JobResponse[]>([]);
  //: Role chosen on this page when none came in via ?job=. Empty means the
  //: general pool: those candidates can then be ranked for any role.
  const [chosenJobId, setChosenJobId] = useState<string>("");
  const [intakeSource, setIntakeSource] = useState<"internal" | "external">("external");
  const targetJobId = jobParam || chosenJobId || null;

  useEffect(() => {
    let cancelled = false;
    listJobs()
      .then((jobs) => !cancelled && setAllJobs(jobs))
      .catch(() => !cancelled && setAllJobs([]));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!jobParam) {
      setJob(null);
      return;
    }
    setActiveJobId(jobParam);

    let cancelled = false;
    listJobs()
      .then((jobs) => {
        if (!cancelled) setJob(jobs.find((j) => j.id === jobParam) ?? null);
      })
      .catch(() => {
        if (!cancelled) setJob(null);
      });
    return () => {
      cancelled = true;
    };
  }, [jobParam, setActiveJobId]);

  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [page, setPage] = useState(1);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  // addFiles owns the whole round-trip: it POSTs the real bytes to the backend
  // (which stores them in blob storage) and then polls each upload's status as
  // the OCR + AI parsing pipeline advances it.
  function ingest(list: FileList | null) {
    if (!list || list.length === 0) return;
    // The page already knew which role it was uploading for and said so in
    // the banner; it just never told the backend, so every résumé landed in
    // the general pool regardless.
    if (!targetJobId) {
      toast.error("Choose which role these résumés are for first");
      return;
    }
    void addFiles(Array.from(list), targetJobId, intakeSource);
  }

  /** The role must be picked before files can be dropped — a résumé with no
   *  role has nowhere to appear, which is how candidates used to end up
   *  invisible or on every board at once. */
  function readyToUpload() {
    return Boolean(targetJobId);
  }


  const filtered = useMemo(
    () =>
      files.filter((f) => {
        if (filter === "all") return true;
        if (filter === "processing") return ["uploading", "ocr", "parsing"].includes(f.stage);
        return f.stage === filter;
      }),
    [files, filter],
  );

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const current = Math.min(page, pageCount);
  const rows = filtered.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold sm:text-3xl">Resume Upload</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Drop entire folders of PDFs — scanned documents are routed through OCR automatically.
        </p>
      </header>

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-bold">Before you upload</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Two things decide where these people end up. Both are set here so nobody lands in the
          wrong pool or on the wrong board.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="text-[11px] font-semibold">1 · Who are they?</span>
            <div className="mt-1.5 grid grid-cols-2 gap-2">
              {(
                [
                  {
                    value: "external" as const,
                    label: "External applicant",
                    hint: "Applying from outside",
                  },
                  {
                    value: "internal" as const,
                    label: "Internal employee",
                    hint: "Already works here",
                  },
                ]
              ).map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setIntakeSource(option.value)}
                  className={cn(
                    "rounded-xl border px-3 py-2.5 text-left transition-colors",
                    intakeSource === option.value
                      ? "border-primary bg-primary/5 ring-1 ring-primary"
                      : "hover:border-muted-foreground/40",
                  )}
                >
                  <span className="block text-xs font-semibold">{option.label}</span>
                  <span className="block text-[10px] text-muted-foreground">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="upload-job" className="text-[11px] font-semibold">
              2 · Which role are they for?
            </label>
            <select
              id="upload-job"
              value={jobParam || chosenJobId}
              disabled={Boolean(jobParam)}
              onChange={(e) => setChosenJobId(e.target.value)}
              className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs disabled:opacity-60"
            >
              <option value="">Choose a role…</option>
              {allJobs.map((j) => (
                <option key={j.id} value={j.id}>
                  {j.title}
                </option>
              ))}
            </select>
            <p className="mt-1.5 text-[10px] text-muted-foreground">
              {targetJobId
                ? "They will appear on this role's board and no other."
                : "Required — a résumé with no role has nowhere to appear."}
            </p>
          </div>
        </div>
      </div>

      {job && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-primary-soft px-4 py-2.5 text-sm text-primary-soft-foreground">
          <span>
            Uploading resumes for <strong>{job.title}</strong>
          </span>
          <button
            onClick={() => void navigate({ search: {} })}
            className="inline-flex items-center gap-1 text-xs font-semibold underline-offset-2 hover:underline"
          >
            Dismiss <X className="h-3 w-3" />
          </button>
        </div>
      )}

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          ingest(e.dataTransfer.files);
        }}
        className={cn(
          "card-surface flex flex-col items-center justify-center gap-4 border-2 border-dashed px-6 py-14 text-center transition-colors",
          dragging ? "border-primary bg-primary-soft/50" : "border-border",
          !readyToUpload() && "opacity-60",
        )}
      >
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
          <UploadCloud className="h-7 w-7" />
        </span>
        <div>
          <p className="text-lg font-bold">
            {readyToUpload() ? "Drop resumes here" : "Choose a role first"}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {readyToUpload() ? (
              <>
                {intakeSource === "internal" ? "Internal employees" : "External applicants"} for{" "}
                <strong>
                  {allJobs.find((j) => j.id === targetJobId)?.title ?? "the selected role"}
                </strong>{" "}
                · PDF, DOCX or scanned images
              </>
            ) : (
              "Pick who these people are and which role they are for, above."
            )}
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button
            className="rounded-xl"
            disabled={!readyToUpload()}
            onClick={() => fileRef.current?.click()}
          >
            Select files
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
            disabled={!readyToUpload()}
            onClick={() => folderRef.current?.click()}
          >
            <FolderUp className="mr-2 h-4 w-4" /> Select folder
          </Button>
        </div>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.docx,.png,.jpg"
          className="hidden"
          onChange={(e) => ingest(e.target.files)}
        />
        <input
          ref={folderRef}
          type="file"
          multiple
          className="hidden"
          // @ts-expect-error non-standard directory picker attributes
          webkitdirectory=""
          directory=""
          onChange={(e) => ingest(e.target.files)}
        />
      </div>

      {files.length > 0 && (
        <>
          <div className="card-surface p-5">
            <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
              {(
                [
                  ["Total", counts.total],
                  ["Queued", counts.queued],
                  ["Processing", counts.processing],
                  ["Completed", counts.completed],
                  ["Failed", counts.failed],
                  ["Duplicates", counts.duplicate],
                ] as const
              ).map(([label, value]) => (
                <div key={label}>
                  <p className="text-xl font-extrabold tabular-nums">{value}</p>
                  <p className="text-xs text-muted-foreground">{label}</p>
                </div>
              ))}
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={retryAllFailed}
                  disabled={!counts.failed}
                >
                  <RotateCw className="mr-1.5 h-3.5 w-3.5" /> Retry all failed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="rounded-xl"
                  onClick={cancelRemaining}
                  disabled={!counts.queued && !counts.processing}
                >
                  <Ban className="mr-1.5 h-3.5 w-3.5" /> Cancel remaining
                </Button>
                <Button size="sm" variant="ghost" className="rounded-xl" onClick={clearAll}>
                  Clear
                </Button>
              </div>
            </div>
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-500"
                style={{ width: `${overallProgress}%` }}
              />
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              {overallProgress}% of batch resolved
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            {FILTERS.map((f) => (
              <button
                key={f}
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold capitalize transition-colors",
                  filter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary text-muted-foreground hover:text-foreground",
                )}
              >
                {f}
              </button>
            ))}
          </div>

          <div className="card-surface divide-y overflow-hidden">
            {rows.map((f) => (
              <div
                key={f.id}
                className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 px-5 py-3"
              >
                <div className="min-w-0">
                  <div className="flex min-w-0 items-center gap-2">
                    <p className="truncate text-sm font-semibold">{f.name}</p>
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold",
                        STAGE_CLASS[f.stage],
                      )}
                    >
                      {STAGE_LABEL[f.stage]}
                    </span>
                  </div>
                  {f.stage === "failed" ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-destructive">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" /> {f.error}
                    </p>
                  ) : f.stage === "duplicate" ? (
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Copy className="h-3.5 w-3.5 shrink-0" /> Duplicate of an earlier file in this
                      batch
                    </p>
                  ) : (
                    <div className="mt-2 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-primary transition-[width] duration-500"
                        style={{ width: `${f.stage === "complete" ? 100 : f.progress}%` }}
                      />
                    </div>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {f.stage === "failed" && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="rounded-xl"
                      onClick={() => retry(f.id)}
                    >
                      Retry
                    </Button>
                  )}
                  {f.stage === "duplicate" && (
                    <>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="rounded-xl"
                        onClick={() => resolveDuplicate(f.id, "skip")}
                      >
                        Skip
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="rounded-xl"
                        onClick={() => resolveDuplicate(f.id, "replace")}
                      >
                        Replace
                      </Button>
                    </>
                  )}
                  {f.stage === "complete" && (
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="h-5 w-5 text-success" />
                      {f.candidateId && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="rounded-xl text-xs flex items-center gap-1"
                          onClick={() => {
                            const targetId = jobParam || job?.id || (job as any)?.job_id;
                            if (targetId) {
                              void navigate({ to: "/jobs/$jobId", params: { jobId: String(targetId) } });
                            } else {
                              window.location.href = `/candidates?candidate=${f.candidateId}`;
                            }
                          }}
                        >
                          View Candidate →
                        </Button>
                      )}

                    </div>
                  )}

                </div>
              </div>
            ))}
            {rows.length === 0 && (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">
                No files match this filter.
              </p>
            )}
          </div>

          <div className="flex items-center justify-between gap-4">
            <p className="text-xs text-muted-foreground">
              Showing {rows.length} of {filtered.length} files
            </p>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={current === 1}
                onClick={() => setPage(current - 1)}
              >
                Previous
              </Button>
              <span className="text-xs tabular-nums text-muted-foreground">
                {current} / {pageCount}
              </span>
              <Button
                size="sm"
                variant="outline"
                className="rounded-xl"
                disabled={current === pageCount}
                onClick={() => setPage(current + 1)}
              >
                Next
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
