import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { completePasswordReset } from "@/lib/auth";

export const Route = createFileRoute("/reset-password")({
  // The token arrives in the link from the email.
  validateSearch: (search: Record<string, unknown>): { token?: string | undefined } => {
    const raw = search["token"];
    return typeof raw === "string" && raw ? { token: raw } : {};
  },
  head: () => ({ meta: [{ title: "Set a new password — ResumeIQ" }] }),
  component: ResetPassword,
});

function ResetPassword() {
  const { token } = Route.useSearch();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (password !== confirm) {
      setError("Those two passwords do not match.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      // Resetting signs you in, so there is no second step.
      await completePasswordReset(token ?? "", password);
      toast.success("Password updated", {
        description: "You have been signed in. Any other sessions were signed out.",
      });
      void navigate({ to: "/" });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not reset your password");
    } finally {
      setSaving(false);
    }
  }

  if (!token) {
    return (
      <AuthLayout
        title="That link is incomplete"
        subtitle="Reset links expire after 30 minutes."
        footer={
          <Link to="/forgot-password" className="font-semibold text-primary">
            Request a new link
          </Link>
        }
      >
        <p className="text-sm text-muted-foreground">
          Open the link straight from your email, or request a fresh one.
        </p>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Set a new password"
      subtitle="Signing in happens automatically once it's saved."
      footer={
        <Link to="/login" className="font-semibold text-primary">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium">
            New password
          </label>
          <Input
            id="password"
            type="password"
            autoFocus
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <label htmlFor="confirm" className="text-xs font-medium">
            Confirm it
          </label>
          <Input
            id="confirm"
            type="password"
            required
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="rounded-xl"
          />
        </div>

        {error && (
          <p role="alert" className="animate-pop rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={saving} className="press w-full rounded-xl">
          {saving ? "Saving…" : "Save and sign in"}
        </Button>
      </form>
    </AuthLayout>
  );
}
