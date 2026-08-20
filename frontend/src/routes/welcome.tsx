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
import { ProductName } from "@/components/product-name";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "ResumeIQ — Hire on evidence, not gut feel" },
      {
        name: "description",
        content:
          "ResumeIQ scores résumés against your job description so one person can review many candidates — AI handles validation, scoring, and interview questions.",
      },
    ],
  }),
  component: LandingPage,
});

const FEATURES = [
  {
    icon: FileSearch,
    title: "One ATS score, clearly explained",
    body: "Skills, experience, and the rest sit beside the overall ATS score — with the résumé line behind each number.",
  },
  {
    icon: Bot,
    title: "AI that validates and guides",
    body: "Ask about your pool in plain language. AI checks résumés, scores them, and suggests what to ask next.",
  },
  {
    icon: BadgeCheck,
    title: "Status at a glance",
    body: "Pass, review, or fail — plus Poor / Average / Good / Excellent so a first look is enough to decide.",
  },
  {
    icon: ShieldCheck,
    title: "Fraud and consistency checks",
    body: "Employment claims and sanctions lists are checked live, and the app tells you which checks were real.",
  },
  {
    icon: CalendarClock,
    title: "From reviewed to interview",
    body: "AI drafts first-round questions, then hands the interviewer a briefing with strengths, gaps, and what to probe.",
  },
  {
    icon: Gauge,
    title: "Weighted to your role",
    body: "Move the sliders and the ranking re-sorts instantly. Skills, experience, education and projects, weighted how you hire.",
  },
];

const STEPS = [
  { n: "01", title: "Add the role", body: "Paste a job description. AI extracts skills, experience, and questions." },
  { n: "02", title: "Upload résumés", body: "Bulk upload. Each file is validated, parsed, and scored automatically." },
  { n: "03", title: "Review ATS scores", body: "One score per candidate, with category breakdowns and a pass/fail tier." },
  { n: "04", title: "Ask and hand off", body: "Let AI guide questions, then send the interviewer a briefing." },
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
          className="animate-aurora absolute -right-32 top-1/3 h-[32rem] w-[32rem] rounded-full bg-primary/20 blur-3xl"
          style={{ animationDelay: "-6s" }}
        />
      </div>

      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <div className="animate-fade flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
            <Sparkles className="h-4.5 w-4.5" />
          </span>
          <div className="leading-tight">
            <p className="text-sm tracking-tight">
              <ProductName />
            </p>
            <p className="text-xs text-muted-foreground">Recruiting intelligence</p>
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
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
            </span>
            One recruiter reviewing hundreds of candidates — no technical skills needed
          </span>

          <h1 className="mt-6 text-4xl font-extrabold leading-[1.08] tracking-tight sm:text-6xl">
            Hire on <span className="gradient-text">evidence</span>,
            <br className="hidden sm:block" /> not gut feel.
          </h1>

          <p className="mx-auto mt-5 max-w-2xl text-base leading-relaxed text-muted-foreground sm:text-lg">
            <ProductName /> reads every résumé against your job. AI validates the file, scores
            it, and guides the questions — so one person can review many candidates without
            being a recruiter-engineer.
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
                <span className="rounded-full bg-secondary px-2 py-0.5 text-[11px] font-semibold">
                  Weighted to this role
                </span>
              </div>
              <ul className="stagger mt-4 space-y-3">
                {[
                  { rank: 1, name: "Priya Raman", score: 92, flag: "🟢 Top match", tone: "text-success dark:text-success" },
                  { rank: 2, name: "Daniel Osei", score: 87, flag: "🚀 Immediate joiner", tone: "text-primary dark:text-primary" },
                  { rank: 3, name: "Mei Tanaka", score: 74, flag: "👥 Bench candidate", tone: "text-muted-foreground" },
                ].map((row) => (
                  <li key={row.rank} className="flex items-center gap-4 rounded-xl border p-3">
                    <span className="text-xs font-extrabold tabular-nums text-muted-foreground">
                      #{row.rank}
                    </span>
                    <span className="grid h-8 w-8 place-items-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                      {row.name.split(" ").map((p) => p[0]).join("")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{row.name}</p>
                      <p className={`text-xs font-medium ${row.tone}`}>{row.flag}</p>
                    </div>
                    <div className="hidden flex-1 sm:block">
                      <div className="h-1.5 overflow-hidden rounded-full bg-secondary">
                        <div
                          className="h-full rounded-full bg-primary transition-[width] duration-1000 ease-out"
                          style={{ width: `${row.score}%` }}
                        />
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-[11px] font-bold uppercase text-muted-foreground">ATS</p>
                      <span className="text-lg font-extrabold tabular-nums">{row.score}</span>
                    </div>
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
            Simple, guided, AI-powered
          </h2>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            Validation, scoring, and interview questions — handled by AI so you can stay on the shortlist.
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
          <span>
            <ProductName /> — AI-powered hiring
          </span>
          <span>One ATS score. Many candidates. Zero guesswork.</span>
        </div>
      </footer>
    </div>
  );
}
