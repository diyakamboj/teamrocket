import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { Columns3, Sparkle, Sparkles, X } from "lucide-react";
import { CompareChat } from "@/components/copilot";
import { EmptyState } from "@/components/empty-state";
import { OriginBadge } from "@/components/origin-badge";
import { PageHeader } from "@/components/page-header";
import { MiniBar, ScoreRing } from "@/components/score-ring";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/lib/app-state";
import { CANDIDATES, rankCandidates } from "@/lib/mock-data";
import { getJob } from "@/lib/jobs-data";

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
  const {
    compareIds,
    toggleCompare,
    clearCompare,
    weights,
    blindMode,
    selectedJobId,
    openCopilot,
  } = useAppState();
  const ranked = useMemo(() => rankCandidates(CANDIDATES, weights), [weights]);
  const selected = ranked.filter((c) => compareIds.includes(c.id));
  const job = getJob(selectedJobId);

  if (selected.length === 0) {
    return (
      <div className="mx-auto flex max-w-5xl flex-col gap-6">
        <PageHeader
          crumbs={[
            { label: "Workspace", to: "/" },
            {
              label: job?.title ?? "Candidates",
              to: "/candidates",
              search: job ? { job: job.id } : undefined,
            },
            { label: "Compare" },
          ]}
          title="Compare candidates"
          description="Pick 2–3 people from the ranking to see them side by side."
        />
        <EmptyState
          icon={Columns3}
          title="No candidates selected"
          description="Open a job ranking, add people to comparison, then return here."
          action={{
            label: "Back to candidates",
            to: "/candidates",
            search: job ? { job: job.id } : undefined,
          }}
        />
      </div>
    );
  }

  const best = selected.reduce((a, b) => (b.score > a.score ? b : a));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <PageHeader
        crumbs={[
          { label: "Workspace", to: "/" },
          ...(job
            ? [
                { label: job.title, to: "/jobs/$jobId", params: { jobId: job.id } },
                { label: "Candidates", to: "/candidates", search: { job: job.id } },
              ]
            : [{ label: "Candidates", to: "/candidates" }]),
          { label: "Compare" },
        ]}
        title="Compare"
        description={`${selected.length} candidates side by side${job ? ` · ${job.title}` : ""}`}
        actions={
          <Button variant="outline" className="shrink-0 rounded-xl" onClick={clearCompare}>
            Clear selection
          </Button>
        }
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {selected.map((c) => (
          <div key={c.id} className="card-surface flex flex-col gap-5 p-5">
            <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ScoreRing value={c.score} size={56} />
                <div className="min-w-0">
                  <p className="flex items-center gap-2 truncate font-bold">
                    {blindMode ? `Candidate #${c.rank}` : c.name}
                    <OriginBadge origin={c.origin} />
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
          {best.gaps[0]!.toLowerCase()} — ask the chat below for interview focus or experience
          comparisons.
        </p>
      </div>

      <CompareChat candidates={selected} blindMode={blindMode} />

      <button
        type="button"
        onClick={() => openCopilot({ jobId: selectedJobId, candidateIds: compareIds })}
        className="inline-flex w-fit items-center gap-1.5 self-start text-sm font-semibold text-primary hover:underline"
      >
        <Sparkles className="h-4 w-4" /> Open full Recruiter Copilot →
      </button>
    </div>
  );
}
