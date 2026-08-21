import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { loginWithGoogle } from "@/lib/auth";

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: {
            client_id: string;
            callback: (response: { credential: string }) => void;
          }) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}

const CLIENT_ID = import.meta.env["VITE_GOOGLE_CLIENT_ID"] as string | undefined;

/**
 * "Sign in with Google" button for the login and register pages.
 *
 * One call serves both: the backend links the Google account to an existing
 * recruiter by email, or creates one, so there is no separate "register with
 * Google" flow to keep in sync with this one.
 *
 * Renders nothing when VITE_GOOGLE_CLIENT_ID is unset, so a deployment that
 * has not configured Google sign-in yet just shows the password form —
 * the same shape the app had before this existed.
 */
export function GoogleSignInButton({ onSuccess }: { onSuccess: (name: string) => void }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!CLIENT_ID) return;

    let cancelled = false;

    async function handleCredential(response: { credential: string }) {
      try {
        const session = await loginWithGoogle(response.credential);
        onSuccess(session.name);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : "Could not sign in with Google.");
      }
    }

    // The GIS script tag is async/defer, so `window.google` may not exist
    // yet on first render — poll briefly rather than assuming load order.
    const timer = window.setInterval(() => {
      if (cancelled || !window.google || !containerRef.current) return;
      window.clearInterval(timer);

      window.google.accounts.id.initialize({
        client_id: CLIENT_ID,
        callback: (response) => void handleCredential(response),
      });
      window.google.accounts.id.renderButton(containerRef.current, {
        type: "standard",
        theme: "outline",
        size: "large",
        width: 336,
        text: "continue_with",
        shape: "pill",
      });
      setReady(true);
    }, 100);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [onSuccess]);

  if (!CLIENT_ID) return null;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span className="h-px flex-1 bg-border" />
        or
        <span className="h-px flex-1 bg-border" />
      </div>
      <div className={ready ? "flex justify-center" : "flex justify-center opacity-0"}>
        <div ref={containerRef} />
      </div>
    </div>
  );
}
