const API_BASE =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";

export type AgentAskPayload = {
  query: string;
  job_id?: string | null;
  session_id?: string | null;
  chatbot_conversation_id?: string | null;
  blind_mode?: boolean;
  weights?: Record<string, number> | null;
  candidate_id?: string | null;
  model_id?: string | null;
  attachment_ids?: string[];
};

export type AgentCitation = {
  id?: string;
  title?: string;
  url?: string;
  snippet?: string;
  score?: number;
  metadata?: Record<string, unknown>;
};

// ---------- Structured copilot payloads ----------

export type AgentCandidateCard = {
  type: "candidate_card";
  candidate_id?: string;
  label: string;
  rank?: number;
  score?: number;
  years?: number;
  level?: string;
  categories: Record<string, number>;
  must_haves?: Record<string, unknown> | null;
  skills: string[];
  strengths: string[];
  gaps: string[];
  summary?: string;
  source?: string | null;
  employment_status?: string | null;
  current_assignment?: string | null;
};

export type AgentRankingList = {
  type: "ranking_list";
  candidates: AgentCandidateCard[];
};

export type AgentComparisonTable = {
  type: "comparison_table";
  candidates: AgentCandidateCard[];
};

export type AgentRequirementVerdict = {
  requirement?: string;
  category?: string;
  must: boolean;
  status?: string;
  score?: number;
  justification?: string;
};

export type AgentEvaluationSummary = {
  type: "evaluation_summary";
  candidate: AgentCandidateCard;
  verdicts: AgentRequirementVerdict[];
};

export type AgentMustHaveRow = {
  requirement?: string;
  met_count: number;
  candidates: string[];
};

export type AgentMustHaveReport = {
  type: "must_have_report";
  rows: AgentMustHaveRow[];
  candidates_meeting_all: string[];
};

export type AgentStructuredPayload =
  | AgentCandidateCard
  | AgentRankingList
  | AgentComparisonTable
  | AgentEvaluationSummary
  | AgentMustHaveReport;

export type AgentAskResponse = {
  session_id: string;
  response: string;
  candidates_referenced: string[];
  chat_turn: number;
  source: "chatbot" | "local" | "agent" | string;
  engine?: "agent" | "deterministic" | "chatbot" | "comparison" | string;
  tools?: string[];
  citations: AgentCitation[];
  chatbot_conversation_id?: string | null;
  job_id?: string | null;
  candidate_id?: string | null;
  model_id: string;
  structured?: AgentStructuredPayload | null;
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

// ---------- Copilot models ----------

export type CopilotModelInfo = {
  id: string;
  label: string;
  description: string;
  is_default: boolean;
};

export type AgentModelsResponse = {
  models: CopilotModelInfo[];
  default_model_id: string;
};

// ---------- Copilot sessions ----------

export type AgentSessionSummary = {
  id: string;
  recruiter_email?: string | null;
  job_id?: string | null;
  messages: unknown[];
  created_at: string;
  updated_at: string;
  candidate_id?: string | null;
  candidate_name?: string | null;
  title?: string | null;
};

// ---------- Chat attachments ----------

export type ChatAttachmentStatus = "queued" | "processing" | "processed" | "failed";

export type ChatAttachmentInfo = {
  id: string;
  session_id?: string | null;
  recruiter_email?: string | null;
  filename: string;
  blob_path?: string | null;
  content_type?: string | null;
  size_bytes: number;
  status: ChatAttachmentStatus;
  kind?: "resume" | "job_description" | "notes" | "unknown" | null;
  extracted_summary?: string | null;
  candidate_id?: string | null;
  error?: string | null;
  created_at: string;
};

export type JobStatus = "open" | "paused" | "closed";

export type JobResponse = {
  id: string;
  title: string;
  description: string;
  required_skills?: string[];
  required_experience_years?: number | null;
  status?: JobStatus;
  sourcing_mode?: string;
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

export async function getAgentModels(): Promise<AgentModelsResponse> {
  return request<AgentModelsResponse>("/api/agent/models");
}

export async function listAgentSessions(
  candidateId?: string | null,
): Promise<AgentSessionSummary[]> {
  const params = new URLSearchParams({ mine_only: "true" });
  if (candidateId) params.set("candidate_id", candidateId);
  return request<AgentSessionSummary[]>(`/api/agent/sessions?${params.toString()}`);
}

/**
 * Multipart upload — bypasses request()'s hardcoded JSON content-type, so this
 * builds its own fetch call (still attaching the X-Recruiter-Email header).
 */
export async function uploadChatAttachment(
  file: File,
  sessionId?: string | null,
): Promise<ChatAttachmentInfo> {
  const email =
    (import.meta.env["VITE_RECRUITER_EMAIL"] as string | undefined) || "recruiter@example.com";
  const form = new FormData();
  form.append("file", file);
  if (sessionId) form.append("session_id", sessionId);

  const response = await fetch(`${API_BASE}/api/agent/attachments`, {
    method: "POST",
    headers: { "X-Recruiter-Email": email },
    body: form,
  });

  if (!response.ok) {
    let detail = `Upload failed (${response.status})`;
    try {
      const body = await response.json();
      detail = body?.error || body?.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }

  return response.json() as Promise<ChatAttachmentInfo>;
}

export async function getChatAttachment(id: string): Promise<ChatAttachmentInfo> {
  return request<ChatAttachmentInfo>(`/api/agent/attachments/${encodeURIComponent(id)}`);
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
  sources: Record<
    "identity" | "employment" | "education" | "location" | "sanctions",
    FraudCheckSource
  >;
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

export type ConsistencyFlag = {
  id: string;
  category: string;
  label: string;
  severity: "low" | "medium" | "high";
  detail?: string | null;
};

export type ResumeConsistencyResult = {
  candidate_id: string;
  flags: ConsistencyFlag[];
  flagged_count: number;
  requires_review: boolean;
  summary: string;
  engine: string;
};

export async function checkResumeConsistency(
  candidateId: string,
): Promise<ResumeConsistencyResult> {
  return request<ResumeConsistencyResult>(
    `/api/fraud/consistency-check/${encodeURIComponent(candidateId)}`,
    { method: "POST" },
  );
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

// ---------- Interview handoff & historical data ----------

export type HistoryEvent = {
  id: string;
  candidate_id: string;
  candidate_name?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  event_type: string;
  actor_email?: string | null;
  summary?: string | null;
  details: Record<string, unknown>;
  created_at: string;
};

export async function getCandidateHistory(
  candidateId: string,
  jobId?: string | null,
): Promise<HistoryEvent[]> {
  const qs = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
  return request<HistoryEvent[]>(`/api/handoff/history/${encodeURIComponent(candidateId)}${qs}`);
}

export type BriefingScorecard = {
  overall_score?: number | null;
  skill_score?: number | null;
  experience_score?: number | null;
  education_score?: number | null;
  certification_score?: number | null;
  project_score?: number | null;
};

export type CandidateBriefing = {
  candidate_id: string;
  candidate_name: string;
  candidate_email?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  generated_at: string;
  scorecard: BriefingScorecard;
  matched_skills: unknown[];
  missing_skills: unknown[];
  strengths?: string | null;
  weaknesses?: string | null;
  transferable_skills?: string | null;
  evidence_highlights: unknown[];
  interview_focus_areas: string[];
  recruiter_notes?: string | null;
};

export type HandoffStatus = "pending" | "viewed" | "acknowledged";

export type InterviewHandoffRecord = {
  id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  interviewer_name: string;
  interviewer_email: string;
  created_by?: string | null;
  briefing: CandidateBriefing;
  status: HandoffStatus;
  interviewer_notes?: string | null;
  email_sent: boolean;
  email_source?: string | null;
  created_at: string;
  viewed_at?: string | null;
  acknowledged_at?: string | null;
};

export async function createHandoff(input: {
  candidate_id: string;
  candidate_name: string;
  candidate_email?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  interviewer_name: string;
  interviewer_email: string;
  recruiter_notes?: string | undefined;
  scorecard?: BriefingScorecard;
  matched_skills?: unknown[];
  missing_skills?: unknown[];
  strengths?: string | null;
  weaknesses?: string | null;
  transferable_skills?: string | null;
  evidence_highlights?: unknown[];
}): Promise<InterviewHandoffRecord> {
  return request<InterviewHandoffRecord>("/api/handoff", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getHandoff(id: string): Promise<InterviewHandoffRecord> {
  return request<InterviewHandoffRecord>(`/api/handoff/${id}`);
}

export async function markHandoffViewed(id: string): Promise<InterviewHandoffRecord> {
  return request<InterviewHandoffRecord>(`/api/handoff/${id}/view`, { method: "POST" });
}

export async function acknowledgeHandoff(
  id: string,
  interviewerNotes?: string,
): Promise<InterviewHandoffRecord> {
  return request<InterviewHandoffRecord>(`/api/handoff/${id}/acknowledge`, {
    method: "POST",
    body: JSON.stringify({ interviewer_notes: interviewerNotes ?? null }),
  });
}

export async function listHandoffsForCandidate(
  candidateId: string,
): Promise<InterviewHandoffRecord[]> {
  return request<InterviewHandoffRecord[]>(
    `/api/handoff/candidate/${encodeURIComponent(candidateId)}/list`,
  );
}

// ---------- Top-level recruiter dashboard: job listings & pipeline ----------

export type PipelineStage = "screened" | "interviewing" | "interviewed" | "selected" | "rejected";

export type JobPipelineSummary = {
  job_id: string;
  title: string;
  status: JobStatus;
  created_at: string;
  total_candidates: number;
  internal_candidates: number;
  external_candidates: number;
  average_score: number;
  stage_counts: Record<PipelineStage, number>;
};

export type PipelineCandidate = {
  candidate_id: string;
  candidate_name: string;
  candidate_email?: string | null;
  source: "internal" | "external";
  overall_score?: number | null;
  stage: PipelineStage;
  updated_at: string;
  employment_status?: string | null;
};

export async function listJobPipelines(): Promise<JobPipelineSummary[]> {
  return request<JobPipelineSummary[]>("/api/dashboard/jobs");
}

export async function getJobPipeline(
  jobId: string,
  source?: "internal" | "external" | "all",
): Promise<PipelineCandidate[]> {
  const qs = source ? `?source=${source}` : "";
  return request<PipelineCandidate[]>(`/api/dashboard/jobs/${jobId}/pipeline${qs}`);
}

export async function updateJobStatus(jobId: string, status: JobStatus): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${jobId}`, {
    method: "PUT",
    body: JSON.stringify({ status }),
  });
}

export async function updateCandidateSource(
  candidateId: string,
  source: "internal" | "external",
): Promise<unknown> {
  return request(`/api/candidates/${candidateId}`, {
    method: "PUT",
    body: JSON.stringify({ source }),
  });
}

export async function updateJobSourcingMode(
  jobId: string,
  sourcingMode: string,
): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${jobId}`, {
    method: "PUT",
    body: JSON.stringify({ sourcing_mode: sourcingMode }),
  });
}

// ---------- Internal talent marketplace ----------

export async function getInternalMatches(
  jobId: string,
  benchPriority = true,
): Promise<AgentEvaluationSummary[]> {
  const params = new URLSearchParams({
    job_id: jobId,
    bench_priority: String(benchPriority),
  });
  return request<AgentEvaluationSummary[]>(
    `/api/internal-marketplace/matches?${params.toString()}`,
  );
}

// ---------- ATS Benchmark Baseline Scoring ----------

export type AtsVerdict = "semantic_stronger" | "keyword_stronger" | "aligned";

export type EquivalentTerm = { resume_term: string; jd_keyword: string };

export type AtsBenchmark = {
  id: string;
  evaluation_id: string;
  candidate_id: string;
  job_id: string;
  // Decimal fields serialize as JSON strings — parse with Number() to display.
  keyword_score: string;
  matched_keywords: string[];
  missing_keywords: string[];
  semantic_score: string;
  semantic_rationale?: string | null;
  equivalent_terms: EquivalentTerm[];
  score_delta: string;
  verdict: AtsVerdict;
  created_at: string;
  updated_at: string;
};

export async function runAtsBenchmark(candidateId: string, jobId: string): Promise<AtsBenchmark> {
  return request<AtsBenchmark>(`/api/evaluation/${candidateId}/${jobId}/ats-benchmark`, {
    method: "POST",
  });
}

export async function getAtsBenchmark(
  candidateId: string,
  jobId: string,
): Promise<AtsBenchmark | null> {
  try {
    return await request<AtsBenchmark>(`/api/evaluation/${candidateId}/${jobId}/ats-benchmark`);
  } catch {
    return null;
  }
}

// ---------- Interview & Calendar Scheduling ----------

export type TimeSlot = {
  slot_id: string;
  start_time: string;
  end_time: string;
  label: string;
  available_interviewers: string[];
  is_recommended: boolean;
  outlook_url?: string | null;
};

export type InterviewProposal = {
  type?: "interview_proposal";
  proposal_id: string;
  candidate_id: string;
  candidate_name: string;
  candidate_email?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  interview_type: string;
  duration_minutes: number;
  required_interviewers: string[];
  proposed_slots: TimeSlot[];
  notes?: string | null;
  created_at?: string;
};

export type ScheduledInterview = {
  id: string;
  proposal_id?: string | null;
  candidate_id: string;
  candidate_name: string;
  candidate_email?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  recruiter_email: string;
  interviewers: string[];
  interview_type: string;
  duration_minutes: number;
  status: "proposed" | "confirmed" | "rescheduled" | "cancelled";
  start_time: string;
  end_time: string;
  teams_link: string;
  teams_meeting_id: string;
  teams_passcode: string;
  location: string;
  notes?: string | null;
  outlook_deeplink?: string | null;
  created_at: string;
  updated_at: string;
};

export async function getKnownInterviewers(): Promise<Array<{ name: string; email: string; title: string }>> {
  return request("/api/interviews/interviewers");
}

export async function proposeInterview(input: {
  candidate_id: string;
  job_id?: string | null;
  interview_type?: string;
  duration_minutes?: number;
  required_interviewers?: string[];
  notes?: string | null;
}): Promise<InterviewProposal> {
  return request("/api/interviews/propose", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function confirmInterview(input: {
  proposal_id?: string | null;
  candidate_id: string;
  job_id?: string | null;
  interview_type?: string;
  duration_minutes?: number;
  interviewers: string[];
  start_time: string;
  end_time: string;
  notes?: string | null;
}): Promise<ScheduledInterview> {
  return request("/api/interviews/confirm", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listCandidateInterviews(candidateId: string): Promise<ScheduledInterview[]> {
  return request(`/api/interviews/candidate/${encodeURIComponent(candidateId)}`);
}

export async function rescheduleInterviewPropose(interviewId: string): Promise<InterviewProposal> {
  return request(`/api/interviews/${interviewId}/reschedule-propose`, { method: "POST" });
}

export async function confirmRescheduleInterview(
  interviewId: string,
  startTime: string,
  endTime: string,
): Promise<ScheduledInterview> {
  return request(`/api/interviews/${interviewId}/reschedule-confirm`, {
    method: "POST",
    body: JSON.stringify({ start_time: startTime, end_time: endTime }),
  });
}

export async function cancelInterview(interviewId: string, reason?: string): Promise<ScheduledInterview> {
  return request(`/api/interviews/${interviewId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason || null }),
  });
}

export { API_BASE };

