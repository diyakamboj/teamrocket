import { createFileRoute, Link } from "@tanstack/react-router";
import { Globe, PlusCircle, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { UnclassifiedRoles } from "@/components/unclassified-roles";
import { HiringFlow, StepActions, type FlowStep } from "@/components/hiring-flow";
import {
  JobGrid,
  StatTile,
  countInStage,
  countTopMatches,
  useJobWorkspace,
  useWorkspaceTotals,
  useUnclassifiedJobs,
} from "@/components/hiring-workspace";
import { openCreateJob } from "@/lib/app-events";

export const Route = createFileRoute("/external-hiring")({
  head: () => ({
    meta: [
      { title: "Hiring from outside — ResumeIQ" },
      {
        name: "description",
        content: "Post a role, collect applicants, and review who fits — one step at a time.",
      },
    ],
  }),
  component: ExternalHiringPage,
});

function ExternalHiringPage() {
  const { jobs, loading, error } = useJobWorkspace("external");
  const totals = useWorkspaceTotals(jobs);
  const unclassified = useUnclassifiedJobs();

  const applicants = jobs.reduce((sum, job) => sum + job.pipeline.length, 0);
  const scored = jobs.reduce(
    (sum, job) => sum + job.pipeline.filter((p) => p.overall_score != null).length,
    0,
  );
  const advanced = jobs.reduce(
    (sum, job) => sum + countInStage(job, ["interviewing", "interviewed", "selected", "hired"]),
    0,
  );

  const steps: FlowStep[] = [
    {
      id: "role",
      title: "Post the role",
      blurb: "Paste a job description — the skills and questions are pulled out for you.",
      done: jobs.length > 0,
      summary: jobs.length > 0 ? `${jobs.length} open` : undefined,
      body: (
        <>
          <UnclassifiedRoles jobs={unclassified.jobs} onClassified={unclassified.refresh} />
          <JobGrid
            jobs={jobs}
            loading={loading}
            error={error}
            emptyMessage="No outside roles yet. Create one to start collecting applicants."
            metrics={(job) => [
              { label: "Applicants", value: job.pipeline.length },
              { label: "Strong matches", value: countTopMatches(job), tone: "text-primary" },
              {
                label: "Interviewing",
                value: countInStage(job, ["interviewing", "interviewed"]),
                tone: "text-success",
              },
            ]}
          />
          <StepActions>
            <Button onClick={openCreateJob} className="press-fx ripple">
              <PlusCircle className="mr-1.5 h-3.5 w-3.5" /> Create a role
            </Button>
          </StepActions>
        </>
      ),
    },
    {
      id: "applicants",
      title: "Add applicants",
      blurb: "Drop in résumés. Each one is read and scored against the role automatically.",
      done: applicants > 0,
      summary: applicants > 0 ? `${applicants} added` : undefined,
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            {applicants > 0
              ? `${applicants} applicant${applicants === 1 ? "" : "s"} across your outside roles.`
              : "Upload as many résumés as you have — they are parsed and scored as they arrive."}
          </p>
          <StepActions>
            <Link to="/upload">
              <Button variant={applicants > 0 ? "outline" : "default"} className="press-fx">
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Upload résumés
              </Button>
            </Link>
          </StepActions>
        </>
      ),
    },
    {
      id: "review",
      title: "Review who fits",
      blurb: "One score per applicant, with the line from the résumé behind it.",
      done: scored > 0,
      summary: scored > 0 ? `${totals.topMatches} strong` : undefined,
      body: (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <StatTile label="Applicants" value={String(totals.candidates)} hint="Across your outside roles." />
            <StatTile label="Scored" value={String(scored)} hint="Read and rated against a role." />
            <StatTile
              label="Strong matches"
              value={String(totals.topMatches)}
              hint="Scoring 85 or higher."
            />
          </div>
          <StepActions>
            <Link to="/candidates">
              <Button variant="outline" className="press-fx">
                Review applicants
              </Button>
            </Link>
          </StepActions>
        </>
      ),
    },
    {
      id: "advance",
      title: "Move them forward",
      blurb: "Advance the ones who pass through your interview rounds.",
      done: advanced > 0,
      summary: advanced > 0 ? `${advanced} in progress` : undefined,
      body: (
        <>
          <p className="text-sm text-muted-foreground">
            {advanced > 0
              ? `${advanced} applicant${advanced === 1 ? "" : "s"} are in or past an interview.`
              : "Open a role to drag applicants through its interview rounds on the board."}
          </p>
          <StepActions>
            {jobs[0] && (
              <Link to="/jobs/$jobId" params={{ jobId: String(jobs[0].job_id) }}>
                <Button variant="outline" className="press-fx">
                  Open the board
                </Button>
              </Link>
            )}
          </StepActions>
        </>
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-4xl space-y-6 pb-12">
      <header className="border-b border-border pb-5">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-primary">
          <Globe className="h-4 w-4" /> Hiring from outside
        </div>
        <h1 className="mt-1 text-2xl font-bold tracking-tight">Fill a role from outside</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
          Four steps, in order. Each one ticks itself off as you go — you can open any of them at
          any time.
        </p>
      </header>

      <HiringFlow steps={steps} />
    </div>
  );
}
