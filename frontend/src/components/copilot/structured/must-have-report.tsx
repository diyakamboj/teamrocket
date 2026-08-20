import { Trophy } from "lucide-react";
import type { AgentMustHaveReport } from "@/lib/api";

export function MustHaveReport({ data }: { data: AgentMustHaveReport }) {
  return (
    <div className="space-y-3">
      {data.rows?.length > 0 && (
        <div className="card-surface space-y-2 p-4">
          <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
            Must-have coverage
          </p>
          <ul className="space-y-2">
            {data.rows.map((row, i) => (
              <li key={i} className="text-xs">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-foreground">
                    {row.requirement ?? "Requirement"}
                  </span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {row.met_count} met
                  </span>
                </div>
                {row.candidates?.length > 0 && (
                  <p className="mt-0.5 text-muted-foreground">{row.candidates.join(", ")}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.candidates_meeting_all?.length > 0 && (
        <div className="card-surface flex items-start gap-2 p-4">
          <Trophy className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              Meet every must-have
            </p>
            <p className="mt-0.5 text-sm">{data.candidates_meeting_all.join(", ")}</p>
          </div>
        </div>
      )}
    </div>
  );
}
