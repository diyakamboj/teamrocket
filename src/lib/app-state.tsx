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
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  cancelQueuedResumes,
  clearResumes,
  listResumes,
  resolveDuplicateResume,
  retryFailedResumes,
  retryResume,
  uploadResumes,
  type ResumeCounts,
  type ResumesSnapshot,
} from "@/lib/api/resumes";
import {
  listCandidates,
  loadDemo,
  type CandidatesSnapshot,
} from "@/lib/api/jobs";
import {
  DEFAULT_WEIGHTS,
  type AzureCapabilities,
  type Candidate,
  type JobRecord,
  type ResumeRecord,
  type ScreeningRun,
  type Weights,
} from "@/lib/types";

const EMPTY_COUNTS: ResumeCounts = {
  total: 0,
  queued: 0,
  processing: 0,
  completed: 0,
  failed: 0,
  duplicate: 0,
  skipped: 0,
};

const EMPTY_RESUMES: ResumeRecord[] = [];

const NO_CAPABILITIES: AzureCapabilities = {
  documentIntelligence: false,
  chat: false,
  embeddings: false,
};

/** Files per upload request — keeps individual POSTs small on big batches. */
const UPLOAD_BATCH = 15;

type Ctx = {
  files: ResumeRecord[];
  counts: ResumeCounts;
  overallProgress: number;
  active: boolean;
  uploading: boolean;
  uploadProgress: { sent: number; total: number } | null;
  capabilities: AzureCapabilities;
  addFiles: (files: File[]) => Promise<void>;
  retry: (id: string) => void;
  retryAllFailed: () => void;
  cancelRemaining: () => void;
  resolveDuplicate: (id: string, action: "skip" | "replace") => void;
  clearAll: () => void;

  job: JobRecord | null;
  run: ScreeningRun | null;
  poolSize: number;
  candidates: Candidate[];
  candidatesLoading: boolean;
  refreshCandidates: () => void;
  loadDemoData: () => Promise<void>;

  weights: Weights;
  setWeights: (w: Weights) => void;
  blindMode: boolean;
  setBlindMode: (v: boolean) => void;
  compareIds: string[];
  toggleCompare: (id: string) => void;
  clearCompare: () => void;
  copilotOpen: boolean;
  setCopilotOpen: (v: boolean) => void;
};

const AppCtx = createContext<Ctx | null>(null);

export function AppStateProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [weights, setWeights] = useState<Weights>(DEFAULT_WEIGHTS);
  const [blindMode, setBlindMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{
    sent: number;
    total: number;
  } | null>(null);
  const wasActive = useRef(false);

  const resumesQuery = useQuery<ResumesSnapshot>({
    queryKey: ["resumes"],
    queryFn: () => listResumes(),
    // Poll while anything is in flight; idle otherwise.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return 2000;
      return data.counts.queued + data.counts.processing > 0 ? 1200 : false;
    },
  });

  const candidatesQuery = useQuery<CandidatesSnapshot>({
    queryKey: ["candidates"],
    queryFn: () => listCandidates(),
    refetchInterval: (query) => (query.state.data?.run?.running ? 1500 : false),
  });

  // Memoised so the context value isn't rebuilt on every render by a fresh `[]`.
  const resumesData = resumesQuery.data;
  const files = useMemo(
    () => resumesData?.resumes ?? EMPTY_RESUMES,
    [resumesData],
  );
  const counts = useMemo(
    () => resumesData?.counts ?? EMPTY_COUNTS,
    [resumesData],
  );
  const capabilities = useMemo(
    () => resumesData?.capabilities ?? NO_CAPABILITIES,
    [resumesData],
  );
  const active = counts.queued + counts.processing > 0;

  const invalidateResumes = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["resumes"] });
  }, [queryClient]);

  const uploadMutation = useMutation({
    mutationFn: async (batch: File[]) => {
      const form = new FormData();
      for (const file of batch) form.append("files", file, file.name);
      return uploadResumes({ data: form });
    },
  });

  const addFiles = useCallback(
    async (incoming: File[]) => {
      if (!incoming.length) return;
      setUploadProgress({ sent: 0, total: incoming.length });

      try {
        for (let i = 0; i < incoming.length; i += UPLOAD_BATCH) {
          const batch = incoming.slice(i, i + UPLOAD_BATCH);
          const snapshot = await uploadMutation.mutateAsync(batch);
          queryClient.setQueryData(["resumes"], snapshot);
          setUploadProgress({
            sent: Math.min(i + batch.length, incoming.length),
            total: incoming.length,
          });
        }
      } catch (error) {
        toast.error("Upload failed", {
          description: error instanceof Error ? error.message : String(error),
        });
      } finally {
        setUploadProgress(null);
        invalidateResumes();
      }
    },
    [invalidateResumes, queryClient, uploadMutation],
  );

  const action = useCallback(
    (fn: () => Promise<unknown>) => {
      void fn()
        .then(invalidateResumes)
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : String(error));
        });
    },
    [invalidateResumes],
  );

  // Announce batch completion once, when the queue drains.
  useEffect(() => {
    if (wasActive.current && !active && counts.total > 0) {
      toast.success(`Batch complete — ${counts.completed} resumes parsed`, {
        description: counts.failed
          ? `${counts.failed} file${counts.failed === 1 ? "" : "s"} failed and can be retried.`
          : undefined,
      });
      void queryClient.invalidateQueries({ queryKey: ["candidates"] });
    }
    wasActive.current = active;
  }, [active, counts.total, counts.completed, counts.failed, queryClient]);

  const overallProgress = counts.total
    ? Math.round(
        ((counts.completed +
          counts.failed +
          counts.duplicate +
          counts.skipped) /
          counts.total) *
          100,
      )
    : 0;

  const value: Ctx = useMemo(
    () => ({
      files,
      counts,
      overallProgress,
      active,
      uploading: uploadProgress !== null,
      uploadProgress,
      capabilities,
      addFiles,
      retry: (id) => action(() => retryResume({ data: { id } })),
      retryAllFailed: () => action(() => retryFailedResumes()),
      cancelRemaining: () => action(() => cancelQueuedResumes()),
      resolveDuplicate: (id, act) =>
        action(() => resolveDuplicateResume({ data: { id, action: act } })),
      clearAll: () =>
        action(async () => {
          await clearResumes();
          setCompareIds([]);
          await queryClient.invalidateQueries({ queryKey: ["candidates"] });
        }),

      job: candidatesQuery.data?.job ?? null,
      run: candidatesQuery.data?.run ?? null,
      poolSize: candidatesQuery.data?.poolSize ?? 0,
      candidates: candidatesQuery.data?.candidates ?? [],
      candidatesLoading: candidatesQuery.isLoading,
      refreshCandidates: () => {
        void queryClient.invalidateQueries({ queryKey: ["candidates"] });
      },
      // Seeds the demo batch server-side, then refreshes everything so the whole
      // app snaps to a populated state. Toast lands on the counts that actually
      // persisted, not assumed ones.
      loadDemoData: async () => {
        try {
          const result = await loadDemo();
          setCompareIds([]);
          await Promise.all([
            queryClient.invalidateQueries({ queryKey: ["candidates"] }),
            queryClient.invalidateQueries({ queryKey: ["resumes"] }),
          ]);
          toast.success(`Demo loaded — ${result.resumes} resumes screened`, {
            description: `Ranked against “${result.jobTitle}” (${result.screened} candidates).`,
          });
        } catch (error) {
          toast.error(
            error instanceof Error ? error.message : "Could not load demo data",
          );
        }
      },

      weights,
      setWeights,
      blindMode,
      setBlindMode,
      compareIds,
      toggleCompare: (id) =>
        setCompareIds((prev) =>
          prev.includes(id)
            ? prev.filter((x) => x !== id)
            : prev.length >= 3
              ? prev
              : [...prev, id],
        ),
      clearCompare: () => setCompareIds([]),
      copilotOpen,
      setCopilotOpen,
    }),
    [
      files,
      counts,
      overallProgress,
      active,
      uploadProgress,
      capabilities,
      addFiles,
      action,
      queryClient,
      candidatesQuery.data,
      candidatesQuery.isLoading,
      weights,
      blindMode,
      compareIds,
      copilotOpen,
    ],
  );

  return <AppCtx.Provider value={value}>{children}</AppCtx.Provider>;
}

export function useAppState() {
  const ctx = useContext(AppCtx);
  if (!ctx) throw new Error("useAppState must be used inside AppStateProvider");
  return ctx;
}
