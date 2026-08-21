import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  ensureActiveJob,
  getBackendHealth,
  getResumeStatus,
  reparseResume,
  uploadResumesToBackend,
  type ResumeDetail,
} from "./api";
import { DEFAULT_WEIGHTS, type Weights } from "./candidates";

//: Persisted scoring weights.
const WEIGHTS_KEY = "resumeiq_weights";

export type UploadStage =
  "queued" | "uploading" | "ocr" | "parsing" | "complete" | "failed" | "duplicate" | "skipped";

const KNOWN_STAGES: UploadStage[] = [
  "queued",
  "uploading",
  "ocr",
  "parsing",
  "complete",
  "failed",
  "duplicate",
  "skipped",
];

/** Stages the backend is still actively working through. */
const IN_FLIGHT: UploadStage[] = ["queued", "uploading", "ocr", "parsing"];

function toStage(status: string): UploadStage {
  return KNOWN_STAGES.includes(status as UploadStage) ? (status as UploadStage) : "queued";
}

export type UploadFile = {
  /** Backend ResumeUpload id — also the polling key. Absent only while the
   * initial multipart POST is still in flight. */
  id: string;
  resumeId?: string | undefined;
  name: string;
  size: number;
  stage: UploadStage;
  progress: number;
  error?: string | undefined;
  duplicateOf?: string | undefined;
  candidateId?: string | undefined;
};

type Ctx = {
  files: UploadFile[];
  /** `jobId` attaches the résumés to a role, so the candidates land on that
   *  job's board and no other. Omitted, they join the general pool. */
  addFiles: (
    files: File[],
    jobId?: string | null,
    source?: "internal" | "external",
    internalRole?: { position?: string | null; duties?: string | null },
  ) => Promise<void>;
  retry: (id: string) => void;
  retryAllFailed: () => void;
  cancelRemaining: () => void;
  resolveDuplicate: (id: string, action: "skip" | "replace") => void;
  clearAll: () => void;
  active: boolean;
  counts: Record<"total" | "queued" | "processing" | "completed" | "failed" | "duplicate", number>;
  overallProgress: number;
  weights: Weights;
  setWeights: (w: Weights) => void;
  /** Persist the current weights so every ATS score on the site uses them. */
  saveWeights: (w: Weights) => void;
  /** What was last persisted — lets the UI show unsaved changes. */
  savedWeights: Weights;
  resetWeights: () => void;
  blindMode: boolean;
  setBlindMode: (v: boolean) => void;
  compareIds: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  backendReady: boolean;
  viewingCandidateId: string | null;
  setViewingCandidateId: (id: string | null) => void;
  viewingJobId: string | null;
  setViewingJobId: (id: string | null) => void;
  /** Bumped whenever the upload pipeline finishes a file, so candidate lists
   * know to refetch the pool rather than polling the API on a timer. */
  poolVersion: number;
  refreshPool: () => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  // Weights decide every ATS score on the site, so they outlive the tab.
  // Held in memory only, they reset on reload and silently disagreed with
  // the scores the backend had already computed.
  const [weights, setWeights] = useState<Weights>(() => {
    try {
      const stored = localStorage.getItem(WEIGHTS_KEY);
      return stored ? { ...DEFAULT_WEIGHTS, ...(JSON.parse(stored) as Weights) } : DEFAULT_WEIGHTS;
    } catch {
      return DEFAULT_WEIGHTS;
    }
  });
  const [savedWeights, setSavedWeights] = useState<Weights>(weights);

  const saveWeights = useCallback((next: Weights) => {
    try {
      localStorage.setItem(WEIGHTS_KEY, JSON.stringify(next));
    } catch {
      // A full or blocked storage quota must not stop the weights applying
      // to this session.
    }
    setSavedWeights(next);
  }, []);
  const [blindMode, setBlindMode] = useState(true);

  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [backendReady, setBackendReady] = useState(false);
  const [viewingCandidateId, setViewingCandidateId] = useState<string | null>(null);
  const [viewingJobId, setViewingJobId] = useState<string | null>(null);
  const [poolVersion, setPoolVersion] = useState(0);
  const wasActive = useRef(false);
  const seq = useRef(0);
  //: Guards the one-time job seeding, so reconnect retries never create a
  //: second job for an account that started with none.
  const seededJob = useRef(false);

  const refreshPool = useCallback(() => setPoolVersion((v) => v + 1), []);

  /**
   * Whether the backend is reachable. The copilot header renders this as
   * "Connected" / "Offline".
   *
   * This used to be a single call on mount with no retry, so one failed
   * request — a backend still starting, a restart, a network blip — pinned
   * the app to "Offline" for the rest of the session even after the backend
   * was fine again, and the only cure was a page reload. It now retries with
   * a backoff and re-checks when the tab is focused or the network returns.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    let attempt = 0;

    const check = () => {
      // Health first: it is a plain read, so retrying it is free. Only once
      // the backend answers do we touch `ensureActiveJob`, which creates a
      // job when the account has none and must not run on every retry.
      getBackendHealth()
        .then(() => (seededJob.current ? null : ensureActiveJob()))
        .then((job) => {
          if (cancelled) return;
          if (job) {
            seededJob.current = true;
            // Only seed the active job; never clobber one the user has since
            // navigated to while this was retrying.
            setActiveJobId((current) => current ?? job.id);
          }
          setBackendReady(true);
          attempt = 0;
        })
        .catch(() => {
          if (cancelled) return;
          setBackendReady(false);
          attempt += 1;
          // 2s, 4s, 8s… capped at 30s, so a backend that comes back up is
          // picked up on its own without hammering it while it is down.
          const delay = Math.min(30_000, 2_000 * 2 ** (attempt - 1));
          timer = window.setTimeout(check, delay);
        });
    };

    check();

    // A tab left open across a backend restart should recover on focus
    // rather than waiting out the backoff.
    const recheck = () => {
      if (cancelled || document.visibilityState !== "visible") return;
      window.clearTimeout(timer);
      attempt = 0;
      check();
    };
    window.addEventListener("online", recheck);
    document.addEventListener("visibilitychange", recheck);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      window.removeEventListener("online", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, []);

  /**
   * Sends the real bytes to the backend, which stores them in blob storage and
   * kicks off OCR + AI parsing. Rows are seeded optimistically so the table
   * appears immediately, then reconciled with the ids the server assigns.
   */
  const addFiles = useCallback(
    async (
      incoming: File[],
      jobId?: string | null,
      source: "internal" | "external" = "external",
      internalRole?: { position?: string | null; duties?: string | null },
    ) => {
    if (incoming.length === 0) return;

    const localIds = incoming.map(() => {
      seq.current += 1;
      return `f-${seq.current}`;
    });

    setFiles((prev) => [
      ...prev,
      ...incoming.map((f, i) => ({
        id: localIds[i]!,
        name: f.name,
        size: f.size,
        stage: "uploading" as UploadStage,
        progress: 5,
      })),
    ]);

    try {
      const res = await uploadResumesToBackend(incoming, jobId, source, internalRole);
      setFiles((prev) =>
        prev.map((row) => {
          const idx = localIds.indexOf(row.id);
          if (idx === -1) return row;
          const item = res.files[idx];
          if (!item) return row;
          return {
            ...row,
            resumeId: item.resume_id,
            stage: item.duplicate ? "duplicate" : toStage(item.status),
            progress: item.progress,
            error: item.error ?? undefined,
            duplicateOf: item.duplicate ? item.filename : undefined,
          };
        }),
      );

      // Refusals are the whole point of the check, so say so out loud rather
      // than leaving a "Duplicate" chip in a list the recruiter may not be
      // looking at.
      for (const item of res.files) {
        if (item.duplicate || item.status === "duplicate") {
          toast.error(`${item.filename} was not added`, {
            description: item.error ?? "That candidate is already in your pool.",
            duration: 8000,
          });
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Upload failed";
      setFiles((prev) =>
        prev.map((row) =>
          localIds.includes(row.id)
            ? { ...row, stage: "failed" as UploadStage, progress: 100, error: message }
            : row,
        ),
      );
      toast.error(`Upload failed: ${message}`);
    }
  }, []);

  /** Polls the backend for files it is still processing. */
  useEffect(() => {
    const pending = files.filter((f) => f.resumeId && IN_FLIGHT.includes(f.stage));
    if (pending.length === 0) return;

    let cancelled = false;
    const timer = window.setInterval(() => {
      void Promise.all(
        pending.map(async (f) => {
          try {
            return { row: f, detail: await getResumeStatus(f.resumeId!) };
          } catch {
            return null;
          }
        }),
      ).then((results) => {
        if (cancelled) return;
        const updates = results.filter(
          (r): r is { row: UploadFile; detail: ResumeDetail } => r !== null,
        );
        if (updates.length === 0) return;
        setFiles((prev) =>
          prev.map((row) => {
            const update = updates.find((u) => u.row.id === row.id);
            if (!update) return row;
            // Only on the transition, so the 1.2s poll does not repeat it.
            if (update.detail.status === "duplicate" && row.stage !== "duplicate") {
              toast.error(`${row.name} was not added`, {
                description:
                  update.detail.error ?? "That candidate is already in your pool.",
                duration: 8000,
              });
            }
            return {
              ...row,
              stage: toStage(update.detail.status),
              progress: update.detail.progress,
              error: update.detail.error ?? undefined,
              candidateId: update.detail.candidate?.id ?? row.candidateId,
            };
          }),
        );
      });
    }, 1200);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [files]);

  const counts = useMemo(() => {
    const c = {
      total: files.length,
      queued: 0,
      processing: 0,
      completed: 0,
      failed: 0,
      duplicate: 0,
    };
    for (const f of files) {
      if (f.stage === "queued") c.queued += 1;
      else if (["uploading", "ocr", "parsing"].includes(f.stage)) c.processing += 1;
      else if (f.stage === "complete") c.completed += 1;
      else if (f.stage === "failed") c.failed += 1;
      else if (f.stage === "duplicate") c.duplicate += 1;
    }
    return c;
  }, [files]);

  const active = counts.queued + counts.processing > 0;
  const overallProgress = counts.total
    ? Math.round(((counts.completed + counts.failed) / counts.total) * 100)
    : 0;

  useEffect(() => {
    if (wasActive.current && !active && counts.total > 0) {
      // Newly parsed candidates are now in the store — let ranked views refetch.
      refreshPool();
      toast.success(`Batch complete — ${counts.completed} resumes parsed`, {
        description: counts.failed
          ? `${counts.failed} files failed and can be retried.`
          : undefined,
        action: {
          label: "View ranked candidates",
          onClick: () => {
            window.location.href = "/candidates";
          },
        },
      });
    }
    wasActive.current = active;
  }, [active, counts.total, counts.completed, counts.failed, refreshPool]);

  const retry = useCallback((id: string) => {
    setFiles((prev) => {
      const row = prev.find((f) => f.id === id);
      if (row?.resumeId) {
        void reparseResume(row.resumeId).catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Retry failed";
          toast.error(`Retry failed: ${message}`);
        });
      }
      return prev.map((f) =>
        f.id === id ? { ...f, stage: "queued" as UploadStage, progress: 0, error: undefined } : f,
      );
    });
  }, []);

  const retryAllFailed = useCallback(() => {
    setFiles((prev) => {
      for (const row of prev) {
        if (row.stage === "failed" && row.resumeId) {
          void reparseResume(row.resumeId).catch(() => undefined);
        }
      }
      return prev.map((f) =>
        f.stage === "failed"
          ? { ...f, stage: "queued" as UploadStage, progress: 0, error: undefined }
          : f,
      );
    });
  }, []);

  const value: Ctx = {
    files,
    addFiles,
    retry,
    retryAllFailed,
    // The backend has no cancel endpoint; this only stops the client from
    // tracking rows it has already handed over, which is why they read
    // "skipped" rather than claiming the server-side work was aborted.
    cancelRemaining: () =>
      setFiles((p) =>
        p.map((f) =>
          IN_FLIGHT.includes(f.stage) ? { ...f, stage: "skipped" as UploadStage } : f,
        ),
      ),
    resolveDuplicate: (id, action) =>
      setFiles((p) => {
        const row = p.find((f) => f.id === id);
        if (action === "replace" && row?.resumeId) {
          void reparseResume(row.resumeId).catch(() => undefined);
        }
        return p.map((f) =>
          f.id === id
            ? action === "skip"
              ? { ...f, stage: "skipped" as UploadStage }
              : { ...f, stage: "queued" as UploadStage, progress: 0, duplicateOf: undefined }
            : f,
        );
      }),
    clearAll: () => setFiles([]),
    active,
    counts,
    overallProgress,
    weights,
    setWeights,
    saveWeights,
    savedWeights,
    resetWeights: () => {
      setWeights(DEFAULT_WEIGHTS);
      saveWeights(DEFAULT_WEIGHTS);
    },
    blindMode,
    setBlindMode,
    compareIds,
    toggleCompare: (id) =>
      setCompareIds((prev) =>
        prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= 3 ? prev : [...prev, id],
      ),
    clearCompare: () => setCompareIds([]),
    activeJobId,
    setActiveJobId,
    backendReady,
    viewingCandidateId,
    setViewingCandidateId,
    viewingJobId,
    setViewingJobId,
    poolVersion,
    refreshPool,
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
