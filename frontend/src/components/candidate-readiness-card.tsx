import { useEffect, useState } from "react";
import { AlertCircle, CheckCircle2, ClipboardCheck, Clock, HelpCircle, Loader2, Send, ShieldAlert, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  evaluateCandidateReadiness,
  listCandidateAssessments,
  submitAssessmentResults,
  triggerCandidateAssessment,
  type AssessmentRecommendation,
  type CandidateAssessmentRecord,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface CandidateReadinessSectionProps {
  candidateId: string;
  candidateName: string;
  jobId?: string | null;
}

export function CandidateReadinessSection({ candidateId, candidateName, jobId }: CandidateReadinessSectionProps) {
  const [recommendation, setRecommendation] = useState<AssessmentRecommendation | null>(null);
  const [assessments, setAssessments] = useState<CandidateAssessmentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [submittingId, setSubmittingId] = useState<string | null>(null);
  const [scoreInput, setScoreInput] = useState<string>("85");
  const [summaryInput, setSummaryInput] = useState<string>("Strong performance on core problem solving.");

  const loadData = async () => {
    try {
      setLoading(true);
      const [rec, list] = await Promise.all([
        evaluateCandidateReadiness(candidateId, jobId),
        listCandidateAssessments(candidateId),
      ]);
      setRecommendation(rec);
      setAssessments(list);
    } catch (err: any) {
      toast.error(err.message || "Failed to load readiness assessment data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [candidateId, jobId]);

  const handleTrigger = async () => {
    if (!recommendation) return;
    try {
      setTriggering(true);
      await triggerCandidateAssessment({
        candidate_id: candidateId,
        job_id: jobId || recommendation.job_id || null,
        assessment_type: recommendation.assessment_type,
        target_competency: recommendation.target_competency,
        recommendation_reason: recommendation.reason,
      });
      toast.success(`Assessment invitation sent to ${candidateName}!`);
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to trigger assessment");
    } finally {
      setTriggering(false);
    }
  };

  const handleSubmitScore = async (assessmentId: string) => {
    try {
      setSubmittingId(assessmentId);
      await submitAssessmentResults(assessmentId, parseFloat(scoreInput) || 80.0, summaryInput);
      toast.success("Assessment score and evaluation history recorded!");
      await loadData();
    } catch (err: any) {
      toast.error(err.message || "Failed to submit assessment results");
    } finally {
      setSubmittingId(null);
    }
  };

  const statusBadge = (status: string) => {
    switch (status) {
      case "sent":
        return <Badge className="bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20"><Send className="h-3 w-3 mr-1" /> Sent / Pending</Badge>;
      case "completed":
        return <Badge className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20"><CheckCircle2 className="h-3 w-3 mr-1" /> Completed</Badge>;
      case "reviewed":
        return <Badge className="bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20"><ClipboardCheck className="h-3 w-3 mr-1" /> Reviewed</Badge>;
      default:
        return <Badge variant="outline"><Clock className="h-3 w-3 mr-1" /> Recommended</Badge>;
    }
  };

  if (loading) {
    return (
      <Card className="border-border/60 shadow-sm">
        <CardContent className="p-6 flex items-center justify-center text-xs text-muted-foreground gap-2">
          <Loader2 className="h-4 w-4 animate-spin" /> Evaluating candidate readiness & assessment eligibility…
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base font-semibold">
              <ClipboardCheck className="h-4 w-4 text-purple-600 dark:text-purple-400" />
              Aptitude & Readiness Notification Workflow
            </CardTitle>
            <CardDescription className="text-xs">
              AI-driven assessment recommendations with recruiter governance ("Approve & Send")
            </CardDescription>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {/* AI RECOMMENDATION BOX */}
        {recommendation && (
          <div className="rounded-xl border border-purple-500/30 bg-purple-500/10 p-4 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 font-semibold text-xs text-purple-700 dark:text-purple-300">
                <Sparkles className="h-4 w-4 shrink-0 text-purple-500" />
                AI Readiness Evaluation: <span className="capitalize">{recommendation.assessment_type.replace("_", " ")}</span> Assessment
              </div>
              <Badge variant="outline" className="text-[10px] uppercase font-mono bg-purple-500/20">
                Target: {recommendation.target_competency}
              </Badge>
            </div>

            <p className="text-xs text-muted-foreground leading-relaxed">
              {recommendation.reason}
            </p>

            <div className="flex items-center justify-between pt-1 border-t border-purple-500/20">
              <span className="text-[11px] text-muted-foreground italic flex items-center gap-1">
                <HelpCircle className="h-3 w-3 text-purple-500" /> Trigger Gap: {recommendation.triggered_by_gap}
              </span>

              <Button
                size="sm"
                onClick={handleTrigger}
                disabled={triggering}
                className="h-8 gap-1.5 rounded-lg text-xs bg-purple-600 hover:bg-purple-700 text-white"
              >
                {triggering ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin" /> Sending…
                  </>
                ) : (
                  <>
                    <Send className="h-3.5 w-3.5" /> Approve & Send Assessment
                  </>
                )}
              </Button>
            </div>
          </div>
        )}

        {/* ASSESSMENT STATUS HISTORY */}
        {assessments.length > 0 && (
          <div className="space-y-3 pt-2">
            <h4 className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-muted-foreground" /> Assessment History & Results
            </h4>

            <div className="space-y-2">
              {assessments.map((item) => (
                <div key={item.id} className="rounded-lg border border-border/80 p-3 bg-card space-y-2 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-foreground">{item.title}</span>
                    {statusBadge(item.status)}
                  </div>

                  <p className="text-muted-foreground text-[11px]">{item.recommendation_reason}</p>

                  {item.status === "sent" && (
                    <div className="rounded-md border border-muted p-2.5 bg-muted/40 space-y-2">
                      <p className="font-medium text-[11px] text-foreground flex items-center gap-1">
                        <AlertCircle className="h-3 w-3 text-amber-500" /> Record Candidate Results (Demo Simulation)
                      </p>
                      <div className="flex gap-2">
                        <Input
                          type="number"
                          placeholder="Score (0-100)"
                          value={scoreInput}
                          onChange={(e) => setScoreInput(e.target.value)}
                          className="h-7 w-28 text-xs"
                        />
                        <Input
                          placeholder="Result summary notes…"
                          value={summaryInput}
                          onChange={(e) => setSummaryInput(e.target.value)}
                          className="h-7 text-xs flex-1"
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => handleSubmitScore(item.id)}
                          disabled={submittingId === item.id}
                          className="h-7 text-xs px-2.5"
                        >
                          {submittingId === item.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Save Results"}
                        </Button>
                      </div>
                    </div>
                  )}

                  {item.status === "completed" && item.score !== undefined && (
                    <div className="flex items-center justify-between bg-emerald-500/10 rounded-md p-2 text-emerald-700 dark:text-emerald-300 font-medium text-[11px]">
                      <span>Assessment Score: <strong>{item.score}/100</strong></span>
                      <span>{item.result_summary}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
