import type { AgentRankingList } from "@/lib/api";
import { CandidateCard } from "./candidate-card";

export function RankingList({ data }: { data: AgentRankingList }) {
  if (!data.candidates || data.candidates.length === 0) return null;
  return (
    <div className="space-y-3">
      {data.candidates.map((card, i) => (
        <CandidateCard key={card.candidate_id ?? `${card.label}-${i}`} card={card} />
      ))}
    </div>
  );
}
