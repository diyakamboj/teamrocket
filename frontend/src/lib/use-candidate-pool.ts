import { useEffect, useState } from "react";
import { useAppState } from "./app-state";
import { fetchCandidatePool, type Candidate } from "./candidates";

export type CandidatePool = {
  candidates: Candidate[];
  loading: boolean;
  /** Set when the backend could not be reached or returned an error. */
  error: string | null;
};

/**
 * The live candidate pool for the active job, scored by the backend matching
 * engine and stored in the backend document store (Azure Blob).
 *
 * Refetches when the active job changes, when blind mode is toggled (the
 * backend redacts identifying fields server-side), and whenever the upload
 * pipeline reports newly parsed candidates via `poolVersion`.
 */
export function useCandidatePool(): CandidatePool {
  const { activeJobId, blindMode, poolVersion, savedWeights } = useAppState();
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeJobId) return;

    let cancelled = false;
    setLoading(true);
    setError(null);

    // Saved weights, not the live sliders: the server should score on what
    // the recruiter committed to, and re-fetching on every slider drag would
    // be a request per pixel.
    fetchCandidatePool(activeJobId, { blindMode, weights: savedWeights })
      .then((pool) => {
        if (cancelled) return;
        setCandidates(pool);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load candidates");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeJobId, blindMode, poolVersion, savedWeights]);

  return { candidates, loading, error };
}
