/**
 * The pipeline's column model, shared by the stage board and the pipeline
 * overview so both show a candidate in the same place.
 *
 * A column is a stage, except that "interviewing" expands into one column per
 * round of the job's loop. That is what makes "first interview → last
 * interview → hired" a real progression rather than one undifferentiated
 * "Interviewing" bucket: a candidate's column is (stage, round_id).
 */

import type { PipelineStage } from "@/lib/api";

/**
 * The minimum a round needs for the board. Both a job's own `InterviewRound`
 * and the trimmed `SharedRound` a collaborator receives satisfy this, so the
 * two see identical columns.
 */
export type RoundLike = {
  id: string;
  name: string;
  sequence: number;
  interviewer_name?: string | null;
  interviewer_email?: string | null;
};

export type PipelineColumn = {
  /** Unique per column — `interviewing:<round_id>` for round columns. */
  key: string;
  label: string;
  stage: PipelineStage;
  /** Set only on round columns. */
  roundId?: string;
  /** Who runs this round. Set only on round columns, and only when the job
   *  names one — a hiring manager scanning the board needs to see what is
   *  waiting on them without opening each candidate. */
  interviewerName?: string | undefined;
  interviewerEmail?: string | undefined;
  tone: string;
  /** Rounds and Screened are steps in the loop; Hired/Rejected end it. */
  terminal: boolean;
};

const STAGE_TONE: Record<PipelineStage, string> = {
  screened: "stage-screened",
  interviewing: "stage-interviewing",
  interviewed: "stage-interviewed",
  selected: "stage-selected",
  hired: "stage-hired",
  rejected: "stage-rejected",
};

/** The flat six stages, for tallies and for jobs with no rounds defined. */
export const STAGES: { id: PipelineStage; label: string; tone: string }[] = [
  { id: "screened", label: "Reviewed", tone: STAGE_TONE.screened },
  { id: "interviewing", label: "Interviewing", tone: STAGE_TONE.interviewing },
  { id: "interviewed", label: "Interviewed", tone: STAGE_TONE.interviewed },
  { id: "selected", label: "Selected", tone: STAGE_TONE.selected },
  { id: "hired", label: "Hired", tone: STAGE_TONE.hired },
  { id: "rejected", label: "Rejected", tone: STAGE_TONE.rejected },
];

/**
 * Board columns for a job: Screened → each round in order → Interviewed →
 * Selected → Hired → Rejected. A job with no rounds falls back to the flat
 * stage list, so the board is never empty while the loop is being set up.
 */
export function columnsForJob(
  rounds: readonly RoundLike[] | undefined | null,
): PipelineColumn[] {
  const ordered = [...(rounds ?? [])].sort((a, b) => a.sequence - b.sequence);
  if (ordered.length === 0) {
    return STAGES.map((s) => ({
      key: s.id,
      label: s.label,
      stage: s.id,
      tone: s.tone,
      terminal: s.id === "hired" || s.id === "rejected",
    }));
  }

  return [
    {
      key: "screened",
      label: "Reviewed",
      stage: "screened" as const,
      tone: STAGE_TONE.screened,
      terminal: false,
    },
    ...ordered.map((round) => ({
      key: `interviewing:${round.id}`,
      label: round.name,
      stage: "interviewing" as const,
      roundId: round.id,
      interviewerName: round.interviewer_name ?? undefined,
      interviewerEmail: round.interviewer_email ?? undefined,
      tone: STAGE_TONE.interviewing,
      terminal: false,
    })),
    {
      key: "interviewed",
      label: "Loop complete",
      stage: "interviewed" as const,
      tone: STAGE_TONE.interviewed,
      terminal: false,
    },
    {
      key: "selected",
      label: "Selected",
      stage: "selected" as const,
      tone: STAGE_TONE.selected,
      terminal: false,
    },
    {
      key: "hired",
      label: "Hired",
      stage: "hired" as const,
      tone: STAGE_TONE.hired,
      terminal: true,
    },
    {
      key: "rejected",
      label: "Rejected",
      stage: "rejected" as const,
      tone: STAGE_TONE.rejected,
      terminal: true,
    },
  ];
}

/**
 * The next column along, for a one-click advance.
 *
 * Terminal columns (hired, rejected) have no next, and neither does the last
 * non-terminal one — advancing out of "Selected" is a hire, which should be
 * chosen deliberately rather than reached by repeatedly clicking a button.
 */
export function nextColumn(
  currentKey: string,
  columns: PipelineColumn[],
): PipelineColumn | null {
  const index = columns.findIndex((c) => c.key === currentKey);
  if (index === -1) return null;
  const current = columns[index];
  if (!current || current.terminal) return null;
  const next = columns[index + 1];
  return next && !next.terminal ? next : null;
}

/**
 * Which column a candidate belongs in.
 *
 * A candidate placed in "interviewing" before the loop had rounds — or whose
 * round was since deleted — has no round column to land in, so they fall back
 * to the first one rather than vanishing off the board.
 */
export function columnKeyFor(
  candidate: { stage: PipelineStage; round_id?: string | null | undefined },
  columns: PipelineColumn[],
): string {
  if (candidate.stage !== "interviewing") return candidate.stage;
  const exact = columns.find(
    (c) => c.stage === "interviewing" && c.roundId === candidate.round_id,
  );
  if (exact) return exact.key;
  const firstRound = columns.find((c) => c.stage === "interviewing");
  return firstRound?.key ?? "interviewing";
}
