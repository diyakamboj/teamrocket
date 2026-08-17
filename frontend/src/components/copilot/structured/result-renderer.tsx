import type { AgentStructuredPayload } from "@/lib/api";
import { CandidateCard } from "./candidate-card";
import { ComparisonTable } from "./comparison-table";
import { EvaluationSummary } from "./evaluation-summary";
import { MustHaveReport } from "./must-have-report";
import { RankingList } from "./ranking-list";
import { InterviewProposalCard } from "./interview-proposal-card";

export function ResultRenderer({
  structured,
}: {
  structured: (AgentStructuredPayload | Record<string, any>) | null | undefined;
}) {
  if (!structured) return null;

  switch (structured.type) {
    case "candidate_card":
      return <CandidateCard card={structured as any} />;
    case "ranking_list":
      return <RankingList data={structured as any} />;
    case "comparison_table":
      return <ComparisonTable data={structured as any} />;
    case "evaluation_summary":
      return <EvaluationSummary data={structured as any} />;
    case "must_have_report":
      return <MustHaveReport data={structured as any} />;
    case "interview_proposal":
      return <InterviewProposalCard proposal={structured as any} />;
    default:
      return null;
  }
}

