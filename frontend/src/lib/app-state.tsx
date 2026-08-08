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
import { ensureActiveJob } from "./api";
import { DEFAULT_WEIGHTS, type Weights } from "./mock-data";

export type UploadStage =
  "queued" | "uploading" | "ocr" | "parsing" | "complete" | "failed" | "duplicate" | "skipped";

export type UploadFile = {
  id: string;
  name: string;
  size: number;
  stage: UploadStage;
  progress: number;
  error?: string | undefined;
  duplicateOf?: string | undefined;
};

const ERRORS = [
  "Password-protected PDF",
  "OCR confidence below threshold",
  "Corrupted file stream",
  "Unsupported page layout",
];

type Ctx = {
  files: UploadFile[];
  addFiles: (files: { name: string; size: number }[]) => void;
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
  blindMode: boolean;
  setBlindMode: (v: boolean) => void;
  compareIds: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
  activeJobId: string | null;
  setActiveJobId: (id: string | null) => void;
  backendReady: boolean;
};

const AppCtx = createContext<Ctx | null>(null);

const NEXT: Record<string, UploadStage> = {
  queued: "uploading",
  uploading: "ocr",
  ocr: "parsing",
  parsing: "complete",
};

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [blindMode, setBlindMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [backendReady, setBackendReady] = useState(false);
  const wasActive = useRef(false);
  const seq = useRef(0);

  useEffect(() => {
    let cancelled = false;
    ensureActiveJob()
      .then((job) => {
        if (!cancelled) {
          setActiveJobId(job.id);
          setBackendReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setBackendReady(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addFiles = useCallback((incoming: { name: string; size: number }[]) => {
    setFiles((prev) => {
      const seen = new Set(prev.map((f) => f.name.toLowerCase()));
      const next = incoming.map((f) => {
        const dup = seen.has(f.name.toLowerCase());
        seen.add(f.name.toLowerCase());
        seq.current += 1;
        return {
          id: `f-${seq.current}`,
          name: f.name,
          size: f.size,
          stage: (dup ? "duplicate" : "queued") as UploadStage,
          progress: 0,
          duplicateOf: dup ? f.name : undefined,
        };
      });
      return [...prev, ...next];
    });
  }, []);

  // Mock async pipeline: advance a slice of files each tick.
  useEffect(() => {
    const timer = window.setInterval(() => {
      setFiles((prev) => {
        const inFlight = prev.filter((f) =>
          ["uploading", "ocr", "parsing"].includes(f.stage),
        ).length;
        let slots = Math.max(0, 6 - inFlight);
        let changed = false;

        const next = prev.map((f) => {
          if (f.stage === "queued") {
            if (slots > 0) {
              slots -= 1;
              changed = true;
              return { ...f, stage: "uploading" as UploadStage, progress: 15 };
            }
            return f;
          }
          if (["uploading", "ocr", "parsing"].includes(f.stage)) {
            changed = true;
            if (Math.random() < 0.025) {
              return {
                ...f,
                stage: "failed" as UploadStage,
                error: ERRORS[Math.floor(Math.random() * ERRORS.length)]!,
              };
            }
            const stage = NEXT[f.stage]!;
            const progress = stage === "complete" ? 100 : Math.min(95, f.progress + 30);
            return { ...f, stage, progress };
          }
          return f;
        });
        return changed ? next : prev;
      });
    }, 700);
    return () => window.clearInterval(timer);
  }, []);

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
  }, [active, counts.total, counts.completed, counts.failed]);

  const value: Ctx = {
    files,
    addFiles,
    retry: (id) =>
      setFiles((p) =>
        p.map((f) => (f.id === id ? { ...f, stage: "queued", progress: 0, error: undefined } : f)),
      ),
    retryAllFailed: () =>
      setFiles((p) =>
        p.map((f) =>
          f.stage === "failed" ? { ...f, stage: "queued", progress: 0, error: undefined } : f,
        ),
      ),
    cancelRemaining: () =>
      setFiles((p) =>
        p.map((f) =>
          ["queued", "uploading", "ocr", "parsing"].includes(f.stage)
            ? { ...f, stage: "skipped" as UploadStage }
            : f,
        ),
      ),
    resolveDuplicate: (id, action) =>
      setFiles((p) =>
        p.map((f) =>
          f.id === id
            ? action === "skip"
              ? { ...f, stage: "skipped" as UploadStage }
              : { ...f, stage: "queued" as UploadStage, duplicateOf: undefined }
            : f,
        ),
      ),
    clearAll: () => setFiles([]),
    active,
    counts,
    overallProgress,
    weights,
    setWeights,
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
  };

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
