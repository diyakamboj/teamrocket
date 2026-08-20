import { useEffect, useState } from "react";
import { CheckCircle2, HelpCircle, Loader2, MessageSquare, Send, Sparkles, UserCheck } from "lucide-react";
import { toast } from "sonner";
import {
  createScreeningSession,
  listCandidateScreeningSessions,
  submitScreeningAnswer,
  type ScreeningAnswer,
  type ScreeningQuestion,
  type ScreeningSession,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

interface ScreeningSectionProps {
  candidateId: string;
  candidateName: string;
  jobId?: string | null;
}

export function CandidateScreeningSection({ candidateId, candidateName, jobId }: ScreeningSectionProps) {
  const [sessions, setSessions] = useState<ScreeningSession[]>([]);
  const [activeSession, setActiveSession] = useState<ScreeningSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  // Q&A form state
  const [answersText, setAnswersText] = useState<Record<string, string>>({});
  const [submittingQuestionId, setSubmittingQuestionId] = useState<string | null>(null);

  const fetchSessions = async () => {
    try {
      setLoading(true);
      const res = await listCandidateScreeningSessions(candidateId);
      setSessions(res);
      const latest = res[0];
      if (latest) {
        setActiveSession(latest);
        // Pre-fill existing answers
        const initialAnswers: Record<string, string> = {};
        latest.answers.forEach((a) => {
          initialAnswers[a.question_id] = a.answer_text;
        });
        setAnswersText(initialAnswers);
      }
    } catch (err) {
      console.error("Failed to load screening sessions", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchSessions();
  }, [candidateId]);

  const handleCreateSession = async () => {
    try {
      setCreating(true);
      const res = await createScreeningSession(candidateId, jobId);
      setActiveSession(res);
      toast.success("Started an AI-guided review session");
      void fetchSessions();
    } catch (err: any) {
      toast.error(err.message || "Failed to start review");
    } finally {
      setCreating(false);
    }
  };

  const handleSubmitAnswer = async (q: ScreeningQuestion) => {
    if (!activeSession) return;
    const text = answersText[q.id]?.trim();
    if (!text) {
      toast.error("Please enter an answer before submitting.");
      return;
    }
    try {
      setSubmittingQuestionId(q.id);
      const updated = await submitScreeningAnswer({
        session_id: activeSession.id,
        question_id: q.id,
        answer_text: text,
      });
      setActiveSession(updated);
      toast.success("Answer evaluated and recorded!");
      void fetchSessions();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit answer");
    } finally {
      setSubmittingQuestionId(null);
    }
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <MessageSquare className="h-4 w-4 text-primary" />
            L1 AI review Q&A
          </CardTitle>
          <CardDescription className="text-xs">
            AI writes the questions. You capture answers. The score and briefing write themselves.
          </CardDescription>
        </div>
        <Button
          size="sm"
          onClick={handleCreateSession}
          disabled={creating}
          className="h-8 gap-1.5 rounded-lg text-xs"
        >
          {creating ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Starting…
            </>
          ) : (
            <>
              <Sparkles className="h-3.5 w-3.5" /> Start review
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {loading ? (
          <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading review…
          </div>
        ) : !activeSession ? (
          <div className="rounded-xl border border-dashed p-6 text-center text-xs text-muted-foreground">
            No review session yet. Click “Start review” and AI will generate the questions.
          </div>
        ) : (
          <div className="space-y-4">
            {/* SESSION STATUS HEADER */}
            <div className="flex items-center justify-between rounded-xl bg-secondary/50 p-3 border border-border">
              <div>
                <p className="font-semibold text-xs text-foreground">
                  Review for {activeSession.candidate_name} ({activeSession.job_title || "General Role"})
                </p>
                <p className="text-xs text-muted-foreground">
                  Progress: {activeSession.answers.length} of {activeSession.questions.length} questions answered
                </p>
              </div>
              <Badge
                variant="outline"
                className={`text-[11px] ${
                  activeSession.status === "completed"
                    ? "bg-success/10 text-success dark:text-success border-success/30"
                    : "bg-primary/10 text-primary dark:text-primary border-primary/30"
                }`}
              >
                {activeSession.status === "completed" ? "REVIEWED" : activeSession.status.toUpperCase()}
              </Badge>
            </div>

            {/* PRE-INTERVIEW SUMMARY PACK */}
            {activeSession.summary_pack && (
              <div className="rounded-xl border border-success/30 bg-success/10 p-3.5 text-xs text-foreground space-y-1">
                <div className="flex items-center gap-1.5 font-semibold text-success dark:text-success">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  Pre-Interview Summary Pack Generated
                </div>
                <p className="text-muted-foreground whitespace-pre-line">{activeSession.summary_pack}</p>
              </div>
            )}

            {/* QUESTION CARDS */}
            <div className="space-y-3">
              {activeSession.questions.map((q, idx) => {
                const existingAns = activeSession.answers.find((a) => a.question_id === q.id);
                const isSubmitting = submittingQuestionId === q.id;

                return (
                  <div key={q.id} className="rounded-xl border border-border bg-card p-3.5 space-y-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[11px] bg-background">
                          Q{idx + 1} · {q.category}
                        </Badge>
                      </div>
                      {existingAns && (
                        <span className="text-xs font-semibold text-success dark:text-success flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" /> Evaluated ({existingAns.score.toFixed(0)}/100)
                        </span>
                      )}
                    </div>

                    <p className="font-semibold text-xs text-foreground">{q.question}</p>
                    <p className="text-xs text-muted-foreground italic">Intent: {q.intent}</p>

                    <div className="pt-1">
                      <Textarea
                        placeholder="Enter candidate's response or notes..."
                        value={answersText[q.id] || ""}
                        onChange={(e) => setAnswersText({ ...answersText, [q.id]: e.target.value })}
                        rows={2}
                        className="text-xs rounded-lg"
                      />
                      <div className="mt-2 flex items-center justify-between">
                        {existingAns?.feedback ? (
                          <p className="text-xs text-muted-foreground">
                            <span className="font-medium text-foreground">AI Feedback:</span> {existingAns.feedback}
                          </p>
                        ) : (
                          <span />
                        )}
                        <Button
                          size="sm"
                          onClick={() => handleSubmitAnswer(q)}
                          disabled={isSubmitting}
                          className="h-7 text-xs gap-1.5 ml-auto"
                        >
                          {isSubmitting ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          Save & Evaluate
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
