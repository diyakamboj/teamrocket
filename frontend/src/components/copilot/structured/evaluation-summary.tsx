import { Check, X } from "lucide-react";
import type { AgentEvaluationSummary } from "@/lib/api";
import { cn } from "@/lib/utils";
import { CandidateCard } from "./candidate-card";

function verdictMet(status: string | undefined) {
  if (!status) return null;
  const s = status.toLowerCase();
  if (s.includes("met") || s.includes("pass") || s === "yes") return true;
  if (s.includes("not") || s.includes("fail") || s === "no") return false;
  return null;
}

export function EvaluationSummary({ data }: { data: AgentEvaluationSummary }) {
  return (
    <div className="space-y-3">
      <CandidateCard card={data.candidate} />
      {data.verdicts?.length > 0 && (
        <div className="card-surface space-y-2 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Requirement verdicts
          </p>
          <ul className="space-y-2">
            {data.verdicts.map((v, i) => {
              const met = verdictMet(v.status);
              return (
                <li key={i} className="flex items-start gap-2 text-xs">
                  <span
                    className={cn(
                      "mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded-full",
                      met === true &&
                        "bg-success/10 text-success dark:bg-success/15 dark:text-success",
                      met === false &&
                        "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
                      met === null && "bg-secondary text-secondary-foreground",
                    )}
                  >
                    {met === true && <Check className="h-2.5 w-2.5" />}
                    {met === false && <X className="h-2.5 w-2.5" />}
                  </span>
                  <div className="min-w-0">
                    <p className="font-semibold text-foreground">
                      {v.requirement ?? v.category ?? "Requirement"}
                      {v.must ? " (must-have)" : ""}
                    </p>
                    {v.justification && <p className="text-muted-foreground">{v.justification}</p>}
                  </div>
                  {typeof v.score === "number" && (
                    <span className="ml-auto shrink-0 tabular-nums text-muted-foreground">
                      {v.score}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
