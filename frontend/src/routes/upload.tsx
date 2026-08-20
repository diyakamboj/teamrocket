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
import { CreateJobModal } from "@/components/create-job-modal";
import { listJobs, type JobResponse } from "@/lib/api";


export const Route = createFileRoute("/upload")({
  validateSearch: (
    search: Record<string, unknown>,
  ): { job?: string; source?: "internal" | "external" } => ({
    ...(typeof search["job"] === "string" ? { job: search["job"] } : {}),
    ...(search["source"] === "internal" || search["source"] === "external"
      ? { source: search["source"] }
      : {}),
  }),
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
  const { job: jobParam, source: sourceParam } = Route.useSearch();
  const navigate = Route.useNavigate();
  const [job, setJob] = useState<JobResponse | null>(null);
  const [allJobs, setAllJobs] = useState<JobResponse[]>([]);
  //: Role chosen on this page when none came in via ?job=. Empty means the
  //: general pool: those candidates can then be ranked for any role.
  const [chosenJobId, setChosenJobId] = useState<string>("");
  const [intakeSource, setIntakeSource] = useState<"internal" | "external">(
    sourceParam ?? "external",
  );
  const [currentPosition, setCurrentPosition] = useState("");
  const [currentDuties, setCurrentDuties] = useState("");
  const [isCreateJobOpen, setIsCreateJobOpen] = useState(false);
  const targetJobId = jobParam || chosenJobId || null;

  /**
   * Roles that accept this intake.
   *
   * The picker used to list every role, so an employee could be filed
   * against an outside-only opening and an applicant against an internal
   * one — landing them on a board they can never be hired from. A role set
   * to "both" is open to either population and stays in both lists.
   */
  const selectableJobs = useMemo(
    () =>
      allJobs.filter((j) => {
        const mode = (j.sourcing_mode ?? "both").toLowerCase();
        return mode === "both" || mode === intakeSource;
      }),
    [allJobs, intakeSource],
  );

  // Switching intake can strip the chosen role out of the list; leaving the
  // id set would upload against a role no longer shown.
  useEffect(() => {
    if (chosenJobId && !selectableJobs.some((j) => j.id === chosenJobId)) {
      setChosenJobId("");
    }
  }, [selectableJobs, chosenJobId]);

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
    void addFiles(Array.from(list), targetJobId, intakeSource, {
      position: currentPosition.trim() || null,
      duties: currentDuties.trim() || null,
    });
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

      <CreateJobModal
        isOpen={isCreateJobOpen}
        onClose={() => {
          setIsCreateJobOpen(false);
          listJobs()
            .then(setAllJobs)
            .catch(() => undefined);
        }}
      />

      <div className="rounded-2xl border bg-card p-5 shadow-sm">
        <h2 className="text-sm font-bold">Before you upload</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Two things decide where these people end up. Both are set here so nobody lands in the
          wrong pool or on the wrong board.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div>
            <span className="text-xs font-semibold">1 · Who are they?</span>
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
                  <span className="block text-[11px] text-muted-foreground">{option.hint}</span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="upload-job" className="text-xs font-semibold">
              2 · Which role are they for?
            </label>
            {selectableJobs.length === 0 ? (
              // Requiring a role makes this page a dead end on an account
              // with no roles yet: an empty dropdown and disabled buttons,
              // with nothing saying why. Send them where they can fix it.
              <div className="mt-1.5 rounded-xl border border-dashed px-3 py-3">
                <p className="text-xs font-semibold">
                  {allJobs.length === 0
                    ? "You have no roles yet"
                    : `No ${intakeSource} roles yet`}
                </p>
                <p className="mt-1 text-[11px] text-muted-foreground">
                  {allJobs.length === 0
                    ? "Résumés attach to a role, so create one first — it takes a moment and you can come straight back."
                    : intakeSource === "internal"
                      ? "You have roles, but none open to people already at the company. Create an internal one, or switch this upload to external."
                      : "You have roles, but none open to outside applicants. Create an external one, or switch this upload to internal."}
                </p>
                <Button
                  size="sm"
                  className="press mt-2.5 rounded-xl text-xs"
                  onClick={() => setIsCreateJobOpen(true)}
                >
                  {allJobs.length === 0 ? "Create your first role" : `Create an ${intakeSource} role`}
                </Button>
              </div>
            ) : (
              <>
                <select
                  id="upload-job"
                  value={jobParam || chosenJobId}
                  disabled={Boolean(jobParam)}
                  onChange={(e) => setChosenJobId(e.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-xs disabled:opacity-60"
                >
                  <option value="">Choose a role…</option>
                  {selectableJobs.map((j) => (
                    <option key={j.id} value={j.id}>
                      {j.title}
                    </option>
                  ))}
                </select>
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {targetJobId
                    ? "They will appear on this role's board and no other."
                    : "Required — a résumé with no role has nowhere to appear."}
                </p>
              </>
            )}
          </div>
        </div>

        {intakeSource === "internal" && (
          <div className="mt-5 border-t pt-5">
            <span className="text-xs font-semibold">
              3 · What is their position in the company today?
            </span>
            <p className="mt-1 text-[11px] text-muted-foreground">
              A résumé lists where someone has been, not where they are now. This is what a
              hiring manager reads to judge whether the move is a step up or a sideways repeat.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
              <label className="block space-y-1">
                <span className="text-xs font-medium">Current position</span>
                <input
                  value={currentPosition}
                  onChange={(e) => setCurrentPosition(e.target.value)}
                  placeholder="Senior Data Engineer, Payments"
                  className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs"
                />
              </label>

              <label className="block space-y-1">
                <span className="text-xs font-medium">
                  Duties in that role{" "}
                  <span className="font-normal text-muted-foreground">(optional)</span>
                </span>
                <textarea
                  value={currentDuties}
                  onChange={(e) => setCurrentDuties(e.target.value)}
                  rows={3}
                  placeholder="Owns the ingestion pipeline, on-call for the payments data path, mentors two juniors."
                  className="w-full resize-y rounded-xl border border-input bg-background px-3 py-2 text-xs leading-relaxed"
                />
              </label>
            </div>

            <p className="mt-2 text-[11px] text-muted-foreground">
              Applies to every résumé in this batch — upload one person at a time if their
              positions differ.
            </p>
          </div>
        )}
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
                        "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
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
