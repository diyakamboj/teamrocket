import type { AgentStructuredPayload } from "@/lib/api";
import { CandidateCard } from "./candidate-card";
import { ComparisonTable } from "./comparison-table";
import { EvaluationSummary } from "./evaluation-summary";
import { MustHaveReport } from "./must-have-report";
import { RankingList } from "./ranking-list";

export function ResultRenderer({
  structured,
}: {
  structured: AgentStructuredPayload | null | undefined;
}) {
  if (!structured) return null;

  switch (structured.type) {
    case "candidate_card":
      return <CandidateCard card={structured} />;
    case "ranking_list":
      return <RankingList data={structured} />;
    case "comparison_table":
      return <ComparisonTable data={structured} />;
    case "evaluation_summary":
      return <EvaluationSummary data={structured} />;
    case "must_have_report":
      return <MustHaveReport data={structured} />;
    default:
      return null;
  }
}
