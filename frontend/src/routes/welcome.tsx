import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  CalendarClock,
  FileSearch,
  Gauge,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { isSignedIn } from "@/lib/auth";
import { useReveal } from "@/lib/use-reveal";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "ResumeIQ — Hire on evidence, not gut feel" },
      {
        name: "description",
        content:
          "ResumeIQ screens résumés against your job description, scores every candidate on evidence you can click through to, and runs first-round screening with an AI copilot.",
      },
    ],
  }),
  component: LandingPage,
});

const FEATURES = [
  {
    icon: FileSearch,
    title: "Screening that shows its work",
    body: "Every score traces back to a line in the résumé. Open a badge and read the sentence it came from — no black-box ranking.",
  },
  {
    icon: Bot,
    title: "A copilot that only cites what it has",
    body: "Ask about your pool in plain language. Answers come from stored verdicts and your own company documents, never invention.",
  },
  {
    icon: BadgeCheck,
    title: "Status at a glance",
    body: "Top match, bench candidate, immediate joiner, incomplete profile — standard flags applied consistently across everyone.",
  },
  {
    icon: ShieldCheck,
    title: "Fraud and consistency checks",
    body: "Employment claims and sanctions lists are checked live, and the app tells you which checks were real and which were inferred.",
  },
  {
    icon: CalendarClock,
    title: "Screening to interview, in one thread",
    body: "Run a structured L1 screen, then hand the interviewer a briefing with strengths, gaps and what to probe.",
  },
  {
    icon: Gauge,
    title: "Weighted to your role",
    body: "Move the sliders and the ranking re-sorts instantly. Skills, experience, education and projects, weighted how you hire.",
  },
];

const STEPS = [
  { n: "01", title: "Add the role", body: "Paste a job description. Requirements are extracted and editable." },
  { n: "02", title: "Upload résumés", body: "Bulk upload; each file is parsed, deduplicated and scored." },
  { n: "03", title: "Review the evidence", body: "Ranked candidates with per-requirement verdicts and citations." },
  { n: "04", title: "Screen and hand off", body: "Run L1 screening, then send the interviewer a briefing." },
];

function LandingPage() {
  const navigate = useNavigate();
  const revealRef = useReveal<HTMLDivElement>();

  // Someone already signed in has no use for the front door.
  useEffect(() => {
    if (isSignedIn()) void navigate({ to: "/", replace: true });
  }, [navigate]);

  return (
    <div ref={revealRef} className="min-h-screen overflow-x-hidden bg-background text-foreground">
      {/* Ambient background: two slow-drifting colour fields. Purely
          decorative, and hidden from assistive tech. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
        <div className="animate-aurora absolute -left-40 -top-40 h-[38rem] w-[38rem] rounded-full bg-primary/25 blur-3xl" />
        <div
          className="animate-aurora absolute -right-32 top-1/3 h-[32rem] w-[32rem] rounded-full bg-sky-400/20 blur-3xl"
          style={{ animationDelay: "-6s" }}
        />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="animate-fade flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold tracking-tight">ResumeIQ</p>
            <p className="text-[11px] text-muted-foreground">Recruiting intelligence</p>
          </div>
        </div>
        <div className="animate-fade flex items-center gap-2">
          <Link to="/login">
            <Button variant="ghost" className="rounded-xl text-sm">
              Sign in
            </Button>
          </Link>
          <Link to="/register">
            <Button className="rounded-xl text-sm">Get started</Button>
          </Link>
        </div>
      </header>

      {/* ---------- Hero ---------- */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-12 sm:pt-20">
        <div className="stagger mx-auto max-w-3xl text-center">
          <span className="inline-flex items-center gap-2 rounded-full border bg-card/70 px-3 py-1.5 text-xs font-medium text-muted-foreground backdrop-blur">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
            </span>
            Screening 400 candidates in this workspace right now
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl">
            Hire on <span className="gradient-text">evidence</span>,
            <br className="hidden sm:block" /> not gut feel.
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            ResumeIQ reads every résumé against your job description, scores candidates on
            requirements you set, and shows the exact line behind every claim — so a shortlist is
            something you can defend, not just feel good about.
          </p>

          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to="/register">
              <Button size="lg" className="group rounded-xl px-6 text-sm">
                Create your workspace
                <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
              </Button>
            </Link>
            <Link to="/login">
              <Button size="lg" variant="outline" className="rounded-xl px-6 text-sm">
                I already have an account
              </Button>
            </Link>
          </div>

          <p className="mt-4 text-xs text-muted-foreground">
            No credit card. Your data stays in your own Azure storage.
          </p>
        </div>

        {/* Product glimpse — a real ranked row, rendered rather than a screenshot. */}
        <div className="animate-pop mx-auto mt-16 max-w-4xl" style={{ animationDelay: "0.35s" }}>
          <div className="lift rounded-2xl border bg-card/80 p-2 shadow-xl backdrop-blur">
            <div className="rounded-xl border bg-background p-5">
              <div className="flex items-center justify-between border-b pb-3">
                <p className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Candidate ranking
                </p>
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[10px] font-semibold">
                  Weighted to this role
                </span>
              </div>
              <ul className="stagger mt-4 space-y-3">
                {[
                  { rank: 1, name: "Priya Raman", score: 92, flag: "🟢 Top match", tone: "text-emerald-600 dark:text-emerald-400" },
                  { rank: 2, name: "Daniel Osei", score: 87, flag: "🚀 Immediate joiner", tone: "text-sky-600 dark:text-sky-400" },
                  { rank: 3, name: "Mei Tanaka", score: 74, flag: "👥 Bench candidate", tone: "text-muted-foreground" },
                ].map((row) => (
                  <li key={row.rank} className="flex items-center gap-4 rounded-xl border p-3">
                    <span className="text-xs font-extrabold tabular-nums text-muted-foreground">
                      #{row.rank}
                    </span>
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                      {row.name.split(" ").map((p) => p[0]).join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{row.name}</p>
                      <p className={`text-[11px] font-medium ${row.tone}`}>{row.flag}</p>
                    </div>
                    <div className="hidden flex-1 sm:block">
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-out"
                          style={{ width: `${row.score}%` }}
                        />
                      </div>
                    </div>
                    <span className="text-sm font-bold tabular-nums">{row.score}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* ---------- Features ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="reveal mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">
            Everything a first-round takes
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Parsing, scoring, screening, verification and hand-off — in one place, all pointing back
            at the same evidence.
          </p>
        </div>

        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map(({ icon: Icon, title, body }, i) => (
            <div
              key={title}
              className="reveal lift rounded-2xl border bg-card p-6"
              style={{ transitionDelay: `${i * 60}ms` }}
            >
              <span className="grid h-10 w-10 place-items-center rounded-xl bg-primary/10 text-primary">
                <Icon className="h-5 w-5" />
              </span>
              <h3 className="mt-4 text-sm font-semibold">{title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ---------- How it works ---------- */}
      <section className="mx-auto max-w-6xl px-6 py-20">
        <div className="reveal mx-auto max-w-2xl text-center">
          <h2 className="text-3xl font-bold tracking-tight sm:text-4xl">Four steps to a shortlist</h2>
        </div>
        <ol className="mt-12 grid gap-4 md:grid-cols-4">
          {STEPS.map((step, i) => (
            <li
              key={step.n}
              className="reveal lift relative rounded-2xl border bg-card p-6"
              style={{ transitionDelay: `${i * 80}ms` }}
            >
              <span className="text-xs font-black tabular-nums text-primary/40">{step.n}</span>
              <h3 className="mt-2 text-sm font-semibold">{step.title}</h3>
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{step.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* ---------- Closing ---------- */}
      <section className="mx-auto max-w-4xl px-6 pb-24">
        <div className="reveal relative overflow-hidden rounded-3xl border bg-card p-10 text-center shadow-lg">
          <div
            aria-hidden
            className="animate-drift pointer-events-none absolute -right-16 -top-16 h-56 w-56 rounded-full bg-primary/15 blur-2xl"
          />
          <Users className="mx-auto h-8 w-8 text-primary" />
          <h2 className="mt-4 text-2xl font-bold tracking-tight sm:text-3xl">
            Start with your next role
          </h2>
          <p className="mx-auto mt-3 max-w-md text-sm text-muted-foreground">
            Create an account, paste a job description, and upload the résumés you already have.
          </p>
          <Link to="/register">
            <Button size="lg" className="group mt-7 rounded-xl px-7">
              Create your workspace
              <ArrowRight className="ml-2 h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Button>
          </Link>
        </div>
      </section>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-6 py-6 text-xs text-muted-foreground">
          <span>ResumeIQ — recruiting intelligence</span>
          <span>Evidence-backed screening</span>
        </div>
      </footer>
    </div>
  );
}
