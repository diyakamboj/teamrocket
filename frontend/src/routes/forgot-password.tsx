import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";

import { AuthLayout } from "@/components/auth-layout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/api";

export const Route = createFileRoute("/forgot-password")({
  head: () => ({
    meta: [
      { title: "Reset your password — ResumeIQ" },
      { name: "description", content: "Send a password reset link to your work email." },
    ],
  }),
  component: ForgotPassword,
});

function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setError(null);
    try {
      await requestPasswordReset(email.trim());
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send the reset link");
    } finally {
      setSending(false);
    }
  }

  if (sent) {
    return (
      <AuthLayout
        title="Check your email"
        subtitle="If that address has an account, a reset link is on its way."
        footer={
          <Link to="/login" className="font-semibold text-primary">
            Back to sign in
          </Link>
        }
      >
        <div className="space-y-3 text-sm text-muted-foreground">
          <p>
            The link works for 30 minutes. If it expires, come back here and request another —
            the newest link is always the one that works.
          </p>
          <p>
            Nothing arrived? Check spam, and make sure you used the address you signed up with.
          </p>
        </div>
      </AuthLayout>
    );
  }

  return (
    <AuthLayout
      title="Reset your password"
      subtitle="We'll email you a link to set a new one."
      footer={
        <>
          Remembered it?{" "}
          <Link to="/login" className="font-semibold text-primary">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={submit} className="space-y-4">
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-xs font-medium">
            Work email
          </label>
          <Input
            id="email"
            type="email"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="rounded-xl"
          />
        </div>

        {error && (
          <p role="alert" className="animate-pop rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={sending} className="press w-full rounded-xl">
          {sending ? "Sending…" : "Send reset link"}
        </Button>
      </form>
    </AuthLayout>
  );
}
