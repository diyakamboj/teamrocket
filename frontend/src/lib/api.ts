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
  source: "chatbot" | "local" | string;
  citations: AgentCitation[];
  chatbot_conversation_id?: string | null;
  job_id?: string | null;
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

export type DashboardInsights = {
  job_id: string;
  total_candidates: number;
  evaluated_candidates: number;
  average_score: number;
  top_skills: { skill: string; count: number }[];
  common_missing_skills: { skill: string; count: number }[];
  average_experience_years: number;
  qualification_gaps_summary: string;
  pipeline_status: Record<string, number>;
  jd_suggestions_count: number;
  jd_top_flag?: string | null;
};

export type JDSuggestion = {
  skill: string;
  is_must_have: boolean;
  coverage_pct: number;
  candidates_matching: number;
  total_candidates: number;
  classification:
    | "too_strict"
    | "low_signal"
    | "under_filtered"
    | "balanced"
    | "insufficient_data";
  suggestion: string;
};

export type JDOptimizationResponse = {
  job_id: string;
  job_title: string;
  suggestions: JDSuggestion[];
  summary: string;
  generated_at: string;
};

export async function getDashboardInsights(jobId: string): Promise<DashboardInsights> {
  return request<DashboardInsights>(`/api/dashboard/job/${jobId}/insights`);
}

export async function getJdOptimization(jobId: string): Promise<JDOptimizationResponse> {
  return request<JDOptimizationResponse>(`/api/dashboard/job/${jobId}/jd-optimization`);
}

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

export { API_BASE };
