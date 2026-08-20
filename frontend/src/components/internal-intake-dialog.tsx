import { useEffect, useState } from "react";
import { Building2, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type InternalIntake = { position: string | null; duties: string | null };

/**
 * Asked once before internal résumés are uploaded.
 *
 * A résumé lists the roles someone *held*; for an employee already here, the
 * thing a recruiter actually needs is the role they hold *now*, and what
 * they do in it. That is not in the file, so it has to be asked — and only
 * for internal intake, where the question makes sense.
 */
export function InternalIntakeDialog({
  open,
  fileCount,
  jobTitle,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  fileCount: number;
  jobTitle: string;
  onCancel: () => void;
  onConfirm: (intake: InternalIntake) => void;
}) {
  const [position, setPosition] = useState("");
  const [duties, setDuties] = useState("");

  // Each batch is a different person; carrying the last answer over would
  // quietly mislabel them.
  useEffect(() => {
    if (open) {
      setPosition("");
      setDuties("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="mb-2 grid h-9 w-9 place-items-center rounded-lg bg-primary-soft text-primary">
            <Building2 className="h-4 w-4" />
          </div>
          <DialogTitle>Where do they work today?</DialogTitle>
          <DialogDescription>
            {fileCount === 1 ? "This résumé is" : `These ${fileCount} résumés are`} going to{" "}
            <span className="font-medium text-foreground">{jobTitle}</span>, an internal role. A
            résumé shows past jobs, not the one they hold here now.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          <div className="space-y-1.5">
            <label htmlFor="internal-position" className="text-sm font-medium">
              Current role in the company
            </label>
            <Input
              id="internal-position"
              autoFocus
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="e.g. Software Engineer II, Platform team"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="internal-duties" className="text-sm font-medium">
              What they do in it <span className="text-muted-foreground">(optional)</span>
            </label>
            <Textarea
              id="internal-duties"
              value={duties}
              onChange={(e) => setDuties(e.target.value)}
              placeholder="Owns the billing service, mentors two juniors…"
              rows={3}
            />
            <p className="text-xs text-muted-foreground">
              Helps you judge whether this move is a step up or a repeat of what they already do.
            </p>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            className="press-fx"
            onClick={() =>
              onConfirm({
                position: position.trim() || null,
                duties: duties.trim() || null,
              })
            }
          >
            {fileCount === 1 ? "Upload résumé" : `Upload ${fileCount} résumés`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Small inline spinner used while the batch is in flight. */
export function IntakeSpinner() {
  return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
}
