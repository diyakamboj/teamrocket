import { AlertTriangle, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { deleteMyAccount } from "@/lib/api";
import { logoutSession } from "@/lib/auth";

/**
 * Delete this account and everything it owns.
 *
 * Two gates, because this cannot be undone: the password has to be retyped
 * (a session someone left open should not be able to do this) and the word
 * DELETE has to be typed out, so it cannot happen by reflex.
 *
 * The consequences are spelled out rather than implied. Candidates and jobs
 * go with the account — leaving them would strand real people's résumés and
 * contact details under an owner who no longer exists.
 */
export function DeleteAccount({
  email,
  authProvider,
}: {
  email: string;
  /** "google" accounts never had a password issued — the server accepts the
   *  bearer token alone as re-authentication for them, so the field is
   *  skipped rather than asking for something that does not exist. */
  authProvider?: string;
}) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [confirmWord, setConfirmWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isGoogle = authProvider === "google";
  const armed = confirmWord.trim().toUpperCase() === "DELETE" && (isGoogle || password.length > 0);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!armed) return;
    setBusy(true);
    setError(null);
    try {
      await deleteMyAccount(password);
      logoutSession();
      toast.success("Your account has been deleted.");
      // Full reload rather than a route change: every cached query and piece
      // of app state belongs to an account that no longer exists.
      window.location.href = "/welcome";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete your account");
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Deleting removes your account and every candidate, role and upload filed under it.
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen(true)}
          className="press shrink-0 rounded-xl border-destructive/40 text-xs text-destructive hover:bg-destructive/10"
        >
          Delete account
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-destructive/40 bg-destructive/5 p-4">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold">Delete {email}?</p>
          <p className="mt-1 text-xs text-muted-foreground">
            This cannot be undone. Your candidates, roles, uploads and company documents are
            deleted with the account. Anyone you shared a candidate with keeps their own copy.
          </p>

          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {!isGoogle && (
              <label className="block space-y-1">
                <span className="text-[11px] font-medium">Your password</span>
                <Input
                  type="password"
                  autoFocus
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="rounded-lg text-xs"
                />
              </label>
            )}
            <label className="block space-y-1">
              <span className="text-[11px] font-medium">
                Type <span className="font-mono">DELETE</span> to confirm
              </span>
              <Input
                value={confirmWord}
                onChange={(e) => setConfirmWord(e.target.value)}
                placeholder="DELETE"
                className="rounded-lg text-xs"
              />
            </label>
          </div>

          {error && (
            <p role="alert" className="mt-3 rounded-lg bg-destructive/15 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={!armed || busy}
              className="press gap-1.5 rounded-xl bg-destructive text-xs text-destructive-foreground hover:bg-destructive/90"
            >
              {busy && <Loader2 className="h-3 w-3 animate-spin" />}
              Delete my account permanently
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setOpen(false);
                setPassword("");
                setConfirmWord("");
                setError(null);
              }}
              className="rounded-xl text-xs"
            >
              Cancel
            </Button>
          </div>
        </div>
      </div>
    </form>
  );
}
