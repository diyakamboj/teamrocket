import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { AgentComparisonTable } from "@/lib/api";

const CATEGORY_ORDER = ["skills", "experience", "education", "certifications", "projects"];

export function ComparisonTable({ data }: { data: AgentComparisonTable }) {
  const candidates = data.candidates ?? [];
  if (candidates.length === 0) return null;

  const categories = CATEGORY_ORDER.filter((cat) =>
    candidates.some((c) => c.categories && cat in c.categories),
  );

  return (
    <div className="card-surface overflow-hidden p-0">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="min-w-[140px]">Candidate</TableHead>
              <TableHead className="text-right">Score</TableHead>
              {categories.map((cat) => (
                <TableHead key={cat} className="text-right capitalize">
                  {cat}
                </TableHead>
              ))}
              <TableHead className="min-w-[180px]">Top gap</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {candidates.map((c, i) => (
              <TableRow key={c.candidate_id ?? `${c.label}-${i}`}>
                <TableCell className="font-semibold">
                  {c.rank ? `#${c.rank} ` : ""}
                  {c.label}
                </TableCell>
                <TableCell className="text-right tabular-nums">{c.score ?? "—"}</TableCell>
                {categories.map((cat) => (
                  <TableCell key={cat} className="text-right tabular-nums text-muted-foreground">
                    {c.categories?.[cat] ?? "—"}
                  </TableCell>
                ))}
                <TableCell className="text-xs text-muted-foreground">
                  {c.gaps?.[0] ?? "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
