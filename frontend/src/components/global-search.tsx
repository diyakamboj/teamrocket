import { useNavigate } from "@tanstack/react-router";
import { Loader2, Search, User, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { Input } from "@/components/ui/input";
import { searchCandidates, type SemanticMatch } from "@/lib/api";
import { cn } from "@/lib/utils";

/** The backend requires at least 2 characters (Query(min_length=2)). */
const MIN_QUERY_LENGTH = 2;
const DEBOUNCE_MS = 250;

/**
 * Global candidate search for the header.
 *
 * Searches by meaning rather than substring -- it runs the same vector query
 * as the semantic search endpoint, so "someone who ran Kubernetes in prod"
 * finds people who never wrote that phrase.
 */
export function GlobalSearch() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SemanticMatch[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Responses can land out of order; only the newest query may write state.
  const latestRequest = useRef(0);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setResults([]);
      setError(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const requestId = ++latestRequest.current;
    const timer = setTimeout(() => {
      searchCandidates(trimmed, { limit: 6, hybrid: true })
        .then((matches) => {
          if (latestRequest.current !== requestId) return;
          setResults(matches);
          setError(null);
          setHighlighted(0);
        })
        .catch((err: unknown) => {
          if (latestRequest.current !== requestId) return;
          setResults([]);
          setError(err instanceof Error ? err.message : "Search failed");
        })
        .finally(() => {
          if (latestRequest.current === requestId) setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  /**
   * "/" focuses search from anywhere.
   *
   * This used to be ⌘K, which now belongs to the command palette — the
   * convention everywhere else — and having both bound to ⌘K meant one
   * press did two things at once. "/" is the usual second shortcut for
   * focusing a search field, and is ignored while the caret is already in
   * an input so it can still be typed.
   */
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
      const el = document.activeElement as HTMLElement | null;
      const typing =
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el?.isContentEditable;
      if (typing) return;
      event.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Clicking anywhere else dismisses the results.
  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  const goToCandidate = useCallback(
    (match: SemanticMatch) => {
      setOpen(false);
      setQuery("");
      void navigate({ to: "/candidates", search: { focus: match.candidate_id } });
    },
    [navigate],
  );

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!results.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setHighlighted((i) => (i + 1) % results.length);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setHighlighted((i) => (i - 1 + results.length) % results.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const match = results[highlighted];
      if (match) goToCandidate(match);
    }
  }

  const trimmed = query.trim();
  const showPanel =
    open && (loading || error !== null || results.length > 0 || trimmed.length >= MIN_QUERY_LENGTH);

  return (
    <div ref={containerRef} className="relative min-w-0 max-w-md w-full">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      {loading ? (
        <Loader2 className="absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground" />
      ) : query ? (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => {
            setQuery("");
            inputRef.current?.focus();
          }}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : (
        <button
          type="button"
          aria-label="Focus search"
          onClick={() => {
            inputRef.current?.focus();
            setOpen(true);
          }}
          className="absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground sm:block"
        >
          /
        </button>
      )}
      <Input
        ref={inputRef}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        placeholder="Search candidates by skill, role, or experience…"
        className="rounded-lg pl-9 text-xs"
        aria-label="Global Search"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls="global-search-results"
      />

      {showPanel && (
        <div
          id="global-search-results"
          role="listbox"
          className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-border bg-card shadow-lg"
        >
          {error ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">{error}</p>
          ) : results.length > 0 ? (
            <ul className="max-h-80 overflow-y-auto py-1">
              {results.map((match, index) => (
                <li key={match.candidate_id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={index === highlighted}
                    onMouseEnter={() => setHighlighted(index)}
                    onClick={() => goToCandidate(match)}
                    className={cn(
                      "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors",
                      index === highlighted ? "bg-secondary" : "hover:bg-secondary/60",
                    )}
                  >
                    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-secondary">
                      <User className="h-3.5 w-3.5 text-muted-foreground" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-xs font-semibold">{match.name}</span>
                      {match.title && (
                        <span className="block truncate text-xs text-muted-foreground">
                          {match.title}
                        </span>
                      )}
                    </span>
                    {match.similarity !== null && (
                      <span className="shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">
                        {Math.round(Math.max(0, match.similarity) * 100)}%
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          ) : loading ? (
            <p className="px-3 py-3 text-xs text-muted-foreground">Searching…</p>
          ) : (
            <p className="px-3 py-3 text-xs text-muted-foreground">
              No candidates match “{trimmed}”.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
