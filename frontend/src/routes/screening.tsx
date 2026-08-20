import { createFileRoute } from "@tanstack/react-router";
import { CandidateScreeningSection } from "@/components/screening";

export const Route = createFileRoute("/screening")({
  head: () => ({
    meta: [
      { title: "AI review — ResumeIQ" },
      {
        name: "description",
        content: "AI-guided questions and a pre-interview briefing — no technical skills required.",
      },
    ],
  }),
  component: ScreeningPage,
});

function ScreeningPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">AI review & briefings</h1>
        <p className="text-xs text-muted-foreground">
          AI writes the questions. You capture answers. Interviewers get a briefing.
        </p>
      </div>

      <CandidateScreeningSection
        candidateId="default-candidate"
        candidateName="Selected Candidate"
      />
    </div>
  );
}
