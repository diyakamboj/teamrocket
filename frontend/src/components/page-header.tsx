import { Link } from "@tanstack/react-router";
import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

export type Crumb = {
  label: string;
  to?: string;
  search?: Record<string, string | undefined>;
  params?: Record<string, string>;
};

export function PageHeader({
  crumbs,
  title,
  description,
  actions,
}: {
  crumbs?: Crumb[];
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0">
        {crumbs && crumbs.length > 0 && (
          <nav aria-label="Breadcrumb" className="mb-1.5">
            <ol className="flex flex-wrap items-center gap-1 text-xs text-muted-foreground">
              {crumbs.map((crumb, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <li key={`${crumb.label}-${i}`} className="inline-flex items-center gap-1">
                    {i > 0 && <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />}
                    {last || !crumb.to ? (
                      <span className={last ? "font-medium text-foreground" : undefined}>
                        {crumb.label}
                      </span>
                    ) : (
                      <Link
                        to={crumb.to}
                        search={crumb.search as never}
                        params={crumb.params as never}
                        className="hover:text-foreground"
                      >
                        {crumb.label}
                      </Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </nav>
        )}
        <h1 className="truncate text-2xl font-extrabold sm:text-3xl">{title}</h1>
        {description ? (
          <div className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</div>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}
