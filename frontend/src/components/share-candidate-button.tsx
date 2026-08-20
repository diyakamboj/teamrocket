import { useEffect, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { toast } from "sonner";
import {
  listRecruiterDirectory,
  shareCandidate,
  type DirectoryRecruiter,
  type SharePermission,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

/**
 * Share one candidate with a connected recruiter.
 *
 * Only connections are offered: the backend refuses anyone else, so showing
 * the full directory here would be offering something that cannot work.
 */
export function ShareCandidateButton({
  candidateId,
  candidateName,
  jobId,
}: {
  candidateId: string;
  candidateName: string;
  jobId?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [connections, setConnections] = useState<DirectoryRecruiter[]>([]);
  const [note, setNote] = useState("");
  const [permission, setPermission] = useState<SharePermission>("view");
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    listRecruiterDirectory()
      .then((people) => setConnections(people.filter((p) => p.connection_state === "connected")))
      .catch(() => setConnections([]));
  }, [open]);

  async function share(email: string) {
    setBusy(email);
    try {
      await shareCandidate({
        candidate_id: candidateId,
        email,
        ...(note.trim() ? { note: note.trim() } : {}),
        job_id: jobId ?? null,
        permission,
      });
      toast.success(
        permission === "collaborate"
          ? `${candidateName} shared to collaborate on`
          : `Shared ${candidateName}`,
      );
      setOpen(false);
      setNote("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not share");
    } finally {
      setBusy(null);
    }
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="outline" className="rounded-xl">
          <Share2 className="mr-1.5 h-3.5 w-3.5" /> Share
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-3">
        <div>
          <p className="text-sm font-semibold">Share {candidateName}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {permission === "collaborate"
              ? "They can add notes and move this candidate in your pipeline. The record stays yours and you can revoke it."
              : "Read-only. They see the profile and screening result, and it stays in your pool."}
          </p>
        </div>

        {/* Access level. Read-only is the default: the wider grant should be
            a deliberate choice, not what you get by not reading. */}
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1">
          {(
            [
              { id: "view", label: "Can view" },
              { id: "collaborate", label: "Can collaborate" },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setPermission(option.id)}
              className={cn(
                "rounded-md px-2 py-1 text-xs font-medium transition-colors",
                permission === option.id
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Add a note (optional)"
          className="h-8 rounded-lg text-xs"
        />

        {connections.length === 0 ? (
          <p className="rounded-lg border border-dashed px-3 py-4 text-center text-xs text-muted-foreground">
            No connections yet. Connect with a recruiter first on the Recruiter Network page.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {connections.map((person) => (
              <li key={person.email}>
                <button
                  disabled={busy === person.email}
                  onClick={() => void share(person.email)}
                  className="flex w-full items-center justify-between gap-2 rounded-lg border px-3 py-2 text-left text-xs transition-colors hover:border-primary/40 disabled:opacity-50"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{person.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {person.role}
                    </span>
                  </span>
                  {busy === person.email ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <Share2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
