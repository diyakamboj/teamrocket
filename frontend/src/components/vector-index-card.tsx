import { Database, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { getVectorIndexStatus, type VectorIndexStatus } from "@/lib/api";
import { cn } from "@/lib/utils";

/**
 * What is actually serving semantic search, read live from the backend.
 *
 * "Are you really using a vector database?" is a fair question to ask of any
 * product that claims one, and the honest answer is a reading, not a slide.
 * This shows the engine, the embedding model, how many vectors it holds, and
 * whether it is reachable right now — including when it is not, since a
 * silent fallback to the local index is exactly the case worth catching.
 */
export function VectorIndexCard() {
  const [status, setStatus] = useState<VectorIndexStatus | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getVectorIndexStatus()
      .then((s) => !cancelled && setStatus(s))
      .catch(() => !cancelled && setStatus(null))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking the vector index…
      </p>
    );
  }

  if (!status) {
    return <p className="text-xs text-muted-foreground">Could not read the index status.</p>;
  }

  const coverageComplete = status.indexed_for_me >= status.my_candidates;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Database className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-semibold">{status.backend_label}</p>
          <p className="text-xs text-muted-foreground">{status.detail}</p>
        </div>
        <span
          className={cn(
            "ml-auto shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold",
            status.reachable
              ? "bg-success/10 text-success dark:bg-success/15 dark:text-success"
              : "bg-destructive/10 text-destructive",
          )}
        >
          {status.reachable ? "Connected" : "Unreachable"}
        </span>
      </div>

      {/* With two engines, a single "connected" would hide one of them being
          down — and a half-down pair silently returns half the results. */}
      {status.engines.length > 1 && (
        <ul className="grid gap-2 sm:grid-cols-2">
          {status.engines.map((engine) => (
            <li
              key={engine.name}
              className="flex items-center gap-2 rounded-xl border bg-background px-3 py-2"
            >
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  engine.reachable ? "bg-success" : "bg-destructive",
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-semibold">{engine.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {engine.role}
                </span>
              </span>
              <span className="metric shrink-0 text-xs font-bold text-muted-foreground">
                {engine.documents_indexed ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          {
            label: "Vectors stored",
            value: status.documents_indexed === null ? "—" : String(status.documents_indexed),
          },
          { label: "Embedding model", value: status.embedding_model },
          { label: "Dimensions", value: String(status.dimensions) },
          {
            label: "Your candidates indexed",
            value: `${status.indexed_for_me}/${status.my_candidates}`,
          },
        ].map((item) => (
          <div key={item.label} className="rounded-xl border bg-background px-3 py-2.5">
            <dd className="metric truncate text-sm font-bold" title={item.value}>
              {item.value}
            </dd>
            <dt className="mt-0.5 text-[11px] leading-tight text-muted-foreground">{item.label}</dt>
          </div>
        ))}
      </dl>

      {!coverageComplete && (
        <p className="rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning dark:bg-warning/10 dark:text-warning">
          {status.my_candidates - status.indexed_for_me} of your candidates are not in the index
          yet, so semantic search will not return them. They are indexed on upload and backfilled
          at startup.
        </p>
      )}

      {!status.is_external && (
        <p className="text-xs text-muted-foreground">
          Semantic search is running on the built-in index. Set <code>VECTOR_BACKEND</code> to{" "}
          <code>search</code> or <code>qdrant</code> to use a dedicated vector store.
        </p>
      )}
    </div>
  );
}
