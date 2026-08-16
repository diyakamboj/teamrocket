const API_BASE =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";

export type AgentAskPayload = {
  query: string;
  job_id?: string | null;
  session_id?: string | null;
  chatbot_conversation_id?: string | null;
};

export type AgentCitation = {
  id?: string;
  title?: string;
  url?: string;
  snippet?: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

export type AgentAskResponse = {
  session_id: string;
  response: string;
  candidates_referenced: string[];
  chat_turn: number;
  source: "chatbot" | "local" | "screening" | string;
  citations: AgentCitation[];
  chatbot_conversation_id?: string | null;
  job_id?: string | null;
  /** Set when the turn belonged to an L1 screening conversation. */
  screening?: ScreeningSession | null;
};

export type AgentStatus = {
  local_agent: boolean;
  chatbot: {
    enabled?: boolean;
    reachable?: boolean;
    url?: string | null;
    error?: string;
  };
};

export type JobResponse = {
  id: string;
  title: string;
  description: string;
  required_skills?: string[];
  required_experience_years?: number | null;
};

function recruiterHeaders(): HeadersInit {
  const email =
    (import.meta.env["VITE_RECRUITER_EMAIL"] as string | undefined) || "recruiter@example.com";
  return {
    "Content-Type": "application/json",
    "X-Recruiter-Email": email,
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...recruiterHeaders(),
      ...(init?.headers || {}),
    },
  });

  if (!response.ok) {
    let detail = `Request failed (${response.status})`;
    try {
      const body = await response.json();
      detail = body?.error || body?.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  return response.json() as Promise<T>;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  return request<AgentStatus>("/api/agent/status");
}

export async function askAgent(payload: AgentAskPayload): Promise<AgentAskResponse> {
  return request<AgentAskResponse>("/api/agent/ask", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function listJobs(): Promise<JobResponse[]> {
  return request<JobResponse[]>("/api/jobs");
}

export async function createJob(input: {
  title: string;
  description: string;
  required_skills?: string[];
  required_experience_years?: number;
}): Promise<JobResponse> {
  return request<JobResponse>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function ensureActiveJob(): Promise<JobResponse> {
  const jobs = await listJobs();
  if (jobs.length > 0) return jobs[0]!;
  return createJob({
    title: "Backend Engineer",
    description:
      "Backend Engineer role requiring Python, SQL, Azure, and Docker. Nice to have Kubernetes.",
    required_skills: ["Python", "SQL", "Azure", "Docker"],
    required_experience_years: 3,
  });
}

export type JobAnalyzeResponse = {
  job_id: string;
  title: string;
  required_skills: string[];
  nice_to_have_skills: string[];
  required_experience_years?: number | null;
  education_requirements?: string | null;
  summary?: string | null;
};

export async function analyzeJobDescriptionApi(input: {
  title: string;
  description: string;
}): Promise<JobAnalyzeResponse> {
  const job = await createJob({
    title: input.title,
    description: input.description,
  });
  return request<JobAnalyzeResponse>(`/api/jobs/${job.id}/analyze`, {
    method: "POST",
  });
}

export type FraudCheckSource = "live" | "heuristic" | "no_data" | "unavailable";

export type FraudSignal = {
  id: string;
  label: string;
  severity: "low" | "medium" | "high";
};

export type FraudScreenResult = {
  status: "verified" | "suspicious" | "fraud";
  risk_score: number;
  summary: string;
  checks: {
    identity: boolean;
    employment: boolean;
    education: boolean;
    location: boolean;
    sanctions: boolean;
  };
  sources: Record<"identity" | "employment" | "education" | "location" | "sanctions", FraudCheckSource>;
  signals: FraudSignal[];
  details: {
    sanctions_matches?: { name: string; program: string; score: number }[];
    employer_results?: {
      query: string;
      exists: boolean;
      matched_name: string | null;
      domain: string | null;
      source: string;
    }[];
  };
};

export type FraudScreenCandidateInput = {
  id: string;
  name: string;
  email: string;
  employers?: string[];
  education?: string[];
  location?: string | null;
};

export async function screenCandidatesForFraud(
  candidates: FraudScreenCandidateInput[],
): Promise<Record<string, FraudScreenResult>> {
  const { results } = await request<{ results: (FraudScreenResult & { id: string })[] }>(
    "/api/fraud/screen/batch",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ candidates }),
    },
  );
  const byId: Record<string, FraudScreenResult> = {};
  for (const r of results) byId[r.id] = r;
  return byId;
}

export type InterviewSlot = {
  label: string;
  start: string;
  end: string;
  outlook_url: string;
};

export type CandidateDecisionResult = {
  candidate_id: string;
  decision: "approved" | "rejected";
  email_sent: boolean;
  email_source: "live" | "mock";
  email_error?: string | null;
  calendar_slots: InterviewSlot[];
};

export async function submitCandidateDecision(input: {
  candidate_id: string;
  name: string;
  email: string;
  decision: "approved" | "rejected";
  job_title?: string;
}): Promise<CandidateDecisionResult> {
  return request<CandidateDecisionResult>("/api/candidates/decision", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
}

// ---------- L1 screening ----------

export type ScreeningCitation = {
  /** Where the claim comes from, so a conclusion can be traced back. */
  source: "resume" | "job_requirement" | "evaluation" | "screening" | string;
  label: string;
  detail: string;
};

export type ScreeningQuestion = {
  id: string;
  order: number;
  competency: string;
  category: string;
  question: string;
  criteria: string[];
  signals: string[];
  weight: number;
  rationale?: string | null;
  citations: ScreeningCitation[];
};

export type ScreeningAnswerEvaluation = {
  score: number;
  rating: "strong" | "adequate" | "weak" | string;
  coverage: number;
  depth: number;
  clarity: number;
  matched_signals: string[];
  missing_signals: string[];
  notes: string[];
  citations: ScreeningCitation[];
  scored_by: string;
};

export type ScreeningTurn = {
  question_id: string;
  order: number;
  competency: string;
  category: string;
  question: string;
  criteria?: string[];
  citations?: ScreeningCitation[];
  answer: string | null;
  skipped?: boolean;
  evaluation: ScreeningAnswerEvaluation | null;
};

export type ScreeningScorecard = {
  overall_score: number;
  answered: number;
  categories: Record<
    string,
    { score: number; rating: string; questions: number; competencies: string[] }
  >;
  recommendation: string;
  recommendation_reason: string;
  strong_areas: string[];
  weak_areas: string[];
};

export type BriefingPoint = { point: string; citations: ScreeningCitation[] };

export type ScreeningBriefing = {
  summary: string;
  background: {
    name: string;
    title?: string | null;
    years_experience: number;
    education?: string | null;
    certifications: string[];
    skills: string[];
    applying_for: string;
    match_score?: number | null;
    matched_requirements: string[];
    unmatched_requirements: string[];
  };
  screening_performance: {
    overall_score: number;
    recommendation: string;
    recommendation_reason: string;
    questions_answered: number;
    by_category: {
      category: string;
      label: string;
      score: number;
      rating: string;
      questions: number;
    }[];
  };
  strengths: BriefingPoint[];
  weaknesses: BriefingPoint[];
  concerns: BriefingPoint[];
  skill_gaps: { skill: string; status: string; finding: string; citations: ScreeningCitation[] }[];
  recommended_areas: {
    area: string;
    why: string;
    suggested_question: string;
    citations: ScreeningCitation[];
  }[];
  transcript: {
    question_id: string;
    competency: string;
    question: string;
    answer: string | null;
    score?: number | null;
    rating?: string | null;
  }[];
};

export type ScreeningSession = {
  session_id: string;
  candidate_id: string;
  candidate_name: string;
  job_id?: string | null;
  job_title?: string | null;
  evaluation_id?: string | null;
  status: "in_progress" | "completed" | "abandoned" | string;
  question_count: number;
  answered_count: number;
  current_question?: ScreeningQuestion | null;
  plan: ScreeningQuestion[];
  turns: ScreeningTurn[];
  scorecard: ScreeningScorecard | Record<string, never>;
  briefing: ScreeningBriefing | Record<string, never>;
  created_at?: string | null;
  completed_at?: string | null;
};

export type ScreeningSessionSummary = {
  session_id: string;
  candidate_id: string;
  candidate_name: string;
  job_title?: string | null;
  status: string;
  question_count: number;
  answered_count: number;
  overall_score?: number | null;
  recommendation?: string | null;
  created_at?: string | null;
  completed_at?: string | null;
};

/** Candidate profile sent inline for rows that have no backend record. */
export type ScreeningCandidateInput = {
  id: string;
  name: string;
  title?: string;
  years?: number;
  score?: number;
  education?: string;
  skills?: string[];
  certifications?: string[];
  strengths?: string[];
  gaps?: string[];
  evidence?: { skill: string; detail: string; source: string }[];
};

export type ScreeningJobInput = {
  title: string;
  required_skills?: string[];
  nice_to_have_skills?: string[];
  required_experience_years?: number;
};

export async function startScreening(input: {
  candidate_id?: string;
  job_id?: string | null;
  candidate?: ScreeningCandidateInput;
  job?: ScreeningJobInput;
  question_count?: number;
}): Promise<ScreeningSession> {
  return request<ScreeningSession>("/api/screening/sessions", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function answerScreeningQuestion(
  sessionId: string,
  answer: string,
): Promise<ScreeningSession> {
  return request<ScreeningSession>(`/api/screening/sessions/${sessionId}/answer`, {
    method: "POST",
    body: JSON.stringify({ answer }),
  });
}

export async function skipScreeningQuestion(sessionId: string): Promise<ScreeningSession> {
  return request<ScreeningSession>(`/api/screening/sessions/${sessionId}/skip`, {
    method: "POST",
  });
}

export async function completeScreening(sessionId: string): Promise<ScreeningSession> {
  return request<ScreeningSession>(`/api/screening/sessions/${sessionId}/complete`, {
    method: "POST",
  });
}

export async function getScreeningSession(sessionId: string): Promise<ScreeningSession> {
  return request<ScreeningSession>(`/api/screening/sessions/${sessionId}`);
}

export async function listScreeningSessions(
  candidateId?: string,
): Promise<ScreeningSessionSummary[]> {
  const query = candidateId ? `?candidate_id=${encodeURIComponent(candidateId)}` : "";
  return request<ScreeningSessionSummary[]>(`/api/screening/sessions${query}`);
}

export { API_BASE };
