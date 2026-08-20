import { EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import type { Weights } from "@/lib/candidates";

const WEIGHT_KEYS = ["skills", "experience", "education", "certifications", "projects"] as const;

/**
 * Shared score-weights control, single-sourced so the Dashboard's "Adjust
 * score weights" quick action and the Candidate Ranking page's sticky panel
 * render identical markup and stay in sync automatically (both read/write
 * the same app-state `weights`).
 */
export function WeightsEditor({
  weights,
  setWeights,
  onReset,
  blindMode,
  setBlindMode,
  className,
}: {
  weights: Weights;
  setWeights: (w: Weights) => void;
  onReset: () => void;
  blindMode?: boolean;
  setBlindMode?: (v: boolean) => void;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="space-y-5">
        {WEIGHT_KEYS.map((key) => (
          <div key={key}>
            <div className="mb-2 flex items-center justify-between text-xs">
              <span className="font-semibold capitalize">{key}</span>
              <span className="tabular-nums text-muted-foreground">{weights[key]}%</span>
            </div>
            <Slider
              value={[weights[key]]}
              max={100}
              step={5}
              onValueChange={(v) => setWeights({ ...weights, [key]: v[0] ?? 0 })}
            />
          </div>
        ))}

        <Button variant="outline" size="sm" className="w-full rounded-xl" onClick={onReset}>
          Reset weights
        </Button>

        {setBlindMode && (
          <div className="flex items-center justify-between gap-3 rounded-xl bg-secondary/60 p-3">
            <div className="flex min-w-0 items-center gap-2">
              <EyeOff className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">Blind review</p>
                <p className="truncate text-xs text-muted-foreground">
                  Hides names & contact info
                </p>
              </div>
            </div>
            <Switch checked={!!blindMode} onCheckedChange={setBlindMode} />
          </div>
        )}
      </div>
    </div>
  );
}
