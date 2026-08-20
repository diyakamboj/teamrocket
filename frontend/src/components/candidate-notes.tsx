import { useCallback, useEffect, useState } from "react";
import { Loader2, MessagesSquare, Send } from "lucide-react";
import { toast } from "sonner";
import { addCandidateNote, listCandidateNotes, type CandidateNote } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * The shared note thread on one candidate.
 *
 * Notes hang off the candidate rather than off a conversation, so both
 * recruiters working them see the same thread — this is the difference
 * between messaging someone about a candidate and working the candidate
 * together. Polled while open, like the network page's conversations: a
 * handful of notes, not a chat firehose.
 */
export function CandidateNotes({
  candidateId,
  jobId,
  canWrite = true,
  className,
}: {
  candidateId: string;
  jobId?: string | null | undefined;
  /** False for a read-only share — the thread still shows, the composer does not. */
  canWrite?: boolean | undefined;
  className?: string | undefined;
}) {
  const [notes, setNotes] = useState<CandidateNote[]>([]);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setNotes(await listCandidateNotes(candidateId));
    } catch {
      // A failed poll should not empty a thread the user is reading.
    } finally {
      setLoading(false);
    }
  }, [candidateId]);

  useEffect(() => {
    setLoading(true);
    void refresh();
    const timer = window.setInterval(() => void refresh(), 8000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    try {
      await addCandidateNote(candidateId, body, jobId ?? null);
      setDraft("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Note not saved");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className={cn("rounded-2xl border bg-card", className)}>
      <header className="flex items-center gap-2 border-b px-4 py-3">
        <MessagesSquare className="h-4 w-4 text-primary" />
        <h3 className="text-sm font-semibold">Shared notes</h3>
        <span className="metric ml-auto rounded-full bg-secondary px-2 py-0.5 text-[11px] font-bold">
          {notes.length}
        </span>
      </header>

      <div className="flow-tight max-h-60 overflow-y-auto px-4 py-3">
        {loading ? (
          <p className="flex items-center gap-2 py-4 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading notes…
          </p>
        ) : notes.length === 0 ? (
          <p className="py-5 text-center text-xs text-muted-foreground">
            No notes yet. Anyone this candidate is shared with sees what you add here.
          </p>
        ) : (
          notes.map((note) => (
            <div key={note.id} className="rounded-xl border bg-background px-3 py-2">
              <div className="flex items-baseline justify-between gap-2">
                <p className="truncate text-xs font-semibold">
                  {note.mine ? "You" : note.author_name}
                </p>
                <time
                  className="shrink-0 text-[11px] text-muted-foreground"
                  dateTime={note.created_at}
                >
                  {new Date(note.created_at).toLocaleDateString()}
                </time>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-xs leading-relaxed">{note.body}</p>
            </div>
          ))
        )}
      </div>

      {canWrite ? (
        <form onSubmit={submit} className="flex items-center gap-2 border-t px-3 py-2.5">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Add a note…"
            className="h-8 rounded-lg text-xs"
          />
          <Button
            type="submit"
            size="icon"
            disabled={sending || !draft.trim()}
            className="h-8 w-8 shrink-0 rounded-lg"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
          </Button>
        </form>
      ) : (
        <p className="border-t px-4 py-2.5 text-xs text-muted-foreground">
          Shared with you read-only, so you can read the thread but not add to it.
        </p>
      )}
    </section>
  );
}
