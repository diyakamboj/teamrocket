import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { FileText, Gauge, UploadCloud, X } from "lucide-react";
import { ProductName } from "@/components/product-name";
import { openCreateJob } from "@/lib/app-events";

/**
 * The three-step primer on the dashboard.
 *
 * Step one opens the create-job modal rather than linking anywhere: creating
 * a role is a modal owned by the shell, so there is no page to navigate to.
 * The other two are ordinary links.
 *
 * Dismissal is remembered — this is onboarding, and a permanent banner for
 * someone on their fiftieth hire is clutter.
 */

const DISMISS_KEY = "resumeiq-guided-flow-dismissed";

const STEPS = [
  {
    n: "1",
    icon: FileText,
    title: "Add a role",
    body: "Paste a job description. AI extracts skills, experience, and questions for you.",
    action: "create-job" as const,
  },
  {
    n: "2",
    icon: UploadCloud,
    title: "Upload résumés",
    body: "Drop in as many files as you have. Validation and scoring run automatically.",
    to: "/upload" as const,
  },
  {
    n: "3",
    icon: Gauge,
    title: "Review ATS scores",
    body: "One score per candidate, plus skills and experience breakdowns. Advance the ones who pass.",
    to: "/candidates" as const,
  },
];

const CARD_CLASS =
  "group spotlight press-fx flex h-full w-full gap-3 rounded-xl border bg-background p-4 text-left " +
  "transition-all duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] " +
  "hover:-translate-y-0.5 hover:border-primary/40 hover:bg-accent/40 " +
  "hover:shadow-[0_10px_28px_-16px_var(--color-primary)] active:translate-y-0 active:scale-[0.99]";

function StepBody({ step }: { step: (typeof STEPS)[number] }) {
  return (
    <>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-bold text-primary transition-transform duration-200 group-hover:scale-110">
        {step.n}
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 text-sm font-semibold">
          <step.icon className="icon-nudge h-3.5 w-3.5 text-primary" />
          {step.title}
        </p>
        <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
      </div>
    </>
  );
}

export function GuidedFlow() {
  const [dismissed, setDismissed] = useState(true);

  // Read on mount rather than in the initial state so the server-rendered
  // and first client render agree; it flips to visible immediately after.
  useEffect(() => {
    setDismissed(window.localStorage.getItem(DISMISS_KEY) === "true");
  }, []);

  if (dismissed) return null;

  return (
    <section className="animate-rise relative rounded-2xl border border-border bg-card p-5">
      <button
        type="button"
        aria-label="Hide these instructions"
        title="Hide these instructions"
        onClick={() => {
          window.localStorage.setItem(DISMISS_KEY, "true");
          setDismissed(true);
        }}
        className="absolute right-3 top-3 grid h-7 w-7 place-items-center rounded-md text-muted-foreground transition-all duration-200 hover:bg-secondary hover:text-foreground active:scale-90"
      >
        <X className="h-4 w-4" />
      </button>

      <p className="text-xs font-semibold uppercase tracking-wider text-primary">
        How to hire with <ProductName />
      </p>
      <h2 className="mt-1 text-lg font-bold tracking-tight">
        One person. No technical skills. Many candidates.
      </h2>
      <p className="mt-1 max-w-2xl pr-8 text-sm text-muted-foreground">
        AI validates each résumé, scores it against the role, and guides the questions you should
        ask. You decide who moves forward.
      </p>

      <ol className="stagger mt-4 grid gap-3 md:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.n}>
            {"action" in step ? (
              <button type="button" onClick={openCreateJob} className={CARD_CLASS}>
                <StepBody step={step} />
              </button>
            ) : (
              <Link to={step.to} className={CARD_CLASS}>
                <StepBody step={step} />
              </Link>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}
