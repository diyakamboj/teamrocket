import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CandidateEnrichmentSection } from "@/components/candidate-enrichment-card";
import { CandidateReadinessSection } from "@/components/candidate-readiness-card";
import { CandidateInterviewSection } from "@/components/interview-card";
import { CandidateNotes } from "@/components/candidate-notes";
import { ShareCandidateButton } from "@/components/share-candidate-button";
import { Eye, EyeOff, Layers, Loader2, AlertTriangle } from "lucide-react";
import { AtsScoreBadge } from "@/components/ats-score-badge";
import {
  getCandidate,
  getCandidateScore,
  type BackendCandidate,
  type CandidateScore,
} from "@/lib/api";

export type CandidateDetailModalProps = {
  candidateId: string | null;
  /** Scores are always relative to a job; without one only the profile shows. */
  jobId?: string | null;
  isOpen: boolean;
  onClose: () => void;
};

function pct(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${Math.round(value)}%`;
}

function skillName(entry: unknown): string {
  if (typeof entry === "string") return entry;
  if (entry && typeof entry === "object") {
    const record = entry as Record<string, unknown>;
    const name = record["skill"] ?? record["name"];
    if (typeof name === "string") return name;
  }
  return String(entry ?? "");
}

export function CandidateDetailModal({
  candidateId,
  jobId,
  isOpen,
  onClose,
}: CandidateDetailModalProps) {
  const [blindReview, setBlindReview] = useState(false);
  const [profile, setProfile] = useState<BackendCandidate | null>(null);
  const [score, setScore] = useState<CandidateScore | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!candidateId || !isOpen) return;

    let cancelled = false;
    setLoading(true);
    setError(null);
    setProfile(null);
    setScore(null);

    Promise.all([
      getCandidate(candidateId),
      jobId ? getCandidateScore(candidateId, jobId).catch(() => null) : Promise.resolve(null),
    ])
      .then(([candidate, evaluation]) => {
        if (cancelled) return;
        setProfile(candidate);
        setScore(evaluation);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load this candidate");
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [candidateId, jobId, isOpen]);

  if (!candidateId) return null;

  const displayName = blindReview ? `Candidate #${candidateId.slice(0, 6)}` : (profile?.name ?? "");
  const overall = score?.overall_score;
  const evidence = score?.dimensions?.["overall_fit"]?.evidence ?? score?.evidence ?? [];

  // De-duplicated: the overall_fit dimension repeats the other dimensions' evidence.
  const seen = new Set<string>();
  const uniqueEvidence = evidence.filter((e) => {
    const key = `${e.skill_name}|${e.resume_text_snippet}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const dimensionCards = [
    { label: "Skills", val: score?.skill_score ?? score?.technical_skills_score },
    { label: "Experience", val: score?.experience_score },
    { label: "Education", val: score?.education_score },
    { label: "Certifications", val: score?.certification_score },
    { label: "Projects", val: score?.project_score },
  ];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="overflow-hidden rounded-xl p-0 shadow-xl sm:max-w-4xl">
        <DialogHeader className="border-b border-border bg-secondary/40 p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                {overall !== undefined && overall !== null && (
                  <AtsScoreBadge score={overall} size={64} />
                )}
                {profile?.employment_status === "bench" && (
                  <Badge variant="outline" className="text-xs font-bold">
                    👥 Internal bench candidate
                  </Badge>
                )}
              </div>

              <DialogTitle className="mt-2 truncate text-xl font-bold">
                {loading ? "Loading…" : displayName || "Candidate"}
              </DialogTitle>
              <DialogDescription className="mt-1 text-xs">
                {[
                  profile?.title,
                  profile?.location,
                  blindReview ? "[Contact redacted]" : profile?.email,
                ]
                  .filter(Boolean)
                  .join(" • ") || "No profile details recorded."}
              </DialogDescription>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {/* Sharing belongs where the candidate is actually reviewed, not
                  only on the list page. */}
              {candidateId && (
                <ShareCandidateButton
                  candidateId={candidateId}
                  candidateName={displayName || "this candidate"}
                  jobId={jobId ?? null}
                />
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setBlindReview((v) => !v)}
                className="gap-1.5 text-xs"
              >
                {blindReview ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {blindReview ? "Blind mode on" : "Blind review"}
              </Button>
            </div>
          </div>
        </DialogHeader>

        <div className="max-h-[70vh] space-y-6 overflow-y-auto p-6">
          {loading ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading candidate evaluation…
            </p>
          ) : error ? (
            <p className="flex items-center justify-center gap-2 py-12 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> {error}
            </p>
          ) : (
            <>
              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  Category scores
                </h3>
                {score ? (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-5">
                    {dimensionCards.map((s) => (
                      <div
                        key={s.label}
                        className="card-surface p-3.5 text-center"
                      >
                        <span className="block text-[10px] font-medium uppercase text-muted-foreground">
                          {s.label}
                        </span>
                        <span className="mt-1 block text-xl font-extrabold">{pct(s.val)}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    No evaluation for this candidate against the selected job yet.
                  </p>
                )}

                {score?.strengths && (
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Strengths:</strong> {score.strengths}
                  </p>
                )}
                {score?.weaknesses && (
                  <p className="text-sm text-muted-foreground">
                    <strong className="text-foreground">Gaps:</strong> {score.weaknesses}
                  </p>
                )}
              </section>

              {profile && profile.skills.length > 0 && (
                <section className="space-y-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
                    Skills
                  </h3>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.skills.map((s, i) => (
                      <Badge key={`${skillName(s)}-${i}`} variant="outline" className="text-xs">
                        {skillName(s)}
                      </Badge>
                    ))}
                  </div>
                </section>
              )}

              <section className="space-y-3">
                <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
                  <Layers className="h-4 w-4 text-primary" /> Explainable evidence tracing (resume
                  snippets)
                </h3>
                {uniqueEvidence.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No evidence snippets recorded for this candidate.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {uniqueEvidence.map((ev, idx) => (
                      <div key={idx} className="card-surface space-y-1 p-3.5">
                        <div className="flex items-center justify-between gap-3 text-xs">
                          <span className="font-semibold">✓ {ev.skill_name}</span>
                          {ev.confidence_score !== null && ev.confidence_score !== undefined && (
                            <Badge variant="outline" className="text-[10px]">
                              {Math.round(ev.confidence_score * 100)}% confidence
                            </Badge>
                          )}
                        </div>
                        <p className="font-mono text-xs italic text-muted-foreground">
                          "{ev.resume_text_snippet}"
                        </p>
                        {ev.source_section && (
                          <span className="text-[10px] text-muted-foreground">
                            Source: {ev.source_section}
                          </span>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <CandidateInterviewSection
                candidateId={candidateId}
                candidateName={displayName}
                candidateEmail={profile?.email ?? null}
                jobId={jobId ?? null}
                jobTitle={null}
              />

              <CandidateEnrichmentSection candidateId={candidateId} />

              <CandidateReadinessSection
                candidateId={candidateId}
                candidateName={displayName}
                jobId={jobId ?? null}
              />

              <CandidateNotes candidateId={candidateId} jobId={jobId ?? null} />
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
