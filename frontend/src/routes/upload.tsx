import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  Copy,
  FolderUp,
  RotateCw,
  UploadCloud,
} from "lucide-react";
import { useAppState, type UploadStage } from "@/lib/app-state";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/upload")({
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

export function UploadPage() {
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
  } = useAppState();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const [page, setPage] = useState(1);
  const [dragging, setDragging] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  function ingest(list: FileList | null) {
    if (!list) return;
    addFiles(Array.from(list).map((f) => ({ name: f.name, size: f.size })));
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
        )}
      >
        <span className="grid h-14 w-14 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
          <UploadCloud className="h-7 w-7" />
        </span>
        <div>
          <p className="text-lg font-bold">Drop resumes here</p>
          <p className="mt-1 text-sm text-muted-foreground">
            PDF, DOCX or scanned images · up to 500 files per batch
          </p>
        </div>
        <div className="flex flex-wrap justify-center gap-2">
          <Button className="rounded-xl" onClick={() => fileRef.current?.click()}>
            Select files
          </Button>
          <Button
            variant="outline"
            className="rounded-xl"
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
                  {f.stage === "complete" && <CheckCircle2 className="h-5 w-5 text-success" />}
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
