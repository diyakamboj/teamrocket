import { useEffect, useState } from "react";
import { ExternalLink as ExternalLinkIcon, Github, Globe, Linkedin, Loader2, RefreshCw, ShieldCheck, Star, Sparkles, Award } from "lucide-react";
import { toast } from "sonner";
import {
  enrichCandidate,
  getCandidate,
  type BackendCandidate,
  type EnrichedProfileData,
} from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

/** Only the fields this card actually renders — so both the ranked-list row
 * and a freshly fetched backend record can be passed in. */
export type EnrichmentSubject = {
  id: string;
  github_url?: string | null;
  linkedin_url?: string | null;
  hackerrank_url?: string | null;
  portfolio_url?: string | null;
  enriched_profile?: EnrichedProfileData | null | undefined;
};

interface CandidateEnrichmentCardProps {
  candidate: EnrichmentSubject;
  onEnriched?: (updated: BackendCandidate) => void;
}

export function CandidateEnrichmentCard({ candidate, onEnriched }: CandidateEnrichmentCardProps) {
  const [enriching, setEnriching] = useState(false);
  const [enriched, setEnriched] = useState<EnrichedProfileData | null>(null);
  const profile = enriched ?? (candidate.enriched_profile as EnrichedProfileData | undefined);

  const handleEnrich = async () => {
    try {
      setEnriching(true);
      const updated = await enrichCandidate(candidate.id);
      setEnriched((updated.enriched_profile as EnrichedProfileData | null) ?? null);
      toast.success("Candidate profile enriched from public sources!");
      if (onEnriched) onEnriched(updated);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to enrich profile");
    } finally {
      setEnriching(false);
    }
  };

  const platformIcon = (platform: string) => {
    switch (platform) {
      case "github":
        return <Github className="h-3.5 w-3.5 text-foreground" />;
      case "linkedin":
        return <Linkedin className="h-3.5 w-3.5 text-primary dark:text-primary" />;
      case "hackerrank":
        return <Award className="h-3.5 w-3.5 text-success dark:text-success" />;
      case "portfolio":
      default:
        return <Globe className="h-3.5 w-3.5 text-primary dark:text-primary" />;
    }
  };

  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between pb-3">
        <div>
          <CardTitle className="flex items-center gap-2 text-base font-semibold">
            <Sparkles className="h-4 w-4 text-warning" />
            Public Profile Signals & Attribution
          </CardTitle>
          <CardDescription className="text-xs">
            Verified external information from GitHub, LinkedIn, HackerRank, and Portfolio links
          </CardDescription>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={handleEnrich}
          disabled={enriching}
          className="h-8 gap-1.5 rounded-lg text-xs"
        >
          {enriching ? (
            <>
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enriching…
            </>
          ) : (
            <>
              <RefreshCw className="h-3.5 w-3.5" /> Run Profile Enrichment
            </>
          )}
        </Button>
      </CardHeader>

      <CardContent className="space-y-4 text-sm">
        {/* DETECTED PLATFORM LINKS */}
        <div className="flex flex-wrap gap-2">
          {candidate.github_url && (
            <a
              href={candidate.github_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border bg-secondary/60 px-3 py-1 text-xs font-medium text-foreground hover:bg-secondary transition-colors"
            >
              {platformIcon("github")} GitHub Profile <ExternalLinkIcon className="h-3 w-3 opacity-60" />
            </a>
          )}
          {candidate.linkedin_url && (
            <a
              href={candidate.linkedin_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border bg-primary/10 border-primary/20 px-3 py-1 text-xs font-medium text-primary dark:text-primary hover:bg-primary/20 transition-colors"
            >
              {platformIcon("linkedin")} LinkedIn Profile <ExternalLinkIcon className="h-3 w-3 opacity-60" />
            </a>
          )}
          {candidate.hackerrank_url && (
            <a
              href={candidate.hackerrank_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border bg-success/10 border-success/20 px-3 py-1 text-xs font-medium text-success dark:text-success hover:bg-success/20 transition-colors"
            >
              {platformIcon("hackerrank")} HackerRank Profile <ExternalLinkIcon className="h-3 w-3 opacity-60" />
            </a>
          )}
          {candidate.portfolio_url && (
            <a
              href={candidate.portfolio_url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border bg-primary/10 border-primary/20 px-3 py-1 text-xs font-medium text-primary dark:text-primary hover:bg-primary/20 transition-colors"
            >
              {platformIcon("portfolio")} Portfolio Website <ExternalLinkIcon className="h-3 w-3 opacity-60" />
            </a>
          )}
          {!candidate.github_url && !candidate.linkedin_url && !candidate.hackerrank_url && !candidate.portfolio_url && (
            <p className="text-xs text-muted-foreground italic">No external profile links detected in resume.</p>
          )}
        </div>

        {/* ENRICHMENT SUMMARY PACK */}
        {profile?.summary && (
          <div className="rounded-xl border border-warning/30 bg-warning/10 p-3.5 text-xs text-foreground space-y-1.5">
            <div className="flex items-center gap-1.5 font-semibold text-warning dark:text-warning">
              <Sparkles className="h-4 w-4 shrink-0" />
              Verified External Profile Summary
            </div>
            <p className="text-muted-foreground">{profile.summary}</p>
          </div>
        )}

        {/* TOP GITHUB REPOSITORIES */}
        {profile?.repositories && profile.repositories.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <Github className="h-3.5 w-3.5" /> Featured Public Repositories (Attributed Source: GitHub)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {profile.repositories.map((repo, i) => (
                <a
                  key={i}
                  href={repo.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-lg border border-border p-2.5 hover:border-primary/50 transition-colors space-y-1 block bg-card"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-xs text-foreground flex items-center gap-1">
                      {repo.name} <ExternalLinkIcon className="h-3 w-3 opacity-50" />
                    </span>
                    {repo.stars > 0 && (
                      <span className="text-xs text-warning font-medium flex items-center gap-0.5">
                        <Star className="h-3 w-3 fill-amber-500 text-warning" /> {repo.stars}
                      </span>
                    )}
                  </div>
                  {repo.description && (
                    <p className="text-xs text-muted-foreground line-clamp-1">{repo.description}</p>
                  )}
                  {repo.language && (
                    <Badge variant="outline" className="text-[11px] py-0 px-1.5 bg-secondary/50">
                      {repo.language}
                    </Badge>
                  )}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* INFERRED SKILLS & SOURCE ATTRIBUTION BADGES */}
        {profile?.inferred_skills && profile.inferred_skills.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold text-foreground flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5 text-success dark:text-success" />
              Verified Skills with Source Attribution
            </p>
            <div className="flex flex-wrap gap-1.5">
              {profile.inferred_skills.map((skill, i) => (
                <Badge
                  key={i}
                  variant="secondary"
                  className="flex items-center gap-1 text-xs py-0.5 px-2 bg-success/10 text-success dark:text-success border-success/20"
                >
                  <span>{skill.name}</span>
                  <span className="text-[9px] uppercase font-semibold text-success bg-success/20 px-1 rounded">
                    {skill.origin}
                  </span>
                </Badge>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/**
 * Loads the candidate's stored record (including any previously enriched
 * profile) from the backend and renders the card for it.
 */
export const CandidateEnrichmentSection = ({ candidateId }: { candidateId: string }) => {
  const [candidate, setCandidate] = useState<BackendCandidate | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCandidate(candidateId)
      .then((c) => {
        if (!cancelled) setCandidate(c);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not load candidate");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [candidateId]);

  if (error) {
    return <p className="px-1 py-3 text-xs text-destructive">{error}</p>;
  }
  if (!candidate) {
    return (
      <p className="flex items-center gap-2 px-1 py-3 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading public profile signals…
      </p>
    );
  }

  return <CandidateEnrichmentCard candidate={candidate} />;
};
