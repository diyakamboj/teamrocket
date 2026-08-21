import { getSession, recruiterEmail } from "@/lib/auth";

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

// ---------- Job interview rounds ----------

export type InterviewRound = {
  id: string;
  name: string;
  sequence: number;
  focus?: string | null;
  interview_type: string;
  duration_minutes: number;
  interviewer_name?: string | null;
  interviewer_email?: string | null;
};

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
  /** The interview loop for this role, in order. */
  rounds?: InterviewRound[];
  /** Per-role ranking weights, as percentages. */
  scoring_weights?: {
    skills: number;
    experience: number;
    education: number;
    certifications: number;
    projects: number;
  };
};


function recruiterHeaders(): HeadersInit {
  return {
    "Content-Type": "application/json",
    ...recruiterIdentityHeaders(),
  };
}

// Identity headers only, no Content-Type. A multipart/form-data request must
// let the browser set its own Content-Type (with the boundary) — forcing
// "application/json" here breaks the boundary and the server can't parse the
// body at all, so every field including the file looks missing.
function recruiterIdentityHeaders(): HeadersInit {
  const email = recruiterEmail();
  // The session token is what actually proves who is calling. Until now only
  // the email header was sent, so the API had nothing to verify identity
  // against and anyone could read another recruiter's pool by changing a
  // header. The header stays for audit logging; the token is the authority.
  const token = getSession()?.token;
  return {
    "X-Recruiter-Email": email,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/**
 * In-flight GETs, keyed by URL + recruiter.
 *
 * Independent components ask for the same thing at the same moment -- the
 * sidebar and the dashboard both want /api/dashboard/jobs, and React's dev
 * StrictMode runs every effect twice on top of that. Measured on the
 * dashboard: 20 requests for 9 distinct URLs, with /api/dashboard/jobs
 * fetched four times. Sharing one promise between concurrent callers makes
 * those collapse into a single round trip without any caller having to
 * coordinate.
 *
 * Nothing is retained after settling, so this is deduplication, not a cache:
 * a later fetch still goes to the network and no caller can read stale data.
 */
const inFlight = new Map<string, Promise<unknown>>();

function isGet(init?: RequestInit): boolean {
  const method = (init?.method || "GET").toUpperCase();
  return method === "GET";
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (isGet(init)) {
    const key = `${recruiterEmail() ?? ""}:${path}`;
    const existing = inFlight.get(key) as Promise<T> | undefined;
    if (existing) return existing;

    const pending = performRequest<T>(path, init).finally(() => {
      inFlight.delete(key);
    });
    inFlight.set(key, pending);
    return pending;
  }
  return performRequest<T>(path, init);
}

async function performRequest<T>(path: string, init?: RequestInit): Promise<T> {
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
        failure = String(event["detail"] ?? "AI failed");
      }
    }
  }

  if (result) return result;
  throw new Error(failure ?? "AI stream ended without an answer");
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
  const form = new FormData();
  form.append("file", file);
  if (sessionId) form.append("session_id", sessionId);

  const response = await fetch(`${API_BASE}/api/agent/attachments`, {
    method: "POST",
    headers: recruiterIdentityHeaders(),
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

// ---------- Recruiter network ----------

export type ConnectionState = "none" | "pending_outgoing" | "pending_incoming" | "connected";

export type DirectoryRecruiter = {
  email: string;
  name: string;
  role: string;
  department: string;
  connection_state: ConnectionState;
};

export type RecruiterConnection = {
  id: string;
  status: "pending" | "accepted" | "declined";
  direction: "incoming" | "outgoing";
  counterpart_email: string;
  counterpart_name: string;
  counterpart_role: string;
  message?: string | null;
  created_at: string;
};

export async function listRecruiterDirectory(): Promise<DirectoryRecruiter[]> {
  return request<DirectoryRecruiter[]>("/api/connections/directory");
}

export async function listConnections(): Promise<RecruiterConnection[]> {
  return request<RecruiterConnection[]>("/api/connections");
}

export async function requestConnection(
  email: string,
  message?: string,
): Promise<RecruiterConnection> {
  return request<RecruiterConnection>("/api/connections", {
    method: "POST",
    body: JSON.stringify({ email, message: message || null }),
  });
}

export async function respondToConnection(
  id: string,
  accept: boolean,
): Promise<RecruiterConnection> {
  return request<RecruiterConnection>(`/api/connections/${encodeURIComponent(id)}/respond`, {
    method: "POST",
    body: JSON.stringify({ accept }),
  });
}

export async function removeConnection(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/connections/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: recruiterHeaders(),
  });
  if (!response.ok) throw new Error(`Could not remove connection (${response.status})`);
}

// ---------- Bench employees ----------

export type BenchEmployee = {
  candidate_id: string;
  name: string;
  title?: string | null;
  email: string;
  skills: string[];
  location?: string | null;
  days_on_bench?: number | null;
  bench_since?: string | null;
  previous_assignment?: string | null;
};

export type BenchMatch = {
  candidate_id: string;
  name: string;
  title?: string | null;
  skills: string[];
  days_on_bench?: number | null;
  similarity: number;
};

export async function listBench(): Promise<BenchEmployee[]> {
  return request<BenchEmployee[]>("/api/bench");
}

export async function placeOnBench(
  candidateId: string,
  previousAssignment?: string,
): Promise<BenchEmployee> {
  return request<BenchEmployee>(`/api/bench/${encodeURIComponent(candidateId)}/place`, {
    method: "POST",
    body: JSON.stringify({ previous_assignment: previousAssignment ?? null }),
  });
}

export async function assignFromBench(
  candidateId: string,
  assignment: string,
): Promise<BenchEmployee> {
  return request<BenchEmployee>(`/api/bench/${encodeURIComponent(candidateId)}/assign`, {
    method: "POST",
    body: JSON.stringify({ assignment }),
  });
}

export async function matchBenchToRole(params: {
  jobId?: string;
  q?: string;
  limit?: number;
}): Promise<BenchMatch[]> {
  const search = new URLSearchParams();
  if (params.jobId) search.set("job_id", params.jobId);
  if (params.q) search.set("q", params.q);
  if (params.limit) search.set("limit", String(params.limit));
  return request<BenchMatch[]>(`/api/bench/match?${search.toString()}`);
}

// ---------- Semantic candidate search ----------

export type SemanticMatch = {
  candidate_id: string;
  name: string;
  title?: string | null;
  /** Cosine similarity, or null for hybrid queries — those fuse vector and
   *  keyword rankings and produce no comparable similarity. Render the
   *  absence; do not fall back to 0. */
  similarity: number | null;
  skills: string[];
  employment_status?: string | null;
};

export async function searchCandidates(
  q: string,
  options: { limit?: number; benchOnly?: boolean; hybrid?: boolean } = {},
): Promise<SemanticMatch[]> {
  const search = new URLSearchParams({ q });
  if (options.limit) search.set("limit", String(options.limit));
  if (options.benchOnly) search.set("bench_only", "true");
  // A search box mostly receives names and exact skills, which pure vector
  // similarity ranks poorly.
  if (options.hybrid) search.set("hybrid", "true");
  return request<SemanticMatch[]>(`/api/candidates/search?${search.toString()}`);
}

export async function reindexCandidates(): Promise<{ candidates: number; indexed: number }> {
  return request<{ candidates: number; indexed: number }>("/api/candidates/reindex", {
    method: "POST",
  });
}

// ---------- AI job-description polish ----------

export type PolishedJD = {
  polished_description: string;
  changes: string[];
  polished: boolean;
};

export async function polishJobDescription(input: {
  title: string;
  description: string;
  goal?: string;
}): Promise<PolishedJD> {
  return request<PolishedJD>("/api/jobs/polish-description", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

// ---------- Collaboration: shared candidates and messages ----------

/** What a recipient may do with a candidate shared with them. */
export type SharePermission = "view" | "collaborate";

export type SharedCandidate = {
  share_id: string;
  candidate_id: string;
  name: string;
  title?: string | null;
  location?: string | null;
  skills: string[];
  shared_by_email: string;
  shared_by_name: string;
  shared_with_email: string;
  shared_with_name: string;
  permission: SharePermission;
  note?: string | null;
  job_id?: string | null;
  job_title?: string | null;
  /** Where they stand in the owner's pipeline, when the share names a job. */
  stage?: PipelineStage | null;
  round_id?: string | null;
  round_name?: string | null;
  /** The owner's loop, so a collaborator can move them without listing the job. */
  rounds: SharedRound[];
  screening_summary?: string | null;
  screening_score?: number | null;
  created_at: string;
};

export type SharedRound = {
  id: string;
  name: string;
  sequence: number;
};

export type CandidateNote = {
  id: string;
  candidate_id: string;
  author_email: string;
  author_name: string;
  body: string;
  job_id?: string | null;
  created_at: string;
  mine: boolean;
};

export type MessageThread = {
  counterpart_email: string;
  counterpart_name: string;
  last_message: string;
  last_message_at: string;
  unread_count: number;
};

export type DirectMessage = {
  id: string;
  sender_email: string;
  recipient_email: string;
  body: string;
  candidate_id?: string | null;
  read_at?: string | null;
  created_at: string;
};

export async function shareCandidate(input: {
  candidate_id: string;
  email: string;
  note?: string;
  job_id?: string | null;
  permission?: SharePermission;
}): Promise<SharedCandidate> {
  return request<SharedCandidate>("/api/connections/share", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Promote a share to collaboration, or demote it back to read-only. */
export async function updateSharePermission(
  shareId: string,
  permission: SharePermission,
): Promise<SharedCandidate> {
  return request<SharedCandidate>(`/api/connections/share/${encodeURIComponent(shareId)}`, {
    method: "PATCH",
    body: JSON.stringify({ permission }),
  });
}

export async function listCandidateNotes(candidateId: string): Promise<CandidateNote[]> {
  return request<CandidateNote[]>(
    `/api/connections/candidates/${encodeURIComponent(candidateId)}/notes`,
  );
}

export async function addCandidateNote(
  candidateId: string,
  body: string,
  jobId?: string | null,
): Promise<CandidateNote> {
  return request<CandidateNote>(
    `/api/connections/candidates/${encodeURIComponent(candidateId)}/notes`,
    { method: "POST", body: JSON.stringify({ body, job_id: jobId ?? null }) },
  );
}

export async function listSharedWithMe(): Promise<SharedCandidate[]> {
  return request<SharedCandidate[]>("/api/connections/shared-with-me");
}

export async function listSharedByMe(): Promise<SharedCandidate[]> {
  return request<SharedCandidate[]>("/api/connections/shared-by-me");
}

export async function revokeShare(shareId: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/connections/share/${encodeURIComponent(shareId)}`, {
    method: "DELETE",
    headers: recruiterHeaders(),
  });
  if (!response.ok) throw new Error(`Could not revoke the share (${response.status})`);
}

export async function listMessageThreads(): Promise<MessageThread[]> {
  return request<MessageThread[]>("/api/connections/messages");
}

export async function readMessageThread(email: string): Promise<DirectMessage[]> {
  return request<DirectMessage[]>(`/api/connections/messages/${encodeURIComponent(email)}`);
}

export async function sendMessage(input: {
  email: string;
  body: string;
  candidate_id?: string | null;
}): Promise<DirectMessage> {
  return request<DirectMessage>("/api/connections/messages", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Patch a job. Used to classify a role as internal or external hiring. */
export async function updateJob(
  jobId: string,
  updates: { sourcing_mode?: "internal" | "external" | "both"; status?: string; title?: string },
): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}`, {
    method: "PUT",
    body: JSON.stringify(updates),
  });
}

export async function updateJobRounds(
  jobId: string,
  rounds: Omit<InterviewRound, "id">[] | InterviewRound[],
): Promise<JobResponse> {
  return request<JobResponse>(`/api/jobs/${encodeURIComponent(jobId)}/rounds`, {
    method: "PUT",
    body: JSON.stringify({ rounds }),
  });
}

// ---------- Company context documents ----------

export type CompanyDocCategory = "vision" | "values" | "culture" | "guidelines";

/**
 * A company context document held by the backend.
 *
 * These live server-side, scoped to the recruiter who uploaded them — the
 * browser keeps no copy and no id index, so the list survives a cleared
 * localStorage and cannot be read by another account.
 */
export type CompanyDocument = {
  id: string;
  recruiter_email: string;
  category: CompanyDocCategory;
  filename: string;
  size_bytes: number;
  status: "queued" | "processing" | "processed" | "failed";
  extracted_text?: string | null;
  extracted_summary?: string | null;
  error?: string | null;
  created_at: string;
};

export async function listCompanyDocuments(): Promise<CompanyDocument[]> {
  return request<CompanyDocument[]>("/api/company-documents");
}

export async function getCompanyDocument(id: string): Promise<CompanyDocument> {
  return request<CompanyDocument>(`/api/company-documents/${encodeURIComponent(id)}`);
}

export async function uploadCompanyDocument(
  file: File,
  category: CompanyDocCategory,
): Promise<CompanyDocument> {
  const form = new FormData();
  form.append("file", file);
  form.append("category", category);

  const response = await fetch(`${API_BASE}/api/company-documents`, {
    method: "POST",
    // Only the identity header: the browser must not set Content-Type here,
    // or the multipart boundary is lost.
    headers: recruiterIdentityHeaders(),
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

  return response.json() as Promise<CompanyDocument>;
}

export async function deleteCompanyDocument(id: string): Promise<void> {
  const response = await fetch(`${API_BASE}/api/company-documents/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: recruiterHeaders(),
  });
  if (!response.ok) {
    throw new Error(`Could not delete document (${response.status})`);
  }
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
  /** The interview loop; omitted means the backend's default loop. */
  rounds?: Array<Omit<InterviewRound, "id"> & { id?: string }>;
  scoring_weights?: JobResponse["scoring_weights"];
}): Promise<JobResponse> {

  return request<JobResponse>("/api/jobs", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export type BackendHealth = {
  status: string;
  version?: string;
  mock_azure?: boolean;
  azure_configured?: boolean;
};

/**
 * Liveness check for the "Connected" / "Offline" indicator.
 *
 * Deliberately separate from `ensureActiveJob`, which creates a job when the
 * account has none — a readiness probe that retries must never have a side
 * effect, or a backend that is slow to come up ends up with a job per retry.
 */
export async function getBackendHealth(): Promise<BackendHealth> {
  const response = await fetch(`${API_BASE}/health`, {
    headers: recruiterHeaders(),
  });
  if (!response.ok) throw new Error(`Backend unhealthy (${response.status})`);
  return response.json() as Promise<BackendHealth>;
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
  classification: "too_strict" | "low_signal" | "under_filtered" | "balanced" | "insufficient_data";
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

// ---------- Ops / SRE dashboard ----------

export type OpsServiceStatus = {
  service: string;
  label: string;
  status: "healthy" | "degraded" | "critical" | "unknown";
  detail: string;
};

export type OpsOverviewResponse = {
  generated_at: string;
  overall_status: string;
  services: OpsServiceStatus[];
};

export type OpsRequestBucket = {
  bucket_start: string;
  count: number;
  error_count: number;
  avg_latency_ms: number;
};

export type OpsRequestHealthResponse = {
  window_hours: number;
  total_requests: number;
  error_rate_pct: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  buckets: OpsRequestBucket[];
};

export type OpsAiServiceStat = {
  service: string;
  label: string;
  call_count: number;
  failure_count: number;
  fallback_count: number;
  avg_latency_ms: number;
  p95_latency_ms: number;
  mock_call_pct: number;
  breaker_open: boolean | null;
  consecutive_failures: number | null;
};

export type OpsAiServiceHealthResponse = {
  window_hours: number;
  services: OpsAiServiceStat[];
};

export type OpsToolUsage = { tool: string; count: number };

export type OpsAgentHealthResponse = {
  window_hours: number;
  total_turns: number;
  deterministic_turns: number;
  agent_turns: number;
  fallback_turns: number;
  fallback_rate_pct: number;
  tool_usage: OpsToolUsage[];
};

export type OpsEndpointStat = {
  method: string;
  path: string;
  count: number;
  error_count: number;
  error_rate_pct: number;
  avg_latency_ms: number;
};

export type OpsEndpointBreakdownResponse = {
  window_hours: number;
  endpoints: OpsEndpointStat[];
};

export type OpsLogEntry = {
  created_at: string;
  event_type: string;
  service: string;
  status: string;
  duration_ms: number;
  error_message?: string | null;
  details: Record<string, unknown>;
};

export type OpsLogsResponse = {
  window_hours: number;
  total_count: number;
  entries: OpsLogEntry[];
};

export async function getOpsOverview(hours = 1): Promise<OpsOverviewResponse> {
  return request<OpsOverviewResponse>(`/api/ops/overview?hours=${hours}`);
}

export async function getOpsRequestHealth(hours = 1): Promise<OpsRequestHealthResponse> {
  return request<OpsRequestHealthResponse>(`/api/ops/requests?hours=${hours}`);
}

export async function getOpsAiServiceHealth(hours = 1): Promise<OpsAiServiceHealthResponse> {
  return request<OpsAiServiceHealthResponse>(`/api/ops/ai-services?hours=${hours}`);
}

export async function getOpsAgentHealth(hours = 1): Promise<OpsAgentHealthResponse> {
  return request<OpsAgentHealthResponse>(`/api/ops/agent?hours=${hours}`);
}

export async function getOpsEndpointBreakdown(
  hours = 1,
  limit = 20,
): Promise<OpsEndpointBreakdownResponse> {
  return request<OpsEndpointBreakdownResponse>(`/api/ops/endpoints?hours=${hours}&limit=${limit}`);
}

export async function getOpsLogs(hours = 1, status?: string): Promise<OpsLogsResponse> {
  const statusParam = status ? `&status=${status}` : "";
  return request<OpsLogsResponse>(`/api/ops/logs?hours=${hours}${statusParam}`);
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

/** Mirrors the backend's CANDIDATE_DECISIONS (see decision_service.py). */
export type CandidateDecisionKind = "advanced" | "approved" | "hired" | "rejected";

export type CandidateDecisionResult = {
  candidate_id: string;
  decision: CandidateDecisionKind;
  email_sent: boolean;
  email_source: "live" | "mock";
  email_error?: string | null;
  calendar_slots: InterviewSlot[];
};

export async function submitCandidateDecision(input: {
  candidate_id: string;
  name: string;
  email: string;
  decision: CandidateDecisionKind;
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

export type PipelineStage =
  | "screened"
  | "interviewing"
  | "interviewed"
  | "selected"
  | "hired"
  | "rejected";

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
  /** Set only while interviewing, and only once someone has been moved. */
  round_id?: string | null;
  round_name?: string | null;
  round_sequence?: number | null;
  moved_by?: string | null;
  moved_by_name?: string | null;
  moved_by_role?: string | null;
  updated_at: string;
  employment_status?: string | null;
};

export type CandidatePlacement = {
  job_id: string;
  candidate_id: string;
  stage: PipelineStage;
  round_id?: string | null;
  round_name?: string | null;
  round_sequence?: number | null;
  moved_by?: string | null;
  moved_by_name?: string | null;
  moved_by_role?: string | null;
  note?: string | null;
  updated_at: string;
};

/**
 * Move a candidate to a stage, and into a round when interviewing.
 *
 * The board and the pipeline overview both call this, so a move made in one
 * shows up in the other.
 */
export async function moveCandidateInPipeline(
  jobId: string,
  candidateId: string,
  input: { stage: PipelineStage; round_id?: string | null; candidate_name?: string; note?: string },
): Promise<CandidatePlacement> {
  return request<CandidatePlacement>(
    `/api/dashboard/jobs/${encodeURIComponent(jobId)}/pipeline/${encodeURIComponent(candidateId)}`,
    { method: "PUT", body: JSON.stringify(input) },
  );
}

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

export type AtsVerdict =
  | "semantic_stronger"
  | "keyword_stronger"
  | "aligned"
  // The two halves are only comparable when both exist.
  | "no_keyword_baseline"   // the job lists no skills for the keyword scan
  | "semantic_unavailable"; // the model returned no usable score

export type EquivalentTerm = { resume_term: string; jd_keyword: string };

export type AtsBenchmark = {
  id: string;
  evaluation_id: string;
  candidate_id: string;
  job_id: string;
  // Decimal fields serialize as JSON strings — parse with Number() to display.
  keyword_score: string | null;
  matched_keywords: string[];
  missing_keywords: string[];
  semantic_score: string | null;
  semantic_rationale?: string | null;
  equivalent_terms: EquivalentTerm[];
  score_delta: string | null;
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

export async function getKnownInterviewers(): Promise<
  Array<{ name: string; email: string; title: string }>
> {
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

export async function cancelInterview(
  interviewId: string,
  reason?: string,
): Promise<ScheduledInterview> {
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

export async function createScreeningSession(
  candidateId: string,
  jobId?: string | null,
): Promise<ScreeningSession> {
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

export async function listCandidateScreeningSessions(
  candidateId: string,
): Promise<ScreeningSession[]> {
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
  /** True only when a mailer actually accepted the message. */
  notification_sent: boolean;
  notification_source?: "live" | "mock" | null;
  notification_error?: string | null;
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

export async function listCandidateAssessments(
  candidateId: string,
): Promise<CandidateAssessmentRecord[]> {
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

export async function uploadResumesToBackend(
  files: File[],
  /** The role these résumés are for. Omit to add them to the pool without
   *  attaching them to a job — they can then be ranked for any of them. */
  jobId?: string | null,
  /** Which population this résumé belongs to. Decided at intake so internal
   *  employees and external applicants never mix by default. */
  source: "internal" | "external" = "external",
  /** Internal intake only: where this employee sits today, and what they do
   *  there. A résumé lists past roles, not the current one. */
  internalRole?: { position?: string | null; duties?: string | null },
): Promise<BackendResumeUploadResponse> {
  const formData = new FormData();
  for (const f of files) {
    formData.append("files", f);
  }
  if (jobId) formData.append("job_id", jobId);
  formData.append("source", source);
  if (source === "internal") {
    if (internalRole?.position) formData.append("current_position", internalRole.position);
    if (internalRole?.duties) formData.append("current_role_duties", internalRole.duties);
  }

  const res = await fetch(`${API_BASE}/api/resumes/upload`, {
    method: "POST",
    headers: recruiterIdentityHeaders(),
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
  /** Internal employees only: the role they hold in the company today, and
   *  what they do in it. Captured at internal intake — a résumé lists past
   *  roles, not the current one. */
  current_assignment?: string | null;
  current_role_duties?: string | null;
  bench_since?: string | null;
  /** The role this résumé was uploaded against; null means the general pool. */
  job_id?: string | null;
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
 * three-signal matching engine.
 *
 * The saved weights are sent along. They used to be left at the server
 * defaults while the candidates page re-weighted its own copy locally, so
 * the same person could show one ATS score on that page and a different one
 * in the job workspace, with nothing on screen explaining the gap. Sliders
 * still re-rank locally for responsiveness; saving is what makes the server
 * agree.
 */
export async function rankCandidatesApi(
  jobId: string,
  options?: { blindMode?: boolean; weights?: Record<string, number> },
): Promise<RankedCandidate[]> {
  const params = new URLSearchParams({ job_id: jobId });
  if (options?.blindMode) params.set("blind_mode", "true");
  for (const [key, value] of Object.entries(options?.weights ?? {})) {
    // The endpoint takes fractions; the UI works in whole percentages.
    params.set(key, String(value / 100));
  }
  return request<RankedCandidate[]>(`/api/candidates/rank?${params.toString()}`);
}

export { API_BASE };







export type VectorEngineStatus = {
  name: string;
  role: string;
  reachable: boolean;
  documents_indexed: number | null;
};

export type VectorIndexStatus = {
  backend: string;
  backend_label: string;
  is_external: boolean;
  embedding_model: string;
  dimensions: number;
  reachable: boolean;
  documents_indexed: number | null;
  indexed_for_me: number;
  my_candidates: number;
  detail: string;
  /** One entry per engine when more than one is in play. */
  engines: VectorEngineStatus[];
};

/** Live state of the vector index behind semantic search. */
export async function getVectorIndexStatus(): Promise<VectorIndexStatus> {
  return request<VectorIndexStatus>("/api/candidates/index-status");
}


// ---------- Role assignment & internal employees ----------

/** Move a candidate onto a role, or pass null to return them to the pool.
 *  Removing from a role does not delete them — they stay rankable. */
export async function moveCandidateToRole(
  candidateId: string,
  jobId: string | null,
  /** The board they are leaving. Needed when they only reached it by being
   *  scored against it, which clearing `job_id` alone does not undo. */
  fromJobId?: string | null,
): Promise<BackendCandidate> {
  return request<BackendCandidate>(`/api/candidates/${candidateId}/role`, {
    method: "PUT",
    body: JSON.stringify({ job_id: jobId, from_job_id: fromJobId ?? null }),
  });
}

export type NewInternalEmployee = {
  name: string;
  email: string;
  title?: string | null;
  current_assignment?: string | null;
  current_role_duties?: string | null;
  location?: string | null;
  skills?: string[];
  on_bench?: boolean;
  job_id?: string | null;
};

/** Add an existing employee without a résumé upload. */
export async function createInternalEmployee(
  input: NewInternalEmployee,
): Promise<BackendCandidate> {
  return request<BackendCandidate>("/api/candidates/internal", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

/** Mark an existing candidate as an internal employee. */
export async function markCandidateInternal(candidateId: string): Promise<BackendCandidate> {
  return request<BackendCandidate>(`/api/candidates/${candidateId}`, {
    method: "PUT",
    body: JSON.stringify({ source: "internal" }),
  });
}


/** An internal employee, benched or not. */
export type InternalEmployee = {
  candidate_id: string;
  name: string;
  title?: string | null;
  email: string;
  skills: string[];
  /** What they are working on now; null means between assignments. */
  current_assignment?: string | null;
  current_role_duties?: string | null;
  on_bench: boolean;
  days_on_bench?: number | null;
  job_id?: string | null;
};

/** The whole internal roster — the bench list alone had no way to reach
 *  people who were not already on it. */
export async function listInternalEmployees(): Promise<InternalEmployee[]> {
  return request<InternalEmployee[]>("/api/bench/employees");
}


// ---------- Hiring progress ----------

export type ProgressStepState = "done" | "current" | "todo" | "skipped";

export type ProgressStep = {
  key: string;
  label: string;
  state: ProgressStepState;
  detail: string;
  hint: string;
  interviewer?: string | null;
};

export type NextAction = {
  kind: "send_assessment" | "wait" | "advance" | "decide";
  label: string;
  why: string;
  /** Which workspace tab this action is performed on, when it is not done
   *  inline. The checklist says what to do; this says where. */
  goto: "pipeline" | "candidates" | null;
  goto_label: string | null;
};

export type CandidateProgress = {
  candidate_id: string;
  candidate_name: string;
  stage: string;
  hiring_status: "active" | "hired" | "rejected";
  steps: ProgressStep[];
  /** The single next thing to do. Null once they are hired or rejected. */
  next_action: NextAction | null;
  assessment_id: string | null;
  assessment_status: string | null;
};

/** Per-candidate checklist for a job, with the next action computed
 *  server-side so the board cannot disagree with anything else. */
export async function getJobProgress(
  jobId: string,
  source?: string,
): Promise<CandidateProgress[]> {
  const qs = source && source !== "all" ? `?source=${encodeURIComponent(source)}` : "";
  return request<CandidateProgress[]>(`/api/dashboard/jobs/${encodeURIComponent(jobId)}/progress${qs}`);
}

export type HiredPerson = {
  candidate_id: string;
  name: string;
  title?: string | null;
  email?: string | null;
  hired_at?: string | null;
  source?: string | null;
  current_assignment?: string | null;
};

/** Who was hired into this role. */
export async function getJobHires(jobId: string): Promise<HiredPerson[]> {
  return request<HiredPerson[]>(`/api/dashboard/jobs/${encodeURIComponent(jobId)}/hired`);
}

/** Record a deliberate decision not to assess someone. */
export async function skipAssessment(input: {
  candidate_id: string;
  job_id?: string | null;
  job_title?: string | null;
  reason?: string | null;
}): Promise<CandidateAssessmentRecord> {
  return request<CandidateAssessmentRecord>("/api/readiness/skip", {
    method: "POST",
    body: JSON.stringify(input),
  });
}


/** Update the signed-in account. Email and role are not editable here:
 *  the email is the login every record is scoped by, and the role is an
 *  administrative decision rather than a self-service one. */
export async function updateMyProfile(input: {
  name?: string;
  department?: string;
}): Promise<{ id: string; email: string; name: string; role: string; department: string }> {
  return request("/api/auth/me", { method: "PATCH", body: JSON.stringify(input) });
}


// ---------- Interview question bank ----------

export type QuestionDifficulty = "easy" | "medium" | "hard";
/** Who the question is written for. A recruiter without domain expertise
 *  cannot grade a systems answer, so they get a different set. */
export type QuestionAudience = "non_technical" | "technical";

export type InterviewQuestion = {
  id: string;
  question: string;
  difficulty: QuestionDifficulty;
  audience: QuestionAudience;
  /** What a good answer actually contains — the part that makes the
   *  question usable by someone who could not otherwise grade it. */
  model_answer: string;
  signals: string[];
  follow_ups: string[];
  competency?: string | null;
};

export type RoundQuestionSet = {
  id: string;
  job_id: string;
  round_id: string;
  round_name: string;
  interview_type: string;
  questions: InterviewQuestion[];
  /** False when the model could not be reached and these are the built-in
   *  fallbacks, so the page can say so rather than passing them off as
   *  tailored to this role. */
  generated_by_ai: boolean;
};

/** The stored bank for a round, or null if none has been generated. */
export async function getRoundQuestions(
  jobId: string,
  roundId: string,
): Promise<RoundQuestionSet | null> {
  return request<RoundQuestionSet | null>(
    `/api/jobs/${encodeURIComponent(jobId)}/rounds/${encodeURIComponent(roundId)}/questions`,
  );
}

/** Generate (or regenerate) the bank for one round. */
export async function generateRoundQuestions(
  jobId: string,
  roundId: string,
  refresh = false,
): Promise<RoundQuestionSet> {
  const qs = refresh ? "?refresh=true" : "";
  return request<RoundQuestionSet>(
    `/api/jobs/${encodeURIComponent(jobId)}/rounds/${encodeURIComponent(roundId)}/questions${qs}`,
    { method: "POST" },
  );
}


// ---------- Password reset & account deletion ----------

/** Start a reset. Always resolves the same way, registered or not — the
 *  API deliberately does not reveal which addresses have accounts. */
export async function requestPasswordReset(email: string): Promise<{ message: string }> {
  return request<{ message: string }>("/api/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

/** Delete the signed-in account and everything it owns. Irreversible. */
export async function deleteMyAccount(password: string): Promise<void> {
  await request<void>("/api/auth/delete-account", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}
