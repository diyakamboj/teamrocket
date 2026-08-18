import { createFileRoute } from "@tanstack/react-router";
import { CandidateScreeningSection } from "@/components/screening";

export const Route = createFileRoute("/screening")({
  head: () => ({
    meta: [
      { title: "Preliminary Screening (L1) — ResumeIQ" },
      {
        name: "description",
        content: "Conduct AI-guided preliminary technical screening and generate pre-interview summary packs.",
      },
    ],
  }),
  component: ScreeningPage,
});

function ScreeningPage() {
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-bold">L1 Preliminary Screening & Briefings</h1>
        <p className="text-xs text-muted-foreground">
          Conduct preliminary Q&A evaluations and compile summary packs for interview loops
        </p>
      </div>

      <CandidateScreeningSection
        candidateId="default-candidate"
        candidateName="Selected Candidate"
      />
    </div>
  );
}
