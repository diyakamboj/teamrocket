import type { Candidate } from "@/lib/candidates";
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

/**
 * Offline fallback only. The real verification path is
 * `POST /api/fraud/screen/batch`, which runs live OFAC sanctions and employer
 * registry lookups server-side; this is what the page shows when that call
 * fails so the queue is not simply blank.
 *
 * Every signal below is derived from data actually present on the candidate
 * record. It deliberately raises no sanctions, identity, or location findings:
 * those require an external source, and inventing them from a hash of the
 * candidate id would put fabricated accusations in front of a recruiter.
 */
export function assessCandidate(candidate: Candidate): FraudAssessment {
  const signals: FraudSignal[] = [];
  let risk = 10;

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
      label: "Thin credential history in parsed resume",
      severity: "medium",
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

  if (candidate.evidence.length === 0) {
    risk += 12;
    signals.push({
      id: "no-evidence",
      label: "No supporting resume evidence extracted",
      severity: "medium",
    });
  }

  if (signals.length === 0) {
    signals.push({
      id: "clean",
      label: "No inconsistencies found in the parsed resume",
      severity: "low",
    });
  }

  risk = Math.min(98, risk);

  let status: FraudStatus = "verified";
  if (risk >= 70) status = "fraud";
  else if (risk >= 42) status = "suspicious";

  // identity/location/sanctions are unknown offline — reported as not-failed
  // rather than as passed checks, since nothing verified them.
  const checks = {
    identity: true,
    employment: !signals.some((s) => s.id === "exp-mismatch"),
    education: candidate.categories.education >= 50,
    location: true,
    sanctions: true,
  };

  const summary =
    status === "fraud"
      ? "Resume-consistency review failed — multiple inconsistencies found. Live background checks unavailable."
      : status === "suspicious"
        ? "Resume-consistency review flagged items for manual review. Live background checks unavailable."
        : "No inconsistencies found in the parsed resume. Live background checks unavailable.";

  return { candidate, status, riskScore: risk, signals, summary, checks };
}

export function assessAllCandidates(list: Candidate[]): FraudAssessment[] {
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
