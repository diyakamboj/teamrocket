import { useEffect, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Section-based layout for the hiring pages.
 *
 * These were a numbered checklist, which implied a one-way trip: hiring is
 * not that. A recruiter opens a role, adds a few people, goes back and adds
 * more, checks scores, returns to sourcing. Numbering that sequence made
 * the normal way of working look like going backwards.
 *
 * So: every section is open and equal, with a chip bar that jumps between
 * them. The only linear element is the getting-started bar, shown solely
 * while an account has nothing yet — where there genuinely is a first
 * thing to do — and it disappears for good once the work has started.
 */

export type HiringSection = {
  id: string;
  title: string;
  /** One sentence, plain language: what this section is for. */
  blurb: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Shown on the right of the header when there is something to report. */
  summary?: string | undefined;
  body: ReactNode;
};

export type GettingStarted = {
  /** Ordered first-run milestones. */
  steps: { label: string; done: boolean }[];
};

export function HiringSections({
  sections,
  gettingStarted,
}: {
  sections: HiringSection[];
  /** Omitted once the account is past its first role. */
  gettingStarted?: GettingStarted | undefined;
}) {
  const [active, setActive] = useState(sections[0]?.id ?? "");

  // Highlight whichever section is currently in view, so the chip bar
  // reflects where the page actually is rather than the last thing clicked.
  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (visible?.target.id) setActive(visible.target.id);
      },
      { rootMargin: "-96px 0px -60% 0px" },
    );
    sections.forEach(({ id }) => {
      const el = document.getElementById(id);
      if (el) observer.observe(el);
    });
    return () => observer.disconnect();
  }, [sections]);

  const done = gettingStarted?.steps.filter((s) => s.done).length ?? 0;
  const total = gettingStarted?.steps.length ?? 0;

  return (
    <div className="space-y-5">
      {gettingStarted && (
        <section className="grad-panel animate-rise rounded-2xl border bg-card p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-sm font-semibold">Getting started</h2>
            <p className="text-xs text-muted-foreground">
              {done} of {total} done
            </p>
          </div>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-secondary">
            <div
              className="grad-track h-full rounded-full transition-[width] duration-700 ease-[cubic-bezier(0.22,1,0.36,1)]"
              style={{ width: `${total === 0 ? 0 : (done / total) * 100}%` }}
            />
          </div>
          <ul className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5">
            {gettingStarted.steps.map((step) => (
              <li
                key={step.label}
                className={cn(
                  "flex items-center gap-1.5 text-xs",
                  step.done ? "text-muted-foreground line-through" : "font-medium",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    step.done ? "bg-primary" : "bg-border",
                  )}
                />
                {step.label}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Jumping between sections is the normal way to work here, so it gets
          a permanent control rather than being left to scrolling. */}
      <nav
        aria-label="Sections"
        className="sticky top-14 z-10 -mx-1 flex flex-wrap gap-1.5 rounded-xl bg-background/85 px-1 py-2 backdrop-blur"
      >
        {sections.map((section) => (
          <a
            key={section.id}
            href={`#${section.id}`}
            onClick={() => setActive(section.id)}
            className={cn(
              "press-fx inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors",
              active === section.id
                ? "border-primary bg-primary-soft text-primary-soft-foreground"
                : "border-transparent text-muted-foreground hover:bg-secondary hover:text-foreground",
            )}
          >
            <section.icon className="h-3.5 w-3.5" />
            {section.title}
          </a>
        ))}
      </nav>

      {sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          className="scroll-mt-28 rounded-2xl border bg-card"
        >
          <header className="flex flex-wrap items-start gap-3 border-b px-5 py-4">
            <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <section.icon className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm font-semibold">{section.title}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">{section.blurb}</p>
            </div>
            {section.summary && (
              <span className="shrink-0 rounded-full bg-secondary px-2.5 py-1 text-xs font-medium text-muted-foreground">
                {section.summary}
              </span>
            )}
          </header>
          <div className="px-5 py-4">{section.body}</div>
        </section>
      ))}
    </div>
  );
}

/** The actions that belong to a section. */
export function SectionActions({ children }: { children: ReactNode }) {
  return <div className="mt-4 flex flex-wrap items-center gap-2">{children}</div>;
}
