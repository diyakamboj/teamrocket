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
  nice_to_have_skills?: string[];
  required_experience_years?: number | null;
  education_requirements?: string | null;
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

/** One step the agent reported while working on an answer. */
export type AgentProgress = {
  stage: "context" | "plan" | "tool" | "answer" | "fallback" | string;
  detail: string;
};

/**
 * Ask the agent and receive its progress as it works.
 *
 * An answer takes several seconds of real work — re-reading the scored pool,
 * choosing a tool, running it, writing the reply — so this streams what the
 * agent is doing instead of leaving a spinner. Falls back to the plain
 * `askAgent` request if the stream cannot be opened, so the chat still works
 * behind proxies that buffer server-sent events.
 */
export async function askAgentStreaming(
  payload: AgentAskPayload,
  onProgress: (progress: AgentProgress) => void,
): Promise<AgentAskResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/api/agent/ask/stream`, {
      method: "POST",
      headers: recruiterHeaders(),
      body: JSON.stringify(payload),
    });
  } catch {
    return askAgent(payload);
  }

  if (!response.ok || !response.body) {
    return askAgent(payload);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let result: AgentAskResponse | null = null;
  let failure: string | null = null;

  // Server-sent events: one JSON object per "data:" line, blank-line separated.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let split = buffer.indexOf("\n\n");
    while (split !== -1) {
      const chunk = buffer.slice(0, split).trim();
      buffer = buffer.slice(split + 2);
      split = buffer.indexOf("\n\n");
      if (!chunk.startsWith("data:")) continue;

      let event: Record<string, unknown>;
      try {
        event = JSON.parse(chunk.slice(5).trim());
      } catch {
        continue;
      }

      if (event["type"] === "progress") {
        onProgress({ stage: String(event["stage"]), detail: String(event["detail"]) });
      } else if (event["type"] === "result") {
        result = event as unknown as AgentAskResponse;
      } else if (event["type"] === "error") {
        failure = String(event["detail"] ?? "Copilot failed");
      }
    }
  }

  if (result) return result;
  throw new Error(failure ?? "Copilot stream ended without an answer");
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

export async function getJob(jobId: string): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`);
}


export async function createJob(input: {
  title: string;
  description: string;
  required_skills?: string[];
  nice_to_have_skills?: string[];
  required_experience_years?: number;
  sourcing_mode?: string;
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
  /** Null when analyzing an unsaved draft. */
  job_id: string | null;
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
  pipeline_progression: Record<string, number>;
  candidate_sources: Record<string, number>;
  skill_coverage: SkillCoverage[];
  jd_suggestions_count: number;
  jd_top_flag?: string | null;
};

export type SkillCoverage = {
  skill: string;
  is_must_have: boolean;
  coverage_pct: number;
  candidates_matching: number;
  total_candidates: number;
  low_score_without_skill_pct: number;
};

export type DashboardDistribution = {
  job_id: string;
  score_distribution: { bucket: string; count: number }[];
  experience_levels: Record<string, number>;
  pipeline_progression: Record<string, number>;
  candidate_sources: Record<string, number>;
};

export type JDRecommendationStatus = "pending" | "accepted" | "rejected" | "modified";

export type JDRecommendation = {
  id: string;
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
  suggested_modification: string;
  supporting_data: Record<string, unknown>;
  status: JDRecommendationStatus;
  recruiter_note?: string | null;
};

export type JDOptimizationResponse = {
  job_id: string;
  job_title: string;
  recommendations: JDRecommendation[];
  summary: string;
  generated_at: string;
  empty_reason?: string | null;
};

export async function getDashboardInsights(jobId: string): Promise<DashboardInsights> {
  return request<DashboardInsights>(`/api/dashboard/job/${jobId}/insights`);
}

export async function getDashboardDistribution(jobId: string): Promise<DashboardDistribution> {
  return request<DashboardDistribution>(`/api/dashboard/job/${jobId}/distribution`);
}

export async function getJdOptimization(jobId: string): Promise<JDOptimizationResponse> {
  return request<JDOptimizationResponse>(`/api/dashboard/job/${jobId}/jd-optimization`);
}

export async function decideJdRecommendation(
  jobId: string,
  recommendationId: string,
  payload: { status: Exclude<JDRecommendationStatus, "pending">; note?: string },
): Promise<JDRecommendation> {
  return request<JDRecommendation>(
    `/api/dashboard/job/${jobId}/jd-optimization/${recommendationId}/decision`,
    {
      method: "POST",
      body: JSON.stringify(payload),
    },
  );
}

/**
 * Extracts requirements from a draft JD without persisting a job — used while
 * the recruiter is still editing in the create-job flow.
 */
export async function analyzeJob(input: {
  title: string;
  description: string;
}): Promise<JobAnalyzeResponse> {
  return request<JobAnalyzeResponse>("/api/jobs/analyze-draft", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Re-runs requirement extraction on a saved job and persists the result. */
export async function analyzeSavedJob(jobId: string): Promise<JobAnalyzeResponse> {
  return request<JobAnalyzeResponse>(`/api/jobs/${encodeURIComponent(jobId)}/analyze`, {
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
  sourcing_mode?: string;
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

// ---------- L1 Preliminary Screening & Briefing Packs ----------

export type ScreeningQuestion = {
  id: string;
  question: string;
  category: string;
  intent: string;
  rubric?: string | null;
};

export type ScreeningAnswer = {
  question_id: string;
  answer_text: string;
  score: number;
  feedback?: string | null;
  evaluated_at: string;
};

export type ScreeningSession = {
  id: string;
  candidate_id: string;
  candidate_name: string;
  job_id?: string | null;
  job_title?: string | null;
  status: "pending" | "in_progress" | "completed";
  questions: ScreeningQuestion[];
  answers: ScreeningAnswer[];
  overall_score: number;
  summary_pack?: string | null;
  created_at: string;
  updated_at: string;
};

export async function createScreeningSession(candidateId: string, jobId?: string | null): Promise<ScreeningSession> {
  return request("/api/screening/session", {
    method: "POST",
    body: JSON.stringify({ candidate_id: candidateId, job_id: jobId || null }),
  });
}

export async function submitScreeningAnswer(input: {
  session_id: string;
  question_id: string;
  answer_text: string;
}): Promise<ScreeningSession> {
  return request("/api/screening/answer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listCandidateScreeningSessions(candidateId: string): Promise<ScreeningSession[]> {
  return request(`/api/screening/candidate/${encodeURIComponent(candidateId)}`);
}

// ---------- External Profile Enrichment & Source Attribution ----------

export type ExternalLink = {
  platform: "github" | "linkedin" | "hackerrank" | "portfolio";
  url: string;
  username?: string | null;
  status: string;
};

export type ExternalRepository = {
  name: string;
  description?: string | null;
  stars: number;
  language?: string | null;
  url: string;
  origin: string;
};

export type InferredSkill = {
  name: string;
  origin: string;
  confidence: number;
  url?: string | null;
};

export type EnrichedProfileData = {
  external_links: ExternalLink[];
  inferred_skills: InferredSkill[];
  repositories: ExternalRepository[];
  github_summary?: string | null;
  linkedin_summary?: string | null;
  hackerrank_summary?: string | null;
  portfolio_summary?: string | null;
  summary?: string | null;
  enriched_at: string;
};

export async function enrichCandidate(candidateId: string): Promise<BackendCandidate> {
  return request(`/api/candidates/${encodeURIComponent(candidateId)}/enrich`, {
    method: "POST",
  });
}

// ---------- Candidate Readiness & Assessment Notification ----------

export type AssessmentRecommendation = {
  candidate_id: string;
  candidate_name: string;
  job_id?: string | null;
  job_title?: string | null;
  assessment_type: "technical_depth" | "aptitude" | "communication" | "domain_knowledge";
  reason: string;
  target_competency: string;
  triggered_by_gap: string;
  recommended_at: string;
};

export type CandidateAssessmentRecord = {
  id: string;
  candidate_id: string;
  candidate_name: string;
  job_id?: string | null;
  job_title?: string | null;
  assessment_type: "technical_depth" | "aptitude" | "communication" | "domain_knowledge";
  title: string;
  status: "recommended" | "sent" | "in_progress" | "completed" | "reviewed" | "cancelled";

  recommendation_reason: string;
  target_competency: string;
  notification_sent: boolean;
  score?: number | null;
  result_summary?: string | null;
  recruiter_approved: boolean;
  recruiter_approved_by?: string | null;
  created_at: string;
  updated_at: string;
};

export async function evaluateCandidateReadiness(
  candidateId: string,
  jobId?: string | null,
): Promise<AssessmentRecommendation> {
  const query = jobId ? `?job_id=${encodeURIComponent(jobId)}` : "";
  return request(`/api/readiness/evaluate/${encodeURIComponent(candidateId)}${query}`);
}

export async function triggerCandidateAssessment(input: {
  candidate_id: string;
  job_id?: string | null;
  assessment_type?: string;
  target_competency?: string;
  recommendation_reason?: string;
}): Promise<CandidateAssessmentRecord> {
  return request("/api/readiness/trigger", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function submitAssessmentResults(
  assessmentId: string,
  score: number,
  resultSummary: string,
): Promise<CandidateAssessmentRecord> {
  return request(`/api/readiness/${encodeURIComponent(assessmentId)}/results`, {
    method: "POST",
    body: JSON.stringify({ score, result_summary: resultSummary }),
  });
}

export async function listCandidateAssessments(candidateId: string): Promise<CandidateAssessmentRecord[]> {
  return request(`/api/readiness/candidate/${encodeURIComponent(candidateId)}`);
}

// ---------- Resume File Upload & Candidate Sync ----------

export type BackendResumeUploadItem = {
  resume_id: string;
  filename: string;
  status: string;
  progress: number;
  duplicate?: boolean;
  error?: string | null;
};

export type BackendResumeUploadResponse = {
  batch_id: string;
  files: BackendResumeUploadItem[];
  message: string;
};

export type ResumeDetail = {
  resume_id: string;
  filename: string;
  status: string;
  progress: number;
  error?: string | null;
  blob_path?: string | null;
  candidate?: BackendCandidate | null;
};

/** Live status of one upload as the backend OCR/parse pipeline advances it. */
export async function getResumeStatus(resumeId: string): Promise<ResumeDetail> {
  return request<ResumeDetail>(`/api/resumes/${encodeURIComponent(resumeId)}`);
}

/** Re-runs OCR + parsing on an already-stored resume blob. */
export async function reparseResume(resumeId: string): Promise<ResumeDetail> {
  return request<ResumeDetail>(`/api/resumes/${encodeURIComponent(resumeId)}/parse`, {
    method: "POST",
  });
}

export async function uploadResumesToBackend(files: File[]): Promise<BackendResumeUploadResponse> {
  const formData = new FormData();
  for (const f of files) {
    formData.append("files", f);
  }

  const email =
    (import.meta.env["VITE_RECRUITER_EMAIL"] as string | undefined) || "recruiter@example.com";
  const res = await fetch(`${API_BASE}/api/resumes/upload`, {
    method: "POST",
    headers: { "X-Recruiter-Email": email },
    body: formData,
  });

  if (!res.ok) {
    let detail = `Upload failed (${res.status})`;
    try {
      const body = await res.json();
      detail = body?.error || body?.detail || detail;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }
  return res.json();
}

export type BackendCandidate = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  location?: string | null;
  title?: string | null;
  resume_file_id?: string | null;
  resume_text?: string | null;
  skills: unknown[];
  experience: unknown[];
  education: unknown[];
  certifications?: unknown[];
  projects?: unknown[];
  github_url?: string | null;
  linkedin_url?: string | null;
  portfolio_url?: string | null;
  hackerrank_url?: string | null;
  enriched_profile?: EnrichedProfileData | null;
  source?: string | null;
  employment_status?: string | null;
  current_assignment?: string | null;
  bench_since?: string | null;
  created_at: string;
};

/** Full candidate record as stored in the backend document store. */
export type Candidate = BackendCandidate;

export async function fetchCandidatesFromBackend(): Promise<BackendCandidate[]> {
  return request("/api/candidates");
}

export async function getCandidate(candidateId: string): Promise<BackendCandidate> {
  return request(`/api/candidates/${encodeURIComponent(candidateId)}`);
}

export type CandidateScore = RankedCandidate & {
  years_of_experience?: number | null;
  skills?: unknown[];
  technical_skills_score?: number | null;
  communication_score?: number | null;
  role_alignment_score?: number | null;
  evidence?: EvidenceSnippet[];
};

/** One candidate's full evaluation against a job, from the scoring pipeline. */
export async function getCandidateScore(
  candidateId: string,
  jobId: string,
): Promise<CandidateScore> {
  return request(
    `/api/candidates/${encodeURIComponent(candidateId)}/score?job_id=${encodeURIComponent(jobId)}`,
  );
}

// ---------- Backend scoring pipeline (real ranked candidates) ----------

export type EvidenceSnippet = {
  skill_name: string;
  resume_text_snippet: string;
  source_section?: string | null;
  confidence_score?: number | null;
  dimension?: string | null;
};

export type ScoreDimension = {
  score: number;
  explanation?: string | null;
  evidence?: EvidenceSnippet[];
};

export type RankedCandidate = {
  candidate_id: string;
  name: string;
  email?: string | null;
  rank: number;
  overall_score: number;
  skill_score: number;
  experience_score: number;
  education_score: number;
  certification_score: number;
  project_score: number;
  matched_skills: unknown[];
  missing_skills: unknown[];
  strengths?: string | null;
  weaknesses?: string | null;
  transferable_skills?: string | null;
  evaluation_id?: string | null;
  source?: string | null;
  employment_status?: string | null;
  current_assignment?: string | null;
  dimensions?: Record<string, ScoreDimension> | null;
};

/**
 * Ranks every stored candidate against a job using the backend's own
 * three-signal matching engine. Category weights are intentionally left at
 * the server defaults — the UI re-weights the returned per-category scores
 * locally so the sliders stay responsive.
 */
export async function rankCandidatesApi(
  jobId: string,
  options?: { blindMode?: boolean },
): Promise<RankedCandidate[]> {
  const params = new URLSearchParams({ job_id: jobId });
  if (options?.blindMode) params.set("blind_mode", "true");
  return request<RankedCandidate[]>(`/api/candidates/rank?${params.toString()}`);
}

export { API_BASE };





