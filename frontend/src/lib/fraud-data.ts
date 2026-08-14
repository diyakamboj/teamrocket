import { CANDIDATES, type Candidate } from "@/lib/mock-data";
import type { FraudCheckSource, FraudScreenCandidateInput, FraudScreenResult } from "@/lib/api";

export type FraudStatus = "verified" | "suspicious" | "fraud";

export type FraudSignal = {
  id: string;
  label: string;
  severity: "low" | "medium" | "high";
};

export type FraudAssessment = {
  candidate: Candidate;
  status: FraudStatus;
  riskScore: number;
  signals: FraudSignal[];
  summary: string;
  checks: {
    identity: boolean;
    employment: boolean;
    education: boolean;
    location: boolean;
    sanctions: boolean;
  };
  /** How each check was produced. Absent for pure client-side heuristic fallback. */
  sources?: Record<
    "identity" | "employment" | "education" | "location" | "sanctions",
    FraudCheckSource
  >;
  details?: FraudScreenResult["details"];
};

function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h;
}

export function assessCandidate(candidate: Candidate): FraudAssessment {
  const seed = hashSeed(candidate.id);
  const signals: FraudSignal[] = [];
  let risk = 12 + (seed % 18);

  // Background-verification style heuristics on profile signals
  if (candidate.years >= 12 && candidate.categories.experience < 45) {
    risk += 28;
    signals.push({
      id: "exp-mismatch",
      label: "Claimed tenure does not match experience evidence",
      severity: "high",
    });
  }

  if (candidate.categories.certifications < 35 && candidate.skills.length >= 6) {
    risk += 14;
    signals.push({
      id: "cert-gap",
      label: "Skill claims lack certification / credential trail",
      severity: "medium",
    });
  }

  if (candidate.gaps.some((g) => g.toLowerCase().includes("certification"))) {
    risk += 10;
    signals.push({
      id: "credential-gap",
      label: "Background check found thin credential history",
      severity: "medium",
    });
  }

  if (candidate.email.endsWith("@mail.com") && seed % 5 === 0) {
    risk += 22;
    signals.push({
      id: "identity-reuse",
      label: "Identity markers overlap with known disposable patterns",
      severity: "high",
    });
  }

  if (candidate.categories.projects < 40 && candidate.score > 80) {
    risk += 16;
    signals.push({
      id: "project-inflate",
      label: "High match score with weak project provenance",
      severity: "medium",
    });
  }

  if (seed % 17 === 0) {
    risk += 35;
    signals.push({
      id: "sanctions-flag",
      label: "Possible sanctions / OFAC watchlist collision",
      severity: "high",
    });
  }

  if (seed % 11 === 0) {
    risk += 18;
    signals.push({
      id: "location-spoof",
      label: "Location / IP signals inconsistent with claimed city",
      severity: "medium",
    });
  }

  if (signals.length === 0) {
    signals.push({
      id: "clean",
      label: "Identity, employment, and education checks passed",
      severity: "low",
    });
  }

  risk = Math.min(98, risk);

  let status: FraudStatus = "verified";
  if (risk >= 70) status = "fraud";
  else if (risk >= 42) status = "suspicious";

  const checks = {
    identity: status !== "fraud" && !signals.some((s) => s.id === "identity-reuse"),
    employment: !signals.some((s) => s.id === "exp-mismatch"),
    education: candidate.categories.education >= 50,
    location: !signals.some((s) => s.id === "location-spoof"),
    sanctions: !signals.some((s) => s.id === "sanctions-flag"),
  };

  const summary =
    status === "fraud"
      ? "Background verification failed. High-confidence fraud indicators detected — do not advance."
      : status === "suspicious"
        ? "Partial verification. Manual review recommended before interview."
        : "Background verification passed. Identity and history look consistent.";

  return { candidate, status, riskScore: risk, signals, summary, checks };
}

export function assessAllCandidates(list: Candidate[] = CANDIDATES): FraudAssessment[] {
  return list.map(assessCandidate).sort((a, b) => b.riskScore - a.riskScore);
}

export function fraudStats(assessments: FraudAssessment[]) {
  const verified = assessments.filter((a) => a.status === "verified").length;
  const suspicious = assessments.filter((a) => a.status === "suspicious").length;
  const fraud = assessments.filter((a) => a.status === "fraud").length;
  return {
    total: assessments.length,
    verified,
    suspicious,
    fraud,
    clearRate: assessments.length ? Math.round((verified / assessments.length) * 100) : 0,
  };
}

const EMPLOYER_RE = /@\s*([A-Za-z][\w&.,'-]*(?:\s[A-Za-z][\w&.,'-]*)*)\s*$/;

/** Best-effort employer names extracted from a candidate's evidence sources
 * (e.g. "Platform Team @ Northwind" -> "Northwind"), for real employer-registry
 * verification. Free-text sources without an "@ Company" pattern are skipped
 * rather than guessed at. */
export function extractEmployers(candidate: Candidate): string[] {
  const found = new Set<string>();
  for (const e of candidate.evidence) {
    const m = e.source.match(EMPLOYER_RE);
    if (m?.[1]) found.add(m[1].trim());
  }
  return [...found];
}

export function toFraudScreenInput(candidate: Candidate): FraudScreenCandidateInput {
  return {
    id: candidate.id,
    name: candidate.name,
    email: candidate.email,
    employers: extractEmployers(candidate),
    education: candidate.education ? [candidate.education] : [],
    location: candidate.location,
  };
}

/** Merges a real backend screening result onto its candidate, in the same
 * shape the (offline-fallback) heuristic assessCandidate() produces. */
export function mergeFraudResult(candidate: Candidate, result: FraudScreenResult): FraudAssessment {
  return {
    candidate,
    status: result.status,
    riskScore: result.risk_score,
    signals: result.signals,
    summary: result.summary,
    checks: result.checks,
    sources: result.sources,
    details: result.details,
  };
}

/** Four showcase nodes for the orbital hero (mixed statuses). */
export function orbitShowcase(assessments: FraudAssessment[]): FraudAssessment[] {
  const verified = assessments.filter((a) => a.status === "verified");
  const suspicious = assessments.filter((a) => a.status === "suspicious");
  const fraud = assessments.filter((a) => a.status === "fraud");
  const picks = [verified[0], fraud[0], suspicious[0], verified[1] ?? verified[0]].filter(
    Boolean,
  ) as FraudAssessment[];
  return picks.slice(0, 4);
}
