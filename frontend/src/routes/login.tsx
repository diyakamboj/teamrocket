import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isSignedIn, login } from "@/lib/auth";
import { AuthLayout } from "@/components/auth-layout";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [{ title: "Sign in — ResumeIQ" }] }),
  component: LoginPage,
});

function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  //: Plays the launch animation before navigating, so signing in reads as
  //: moving into the app rather than the page blinking out.
  const [leaving, setLeaving] = useState(false);

  useEffect(() => {
    if (isSignedIn()) void navigate({ to: "/", replace: true });
  }, [navigate]);

  // Shared by the password form and Google sign-in: both end with a real
  // session, and should read as the same "moving into the app" moment.
  function launch(name: string) {
    toast.success(`Welcome back, ${name.split(" ")[0]}`);
    setLeaving(true);
    // Matches the .auth-launch duration; anyone on reduced motion sees the
    // card hidden immediately and waits the same brief moment.
    window.setTimeout(() => void navigate({ to: "/", replace: true }), 420);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    // A local flag, not the state value: `leaving` in this closure is still
    // false when `finally` runs, which would un-spin the button mid-launch.
    let launched = false;
    try {
      const session = await login(email.trim(), password);
      launched = true;
      launch(session.name);
      return;
    } catch (err) {
      // The server deliberately gives one message for both an unknown
      // address and a wrong password; show exactly that.
      setError(err instanceof Error ? err.message : "Could not sign in.");
    } finally {
      if (!launched) setBusy(false);
    }
  }

  return (
    <AuthLayout
      leaving={leaving}
      title="Sign in"
      subtitle="Pick up where you left off with your candidate pool."
      footer={
        <>
          New here?{" "}
          <Link to="/register" className="font-semibold text-primary hover:underline">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="email" className="text-xs font-medium">
            Work email
          </label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@company.com"
            className="rounded-xl"
          />
        </div>

        <div className="space-y-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <label htmlFor="password" className="text-xs font-medium">
              Password
            </label>
            <Link
              to="/forgot-password"
              className="text-[11px] font-medium text-primary hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Your password"
            className="rounded-xl"
          />
        </div>

        {error && (
          <p role="alert" className="animate-pop rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy} className="group w-full rounded-xl">
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Signing in…
            </>
          ) : (
            <>
              Sign in
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </>
          )}
        </Button>
      </form>

      <div className="mt-5">
        <GoogleSignInButton onSuccess={launch} />
      </div>
    </AuthLayout>
  );
}
