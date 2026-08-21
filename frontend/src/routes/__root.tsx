import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  useNavigate,
  useRouterState,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import { reportLovableError } from "../lib/lovable-error-reporting";
import { ThemeProvider } from "@/lib/theme";
import { AppStateProvider } from "@/lib/app-state";
import { CopilotProvider } from "@/lib/copilot-state";
import { AppShell } from "@/components/app-shell";
import { PointerFX } from "@/components/pointer-fx";
import { PageTransition } from "@/components/page-transition";
import { isSignedIn, verifySession } from "@/lib/auth";
import { CopilotLauncher } from "@/components/copilot/copilot-launcher";
import { Toaster } from "@/components/ui/sonner";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  // Default title/description/og:title — routes with their own head() (see
  // src/routes/*.tsx) override these; index.html only owns the tags no
  // route ever overrides (charset, viewport, favicon, fonts, og:type,
  // twitter:card), so HeadContent isn't fighting a static duplicate.
  head: () => ({
    meta: [
      { title: "ResumeIQ — AI-powered hiring" },
      {
        name: "description",
        content:
          "Screen resumes at scale with AI: bulk parsing, job-description matching, ranked candidates and side-by-side comparison.",
      },
      { property: "og:title", content: "ResumeIQ — AI-powered hiring" },
    ],
  }),
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

/** Pages reachable without an account: the front door and the auth forms. */
// Reachable without a session. Password recovery has to be here for the
// obvious reason: someone who has forgotten their password cannot sign in
// to reach the page that fixes it. Left out, the auth gate bounced them
// straight back to /welcome and the link looked broken.
const PUBLIC_ROUTES = [
  "/welcome",
  "/login",
  "/register",
  "/forgot-password",
  "/reset-password",
];

/**
 * Gate for everything else.
 *
 * Renders nothing while an unauthenticated visitor is redirected, so no app
 * chrome or API call happens for a signed-out user. The stored session is
 * also re-verified against the server on mount — a hand-edited localStorage
 * entry gets someone as far as a redirect back to sign-in, not into the app.
 */
function RequireAuth({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const [allowed, setAllowed] = useState(() => isSignedIn());

  useEffect(() => {
    if (!isSignedIn()) {
      setAllowed(false);
      void navigate({ to: "/welcome", replace: true });
      return;
    }
    void verifySession().then((session) => {
      if (session) return;
      setAllowed(false);
      void navigate({ to: "/login", replace: true });
    });
  }, [navigate]);

  if (!allowed) return null;
  return <>{children}</>;
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const isPublic = PUBLIC_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );

  return (
    <QueryClientProvider client={queryClient}>
      {/* Applies each matched route's head() (title, meta, OG tags) to document.head client-side. */}
      <HeadContent />
      <ThemeProvider>
        {/* Publishes cursor position as CSS vars for pointer-reactive
            surfaces. Outside the auth gate: the public pages have cards
            too. Renders nothing. */}
        <PointerFX />
        {isPublic ? (
          <>
            {/* No shell, no app state: these pages must render for someone
                who has no account yet. */}
            <PageTransition>
              <Outlet />
            </PageTransition>
            <Toaster position="top-center" richColors closeButton />
          </>
        ) : (
          <RequireAuth>
            <AppStateProvider>
              <CopilotProvider>
                <AppShell>
                  {/* Required: nested routes render here. */}
                  <PageTransition>
                    <Outlet />
                  </PageTransition>
                </AppShell>
                <CopilotLauncher />
                <Toaster position="top-center" richColors closeButton />
              </CopilotProvider>
            </AppStateProvider>
          </RequireAuth>
        )}
      </ThemeProvider>
    </QueryClientProvider>
  );
}
