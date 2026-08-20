import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import { UnclassifiedRoles } from "@/components/unclassified-roles";
import {
  JobGrid,
  StatTile,
  WorkspaceHeader,
  countInStage,
  countTopMatches,
  useJobWorkspace,
  useWorkspaceTotals,
  useUnclassifiedJobs,
} from "@/components/hiring-workspace";

export const Route = createFileRoute("/external-hiring")({
  head: () => ({
    meta: [
      { title: "External Hiring — ResumeIQ" },
      {
        name: "description",
        content:
          "Manage public job postings, external applicant funnels, and sourcing analytics.",
      },
    ],
  }),
  component: ExternalHiringPage,
});

function ExternalHiringPage() {
  const [activeTab, setActiveTab] = useState<"active" | "insights">("active");
  const { jobs, loading, error } = useJobWorkspace("external");
  const totals = useWorkspaceTotals(jobs);
  const unclassified = useUnclassifiedJobs();

  const tabs = [
    { id: "active" as const, label: `Active external jobs (${jobs.length})` },
    { id: "insights" as const, label: "External applicant analytics" },
  ];

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <WorkspaceHeader
        eyebrow="External Applicant Recruitment Workspace"
        icon={<Globe className="h-4 w-4" />}
        title="External Hiring"
        subtitle="Manage public job postings, candidate applicant funnels, and external sourcing analytics."
        createLabel="Create external job"
      />

      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={cn(
              "rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-colors",
              activeTab === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === "active" && (
        <>
          <UnclassifiedRoles
            jobs={unclassified.jobs}
            onClassified={unclassified.refresh}
          />

          <JobGrid
            jobs={jobs}
            loading={loading}
            error={error}
            emptyMessage="No jobs have external applicants yet. Upload resumes to start a funnel."
            metrics={(job) => [
              { label: "Applicants", value: job.pipeline.length },
              { label: "Top matches", value: countTopMatches(job), tone: "text-primary" },
              {
                label: "In interview",
                value: countInStage(job, ["interviewing", "interviewed"]),
                tone: "text-success",
              },
            ]}
          />
        </>
      )}

      {activeTab === "insights" && (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          <StatTile
            label="External applicants"
            value={String(totals.candidates)}
            hint={`Across ${jobs.length} job${jobs.length === 1 ? "" : "s"} with an external funnel.`}
          />
          <StatTile
            label="Average match score"
            value={`${totals.averageScore}%`}
            hint="Mean ATS score across scored external applicants."
          />
          <StatTile
            label="Top-quality matches"
            value={String(totals.topMatches)}
            hint="Applicants scoring 85% or higher against their job's requirements."
          />
        </div>
      )}
    </div>
  );
}
