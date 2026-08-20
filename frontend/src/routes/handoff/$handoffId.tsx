import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CheckCircle2, Clock, Loader2, Sparkle, UserCheck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { MiniBar, ScoreRing } from "@/components/score-ring";
import { acknowledgeHandoff, markHandoffViewed, type InterviewHandoffRecord } from "@/lib/api";
import { CandidateInterviewSection } from "@/components/interview-card";


export const Route = createFileRoute("/handoff/$handoffId")({
  head: () => ({
    meta: [
      { title: "Candidate Briefing — ResumeIQ" },
      {
        name: "description",
        content: "Candidate summary briefing handed off for a technical interview.",
      },
    ],
  }),
  component: HandoffView,
});

function skillLabel(item: unknown): string {
  if (typeof item === "string") return item;
  if (item && typeof item === "object" && "skill" in item) {
    return String((item as { skill?: unknown }).skill ?? "");
  }
  return String(item);
}

function HandoffView() {
  const { handoffId } = Route.useParams();
  const [handoff, setHandoff] = useState<InterviewHandoffRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [notes, setNotes] = useState("");
  const [acknowledging, setAcknowledging] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const viewed = await markHandoffViewed(handoffId);
        if (!cancelled) {
          setHandoff(viewed);
          setNotes(viewed.interviewer_notes ?? "");
        }
      } catch {
        if (!cancelled) setNotFound(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [handoffId]);

  async function handleAcknowledge() {
    if (!handoff) return;
    setAcknowledging(true);
    try {
      const updated = await acknowledgeHandoff(handoff.id, notes.trim() || undefined);
      setHandoff(updated);
      toast.success("Briefing acknowledged");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not acknowledge briefing");
    } finally {
      setAcknowledging(false);
    }
  }

  if (loading) {
    return (
      <div className="mx-auto flex max-w-3xl items-center justify-center gap-2 py-24 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading briefing…
      </div>
    );
  }

  if (notFound || !handoff) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="card-surface p-10">
          <h1 className="text-xl font-bold">Briefing not found</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This link may have expired or the briefing was removed.
          </p>
          <Link
            to="/"
            className="mt-6 inline-flex rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground"
          >
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  }

  const b = handoff.briefing;
  const sc = b.scorecard;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <header className="card-surface flex flex-wrap items-center gap-4 p-6">
        {typeof sc.overall_score === "number" && (
          <ScoreRing value={Math.round(sc.overall_score)} size={64} />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-extrabold">{handoff.candidate_name}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {handoff.job_title ?? "Open role"} · Briefed by {handoff.created_by ?? "recruiter"}
          </p>
        </div>
        {handoff.status === "acknowledged" ? (
          <Badge className="gap-1 border-transparent bg-success/10 text-success dark:bg-success/15 dark:text-success">
            <CheckCircle2 className="h-3 w-3" /> Acknowledged
          </Badge>
        ) : handoff.status === "viewed" ? (
          <Badge className="gap-1 border-transparent bg-primary/10 text-primary dark:bg-primary/15 dark:text-primary">
            <UserCheck className="h-3 w-3" /> Viewed
          </Badge>
        ) : (
          <Badge variant="secondary" className="gap-1">
            <Clock className="h-3 w-3" /> Pending
          </Badge>
        )}
      </header>

      {(sc.skill_score != null ||
        sc.experience_score != null ||
        sc.education_score != null ||
        sc.certification_score != null ||
        sc.project_score != null) && (
        <section className="card-surface grid gap-4 p-5 sm:grid-cols-2">
          {sc.skill_score != null && <MiniBar label="Skills" value={Math.round(sc.skill_score)} />}
          {sc.experience_score != null && (
            <MiniBar label="Experience" value={Math.round(sc.experience_score)} />
          )}
          {sc.education_score != null && (
            <MiniBar label="Education" value={Math.round(sc.education_score)} />
          )}
          {sc.certification_score != null && (
            <MiniBar label="Certifications" value={Math.round(sc.certification_score)} />
          )}
          {sc.project_score != null && (
            <MiniBar label="Projects" value={Math.round(sc.project_score)} />
          )}
        </section>
      )}

      <section className="card-surface grid gap-6 p-5 sm:grid-cols-2">
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Strengths
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{b.strengths || "Not noted"}</p>
        </div>
        <div>
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Weaknesses
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{b.weaknesses || "Not noted"}</p>
        </div>
        {b.transferable_skills && (
          <div className="sm:col-span-2">
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Transferable skills
            </p>
            <p className="mt-2 text-sm text-muted-foreground">{b.transferable_skills}</p>
          </div>
        )}
      </section>

      {b.matched_skills.length > 0 && (
        <section className="card-surface p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Matched skills
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {b.matched_skills.map((s, i) => (
              <span
                key={i}
                className="rounded-full bg-primary-soft px-2.5 py-0.5 text-xs font-medium text-primary-soft-foreground"
              >
                {skillLabel(s)}
              </span>
            ))}
          </div>
        </section>
      )}

      {b.interview_focus_areas.length > 0 && (
        <section className="card-surface p-5">
          <div className="flex items-center gap-2">
            <Sparkle className="h-4 w-4 text-primary" />
            <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
              Suggested interview focus
            </p>
          </div>
          <ul className="mt-2 space-y-1.5 text-sm">
            {b.interview_focus_areas.map((area, i) => (
              <li key={i} className="flex gap-2 text-muted-foreground">
                <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {area}
              </li>
            ))}
          </ul>
        </section>
      )}

      {b.evidence_highlights.length > 0 && (
        <section className="card-surface p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Evidence highlights
          </p>
          <ul className="mt-2 space-y-1.5 text-sm text-muted-foreground">
            {b.evidence_highlights.map((e, i) => (
              <li key={i}>• {String(e)}</li>
            ))}
          </ul>
        </section>
      )}

      {b.recruiter_notes && (
        <section className="card-surface p-5">
          <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Recruiter notes
          </p>
          <p className="mt-2 text-sm text-muted-foreground">{b.recruiter_notes}</p>
        </section>
      )}

      <CandidateInterviewSection
        candidateId={b.candidate_id}
        candidateName={b.candidate_name}
        candidateEmail={b.candidate_email ?? null}
        jobId={b.job_id ?? null}
        jobTitle={b.job_title ?? null}
      />

      <section className="card-surface space-y-3 p-5">

        <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
          Your notes
        </p>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Interview takeaways, follow-up questions, scorecard notes…"
          rows={4}
          className="rounded-xl"
        />
        <Button
          onClick={() => void handleAcknowledge()}
          disabled={acknowledging}
          className="rounded-xl"
        >
          {acknowledging ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <CheckCircle2 className="mr-2 h-4 w-4" />
          )}
          {handoff.status === "acknowledged" ? "Update acknowledgement" : "Acknowledge briefing"}
        </Button>
        {handoff.acknowledged_at && (
          <p className="text-xs text-muted-foreground">
            Last acknowledged {new Date(`${handoff.acknowledged_at}Z`).toLocaleString()}
          </p>
        )}
      </section>
    </div>
  );
}
