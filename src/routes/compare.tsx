import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { Sparkle, X } from "lucide-react";
import { useAppState } from "@/lib/app-state";
import { CANDIDATES, rankCandidates } from "@/lib/mock-data";
import { MiniBar, ScoreRing } from "@/components/score-ring";
import { Button } from "@/components/ui/button";

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

function Compare() {
  const { compareIds, toggleCompare, clearCompare, weights, blindMode } = useAppState();
  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);
  const selected = ranked.filter((c) => compareIds.includes(c.id));

  if (selected.length === 0) {
    return (
      <div className="mx-auto max-w-2xl">
        <div className="card-surface p-10 text-center">
          <h1 className="text-2xl font-extrabold">Candidate Comparison</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Pick 2–3 candidates from the ranking to see them side by side.
          </p>
          <Link
            to="/candidates"
            className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Go to ranking
          </Link>
        </div>
      </div>
    );
  }

  const best = selected.reduce((a, b) => (b.score > a.score ? b : a));

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <header className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4">
        <div className="min-w-0">
          <h1 className="truncate text-2xl font-extrabold sm:text-3xl">Candidate Comparison</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {selected.length} candidates side by side
          </p>
        </div>
        <Button variant="outline" className="shrink-0 rounded-xl" onClick={clearCompare}>
          Clear selection
        </Button>
      </header>

      <div className="grid gap-4 lg:grid-cols-3">
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
                    className="rounded-full bg-primary-soft px-2.5 py-0.5 text-[11px] font-medium text-primary-soft-foreground"
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
          is the strongest overall fit at {best.score}, driven by a {best.categories.skills} skills
          match and {best.years} years of relevant delivery. The main trade-off is{" "}
          {best.gaps[0]!.toLowerCase()} — worth probing in a technical screen. If certification
          evidence is a hard requirement, re-weight the panel and re-check this shortlist.
        </p>
      </div>
    </div>
  );
}
