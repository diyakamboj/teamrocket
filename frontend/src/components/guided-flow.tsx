import { Link } from "@tanstack/react-router";
import { FileText, UploadCloud, Gauge } from "lucide-react";
import { ProductName } from "@/components/product-name";

const STEPS = [
  {
    n: "1",
    icon: FileText,
    title: "Add a role",
    body: "Paste a job description. AI extracts skills, experience, and questions for you.",
    to: "/internal-hiring" as const,
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

export function GuidedFlow() {
  return (
    <section className="rounded-2xl border border-border bg-card p-5">
      <p className="text-xs font-semibold uppercase tracking-wider text-primary">How to hire with <ProductName /></p>
      <h2 className="mt-1 text-lg font-bold tracking-tight">
        One person. No technical skills. Many candidates.
      </h2>
      <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
        AI validates each résumé, scores it against the role, and guides the questions you should ask.
        You decide who moves forward.
      </p>
      <ol className="mt-4 grid gap-3 md:grid-cols-3">
        {STEPS.map((step) => (
          <li key={step.n}>
            <Link
              to={step.to}
              className="flex h-full gap-3 rounded-xl border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-accent/40"
            >
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-sm font-bold text-primary">
                {step.n}
              </span>
              <div className="min-w-0">
                <p className="flex items-center gap-1.5 text-sm font-semibold">
                  <step.icon className="h-3.5 w-3.5 text-primary" />
                  {step.title}
                </p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
              </div>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
