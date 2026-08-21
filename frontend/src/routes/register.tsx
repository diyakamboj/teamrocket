import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { isSignedIn, register } from "@/lib/auth";
import { AuthLayout } from "@/components/auth-layout";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [{ title: "Create your workspace — ResumeIQ" }] }),
  component: RegisterPage,
});

/** Mirrors the server's rule (see auth_service.MIN_PASSWORD_LENGTH). */
const MIN_PASSWORD = 8;

/** Mirrors backend `app/models/roles.py`. HR is deliberately not a role:
 *  recruiters and hiring managers own hiring decisions, IT owns the
 *  platform, and HR would duplicate permissions all three already have. */
const ROLES = [
  { value: "recruiter", label: "Recruiter", description: "Sources and screens candidates, runs the pipeline." },
  { value: "hiring_manager", label: "Hiring Manager", description: "Reviews shortlists and interviews for their own roles." },
  { value: "it_admin", label: "IT Admin", description: "Manages accounts, integrations and platform settings." },
] as const;

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<string>(ROLES[0].value);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isSignedIn()) void navigate({ to: "/", replace: true });
  }, [navigate]);

  const checks = useMemo(
    () => [
      { label: `At least ${MIN_PASSWORD} characters`, ok: password.length >= MIN_PASSWORD },
      { label: "No leading or trailing spaces", ok: password === password.trim() },
    ],
    [password],
  );
  const passwordOk = checks.every((c) => c.ok);

  // Shared by the password form and Google sign-up: both end with a real
  // session and land on the same "your workspace is ready" welcome.
  function launch(name: string) {
    toast.success(`Welcome, ${name.split(" ")[0]} — your workspace is ready.`);
    void navigate({ to: "/", replace: true });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !passwordOk) return;
    setBusy(true);
    setError(null);
    try {
      const session = await register({
        email: email.trim(),
        password,
        name: name.trim(),
        role,
      });
      launch(session.name);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create your account.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout
      title="Create your workspace"
      subtitle="One account, your own candidate pool and company context."
      footer={
        <>
          Already have an account?{" "}
          <Link to="/login" className="font-semibold text-primary hover:underline">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-1.5">
          <label htmlFor="name" className="text-xs font-medium">
            Full name
          </label>
          <Input
            id="name"
            autoComplete="name"
            required
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Rita Chen"
            className="rounded-xl"
          />
        </div>

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
          <label htmlFor="role" className="text-xs font-medium">
            Role
          </label>
          {/* A picker, not free text: the role decides what you can see and
              do, so it has to be one the API recognises. */}
          <select
            id="role"
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="w-full rounded-xl border border-input bg-background px-3 py-2 text-sm"
          >
            {ROLES.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="text-xs text-muted-foreground">
            {ROLES.find((r) => r.value === role)?.description}
          </p>
        </div>

        <div className="space-y-1.5">
          <label htmlFor="password" className="text-xs font-medium">
            Password
          </label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="rounded-xl"
          />
          {password.length > 0 && (
            <ul className="animate-fade mt-2 space-y-1">
              {checks.map((check) => (
                <li
                  key={check.label}
                  className={cn(
                    "flex items-center gap-1.5 text-xs transition-colors",
                    check.ok ? "text-success dark:text-success" : "text-muted-foreground",
                  )}
                >
                  <Check className={cn("h-3 w-3", !check.ok && "opacity-30")} />
                  {check.label}
                </li>
              ))}
            </ul>
          )}
        </div>

        {error && (
          <p role="alert" className="animate-pop rounded-lg bg-destructive/10 px-3 py-2 text-xs text-destructive">
            {error}
          </p>
        )}

        <Button type="submit" disabled={busy || !passwordOk} className="group w-full rounded-xl">
          {busy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Creating your workspace…
            </>
          ) : (
            <>
              Create account
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
