import { ChevronDown, Loader2, MessagesSquare, RefreshCw, Sparkles } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  generateRoundQuestions,
  getRoundQuestions,
  type InterviewQuestion,
  type QuestionAudience,
  type QuestionDifficulty,
  type RoundQuestionSet,
} from "@/lib/api";
import { cn } from "@/lib/utils";

const AUDIENCES: { id: QuestionAudience; label: string; blurb: string }[] = [
  {
    id: "non_technical",
    label: "For a recruiter",
    blurb: "Answerable and gradable without domain expertise.",
  },
  {
    id: "technical",
    label: "For a technical interviewer",
    blurb: "Depth and judgement, for someone who can evaluate it.",
  },
];

const DIFFICULTY_ORDER: QuestionDifficulty[] = ["easy", "medium", "hard"];

const DIFFICULTY_TONE: Record<QuestionDifficulty, string> = {
  easy: "bg-success/15 text-success",
  medium: "bg-warning/20 text-warning-foreground dark:text-warning",
  hard: "bg-destructive/15 text-destructive",
};

/**
 * The question bank for one interview round.
 *
 * Every question carries the answer you are listening for. That is the part
 * that makes this usable by whoever is actually running the call: a
 * recruiter screening for a backend role is generally not the person who
 * could grade a systems answer unaided, and a list of questions without
 * answers leaves them reading from a script they cannot score.
 */
export function RoundQuestions({
  jobId,
  roundId,
  roundName,
}: {
  jobId: string;
  roundId: string;
  roundName: string;
}) {
  const [bank, setBank] = useState<RoundQuestionSet | null>(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [audience, setAudience] = useState<QuestionAudience>("non_technical");
  const [open, setOpen] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setBank(await getRoundQuestions(jobId, roundId));
    } catch {
      setBank(null);
    } finally {
      setLoading(false);
    }
  }, [jobId, roundId]);

  useEffect(() => {
    void load();
  }, [load]);

  async function generate(refresh: boolean) {
    setWorking(true);
    try {
      const next = await generateRoundQuestions(jobId, roundId, refresh);
      setBank(next);
      toast.success(
        next.generated_by_ai
          ? `Questions ready for ${roundName}`
          : `Using the built-in questions for ${roundName}`,
        {
          description: next.generated_by_ai
            ? undefined
            : "The model did not return a usable set, so these are generic rather than written for this role.",
        },
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not generate questions");
    } finally {
      setWorking(false);
    }
  }

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-6 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Checking for questions…
      </p>
    );
  }

  if (!bank) {
    return (
      <div className="rounded-xl border border-dashed px-4 py-8 text-center">
        <MessagesSquare className="mx-auto h-6 w-6 text-muted-foreground" />
        <p className="mt-2 text-sm font-semibold">No questions for {roundName} yet</p>
        <p className="mx-auto mt-1 max-w-md text-xs text-muted-foreground">
          Generate a set written for this role, at three difficulties, each with the answer you
          should be listening for.
        </p>
        <Button
          size="sm"
          disabled={working}
          onClick={() => void generate(false)}
          className="press mt-4 gap-1.5 rounded-xl text-xs"
        >
          {working ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          Generate questions
        </Button>
      </div>
    );
  }

  const shown = bank.questions.filter((q) => q.audience === audience);

  return (
    <div className="flow-stack">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1.5">
          {AUDIENCES.map((option) => (
            <button
              key={option.id}
              type="button"
              onClick={() => setAudience(option.id)}
              title={option.blurb}
              className={cn(
                "press rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors",
                audience === option.id
                  ? "bg-primary-soft text-primary-soft-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>

        <Button
          size="sm"
          variant="outline"
          disabled={working}
          onClick={() => void generate(true)}
          className="press gap-1.5 rounded-xl text-xs"
        >
          {working ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
          Regenerate
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        {AUDIENCES.find((a) => a.id === audience)?.blurb}
        {!bank.generated_by_ai && (
          <span className="ml-1 text-warning-foreground dark:text-warning">
            These are the built-in questions, not written for this role.
          </span>
        )}
      </p>

      <ol className="flex flex-col gap-2">
        {DIFFICULTY_ORDER.flatMap((level) =>
          shown
            .filter((q) => q.difficulty === level)
            .map((question) => (
              <QuestionRow
                key={question.id}
                question={question}
                expanded={open === question.id}
                onToggle={() => setOpen(open === question.id ? null : question.id)}
              />
            )),
        )}
      </ol>
    </div>
  );
}

function QuestionRow({
  question,
  expanded,
  onToggle,
}: {
  question: InterviewQuestion;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className="surface-lift overflow-hidden">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 p-4 text-left"
      >
        <span
          className={cn(
            "shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
            DIFFICULTY_TONE[question.difficulty],
          )}
        >
          {question.difficulty}
        </span>
        <span className="min-w-0 flex-1 text-sm font-medium">{question.question}</span>
        <ChevronDown
          className={cn(
            "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-300",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div className="flex flex-col gap-3 border-t border-border bg-secondary/40 px-4 py-4">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
              What a good answer sounds like
            </p>
            <p className="mt-1 text-sm leading-relaxed">{question.model_answer}</p>
          </div>

          {question.signals.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                Listen for
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {question.signals.map((signal) => (
                  <li key={signal} className="flex gap-2 text-xs text-muted-foreground">
                    <span aria-hidden className="text-primary">
                      ·
                    </span>
                    {signal}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {question.follow_ups.length > 0 && (
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">
                If you want to go further
              </p>
              <ul className="mt-1 flex flex-col gap-1">
                {question.follow_ups.map((followUp) => (
                  <li key={followUp} className="text-xs text-muted-foreground">
                    “{followUp}”
                  </li>
                ))}
              </ul>
            </div>
          )}

          {question.competency && (
            <p className="text-[11px] text-muted-foreground">
              Probes: <span className="font-medium text-foreground">{question.competency}</span>
            </p>
          )}
        </div>
      )}
    </li>
  );
}
