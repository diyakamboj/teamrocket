import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Sparkle, Sparkles, X } from "lucide-react";
import { MiniBar, ScoreRing } from "@/components/score-ring";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/lib/app-state";
import { useCopilot } from "@/lib/copilot-state";
import { rankCandidates } from "@/lib/candidates";
import { useCandidatePool } from "@/lib/use-candidate-pool";

export const Route = createFileRoute("/compare")({
  head: () => ({
    meta: [
      { title: "Candidate Comparison — ResumeIQ" },
      {
        name: "description",
        content:
          "Compare up to three shortlisted candidates side by side across scores, skills, experience and AI recommendations.",
      },
      { property: "og:title", content: "Candidate Comparison — ResumeIQ" },
      {
        property: "og:description",
        content: "Side-by-side comparison of shortlisted candidates with an AI recommendation.",
      },
    ],
  }),
  component: Compare,
});

function AskCopilotAboutComparison({ count }: { count: number }) {
  const { setOpen, send } = useCopilot();

  return (
    <Button
      variant="outline"
      className="rounded-xl"
      onClick={() => {
        setOpen(true);
        if (count >= 2) {
          void send("Compare my shortlisted candidates side by side.");
        }
      }}
    >
      <Sparkles className="mr-2 h-4 w-4" /> Ask AI about this comparison
    </Button>
  );
}

function Compare() {
  const { compareIds, toggleCompare, clearCompare, weights, blindMode } = useAppState();
  const { candidates: pool } = useCandidatePool();
  const ranked = useMemo(() => rankCandidates(pool, weights), [pool, weights]);
  const selected = ranked.filter((c) => compareIds.includes(c.id));

  if (selected.length === 0) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <div className="card-surface p-10 text-center">
          <h1 className="text-2xl font-extrabold">Candidate Comparison</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick 2–3 candidates from the ranking to see them side by side.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Link
              to="/candidates"
              className="inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
            >
              Go to ranking
            </Link>
            <AskCopilotAboutComparison count={0} />
          </div>
        </div>
      </div>
    );
  }

  const best = selected.reduce((a, b) => (b.score > a.score ? b : a));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Candidate Comparison</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selected.length} candidates side by side
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <AskCopilotAboutComparison count={selected.length} />
          <Button variant="outline" className="rounded-xl" onClick={clearCompare}>
            Clear selection
          </Button>
        </div>
      </header>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {selected.map((c) => (
          <div key={c.id} className="card-surface flex flex-col gap-5 p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ScoreRing value={c.score} size={56} />
                <div className="min-w-0">
                  <p className="truncate font-bold">
                    {blindMode ? `Candidate #${c.rank}` : c.name}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.title} · {c.years} yrs
                  </p>
                </div>
              </div>
              <button
                aria-label="Remove from comparison"
                onClick={() => toggleCompare(c.id)}
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-secondary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-2">
              <MiniBar label="Skills" value={c.categories.skills} />
              <MiniBar label="Experience" value={c.categories.experience} />
              <MiniBar label="Education" value={c.categories.education} />
              <MiniBar label="Certifications" value={c.categories.certifications} />
              <MiniBar label="Projects" value={c.categories.projects} />
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Skills
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {c.skills.map((s) => (
                  <span
                    key={s}
                    className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary-soft-foreground"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Education
              </p>
              <p className="mt-1 text-sm">{c.education}</p>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Strengths
              </p>
              <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                {c.strengths.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
            </div>

            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                Weaknesses
              </p>
              <ul className="mt-1 space-y-1 text-sm text-muted-foreground">
                {c.gaps.map((s) => (
                  <li key={s}>• {s}</li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <div className="card-surface p-6">
        <div className="flex items-center gap-2 text-primary-soft-foreground">
          <Sparkle className="h-4 w-4" />
          <span className="text-xs font-bold uppercase tracking-wide">AI recommendation</span>
        </div>
        <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
          <strong className="text-foreground">
            {blindMode ? `Candidate #${best.rank}` : best.name}
          </strong>{" "}
          is the strongest ATS score at {best.score}, driven by a {best.categories.skills} skills
          match and {best.years} years of relevant delivery. The main trade-off is{" "}
          {best.gaps[0]!.toLowerCase()} — ask AI for interview questions or experience comparisons.
        </p>
      </div>
    </div>
  );
}
