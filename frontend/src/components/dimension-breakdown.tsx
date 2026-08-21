import { BarChart3, CheckCircle2, Sliders, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";

export type CategoryScore = {
  category: string;
  score: number;
  weight: number;
  weightedScore: number;
  highlights: string[];
};

export function DimensionBreakdown({ scores }: { scores: CategoryScore[] }) {
  if (!scores || scores.length === 0) return null;

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" />
          Multi-dimensional ATS breakdown
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {scores.map((s) => (
          <div key={s.category} className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="font-medium text-foreground">{s.category}</span>
              <span className="font-semibold text-primary">
                {s.score.toFixed(0)}/100{" "}
                <span className="text-[11px] text-muted-foreground font-normal">
                  (weight {(s.weight * 100).toFixed(0)}%)
                </span>
              </span>
            </div>
            <Progress value={s.score} className="h-1.5" />
            {s.highlights && s.highlights.length > 0 && (
              <p className="text-xs text-muted-foreground italic">
                {s.highlights.join(" · ")}
              </p>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
