import { type ReactNode } from "react";
import { useRouterState } from "@tanstack/react-router";

/**
 * Replays an entrance animation whenever the route changes.
 *
 * Keyed on the pathname, so React remounts the subtree on navigation and the
 * animation restarts. A re-render on the same path keeps the same key and is
 * left alone, so typing in a filter does not re-trigger the swoosh.
 */
export function PageTransition({ children }: { children: ReactNode }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  return (
    <div key={pathname} className="page-swoosh">
      {children}
    </div>
  );
}
