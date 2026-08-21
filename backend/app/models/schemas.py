from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field, model_validator

from app.models.job_posting import InterviewRound, ScoringWeights



class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Candidates ----------


class CandidateBase(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    location: Optional[str] = None
    title: Optional[str] = None
    skills: list[Any] = Field(default_factory=list)
    experience: list[Any] = Field(default_factory=list)
    education: list[Any] = Field(default_factory=list)
    certifications: list[Any] = Field(default_factory=list)
    projects: list[Any] = Field(default_factory=list)
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    hackerrank_url: Optional[str] = None
    source: str = "external"  # "internal" | "external"

    employment_status: Optional[str] = None  # "bench" | "assigned" | None
    current_assignment: Optional[str] = None
    #: What the employee does in that role. Captured at internal intake and
    #: stored on the candidate, but previously never returned, so the profile
    #: could not show it.
    current_role_duties: Optional[str] = None
    bench_since: Optional[datetime] = None

    #: The role this résumé was uploaded against. Never returned before, so
    #: the interface could not tell which board anyone belonged to and every
    #: candidate read as "not on a role yet".
    job_id: Optional[UUID] = None
    #: "active" | "hired" | "rejected" -- what stops a hired person still
    #: being offered as an open candidate.
    hiring_status: str = "active"
    hired_for_job_id: Optional[UUID] = None
    hired_at: Optional[datetime] = None


class CandidateCreate(CandidateBase):
    resume_text: Optional[str] = None


class CandidateUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    location: Optional[str] = None
    title: Optional[str] = None
    skills: Optional[list[Any]] = None
    experience: Optional[list[Any]] = None
    education: Optional[list[Any]] = None
    certifications: Optional[list[Any]] = None
    projects: Optional[list[Any]] = None
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    enriched_profile: Optional[dict[str, Any]] = None
    source: Optional[str] = None
    employment_status: Optional[str] = None
    current_assignment: Optional[str] = None
    current_role_duties: Optional[str] = None
    bench_since: Optional[datetime] = None


class CandidateResponse(CandidateBase, ORMModel):
    id: UUID
    resume_file_id: Optional[str] = None
    resume_text: Optional[str] = None
    enriched_profile: Optional[dict[str, Any]] = None
    created_at: datetime
    updated_at: datetime


class WeightConfig(BaseModel):
    skills: float = 0.40
    experience: float = 0.30
    education: float = 0.15
    certifications: float = 0.10
    projects: float = 0.05
    communication: float = 0.10


class RankedCandidate(BaseModel):
    candidate_id: UUID
    name: str
    email: Optional[str] = None
    rank: int
    overall_score: float
    skill_score: float
    experience_score: float
    education_score: float
    certification_score: float
    project_score: float
    matched_skills: list[Any] = Field(default_factory=list)
    missing_skills: list[Any] = Field(default_factory=list)
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    transferable_skills: Optional[str] = None
    evaluation_id: Optional[UUID] = None
    source: Optional[str] = None
    employment_status: Optional[str] = None
    current_assignment: Optional[str] = None
    dimensions: Optional[dict[str, Any]] = None


# ---------- Jobs ----------


class JobCreate(BaseModel):
    title: str
    description: str
    required_skills: list[str] = Field(default_factory=list)
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    nice_to_have_skills: list[str] = Field(default_factory=list)
    sourcing_mode: Optional[str] = "both"
    #: The interview loop. Omitted means the default loop, so a job always has
    #: rounds for the pipeline board to render.
    rounds: Optional[list[InterviewRound]] = None
    scoring_weights: Optional[ScoringWeights] = None
    created_by: Optional[str] = None


class JobRoundsUpdate(BaseModel):
    rounds: list[InterviewRound]



class JobDraftAnalyzeRequest(BaseModel):
    """A not-yet-created job description, analyzed without persisting it."""

    title: str
    description: str


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[list[str]] = None
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    nice_to_have_skills: Optional[list[str]] = None
    status: Optional[str] = None  # "open" | "paused" | "closed"
    sourcing_mode: Optional[str] = None  # "internal" | "external" | "both"


class JobResponse(ORMModel):
    id: UUID
    title: str
    description: str
    required_skills: Optional[list[Any]] = None
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    nice_to_have_skills: Optional[list[Any]] = None
    status: str = "open"
    sourcing_mode: str = "both"
    #: The interview loop, so the workspace can render the pipeline and board.
    rounds: list[InterviewRound] = Field(default_factory=list)
    scoring_weights: ScoringWeights = Field(default_factory=ScoringWeights)
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class JobAnalyzeResponse(BaseModel):
    # None when analyzing an unsaved draft (POST /api/jobs/analyze-draft).
    job_id: Optional[UUID] = None
    title: str
    required_skills: list[str]
    nice_to_have_skills: list[str]
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    summary: Optional[str] = None
    requirements: list[Any] = Field(default_factory=list)
    analyzed_by: Optional[str] = None


# ---------- Evaluations ----------


class EvidenceResponse(ORMModel):
    id: UUID
    evaluation_id: UUID
    skill_name: Optional[str] = None
    resume_text_snippet: Optional[str] = None
    source_section: Optional[str] = None
    confidence_score: Optional[Decimal] = None
    dimension: Optional[str] = None
    created_at: datetime


class DimensionDetail(BaseModel):
    score: float
    explanation: str
    evidence: list[EvidenceResponse] = Field(default_factory=list)


class CandidateDimensions(BaseModel):
    overall_fit: DimensionDetail
    technical_skills: DimensionDetail
    communication: DimensionDetail
    role_alignment: DimensionDetail


class EvaluationResponse(ORMModel):
    id: UUID
    candidate_id: UUID
    job_id: UUID
    overall_score: Optional[Decimal] = None
    skill_match_score: Optional[Decimal] = None
    experience_match_score: Optional[Decimal] = None
    education_match_score: Optional[Decimal] = None
    certification_match_score: Optional[Decimal] = None
    project_match_score: Optional[Decimal] = None
    technical_skills_score: Optional[Decimal] = None
    communication_score: Optional[Decimal] = None
    role_alignment_score: Optional[Decimal] = None
    matched_skills: Optional[list[Any]] = None
    missing_skills: Optional[list[Any]] = None
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    transferable_skills: Optional[str] = None
    blind_review_mode: bool = False
    pipeline_stage: Optional[str] = "screened"
    created_at: datetime
    evidence: list[EvidenceResponse] = Field(default_factory=list)
    dimensions: Optional[CandidateDimensions] = None


class CompareRequest(BaseModel):
    job_id: UUID
    candidate_ids: list[UUID] = Field(min_length=2, max_length=10)
    blind_mode: bool = False


class CompareResponse(BaseModel):
    job_id: UUID
    comparison: str
    candidates: list[RankedCandidate]
    candidates_compared: list[UUID]


class BlindReviewRequest(BaseModel):
    enabled: bool = True


# ---------- ATS Benchmark Baseline Scoring ----------


class EquivalentTerm(BaseModel):
    resume_term: str
    jd_keyword: str


class AtsBenchmarkResponse(ORMModel):
    id: UUID
    evaluation_id: UUID
    candidate_id: UUID
    job_id: UUID
    keyword_score: Optional[Decimal] = None
    matched_keywords: list[Any] = Field(default_factory=list)
    missing_keywords: list[Any] = Field(default_factory=list)
    missing_required: list[Any] = Field(default_factory=list)
    missing_nice_to_have: list[Any] = Field(default_factory=list)
    required_coverage_pct: Optional[Decimal] = None
    meets_required: bool = False
    semantic_score: Optional[Decimal] = None
    semantic_rationale: Optional[str] = None
    equivalent_terms: list[EquivalentTerm] = Field(default_factory=list)
    score_delta: Optional[Decimal] = None
    verdict: str  # "semantic_stronger" | "keyword_stronger" | "aligned"
    #              | "no_keyword_baseline" | "semantic_unavailable"
    created_at: datetime
    updated_at: datetime


# ---------- Resumes ----------


class ResumeUploadItem(BaseModel):
    resume_id: UUID
    filename: str
    status: str
    progress: int = 0
    error: Optional[str] = None
    candidate_id: Optional[UUID] = None
    duplicate: bool = False


class ResumeUploadResponse(BaseModel):
    batch_id: str
    files: list[ResumeUploadItem]
    message: str


class ResumeDetailResponse(BaseModel):
    resume_id: UUID
    filename: str
    status: str
    progress: int
    error: Optional[str] = None
    blob_path: Optional[str] = None
    candidate: Optional[CandidateResponse] = None


# ---------- Dashboard ----------


class SkillCount(BaseModel):
    skill: str
    count: int


class ScoreBucket(BaseModel):
    bucket: str
    count: int


class SkillCoverage(BaseModel):
    skill: str
    is_must_have: bool
    coverage_pct: float
    candidates_matching: int
    total_candidates: int
    low_score_without_skill_pct: float


class DashboardInsights(BaseModel):
    job_id: UUID
    total_candidates: int
    evaluated_candidates: int
    average_score: float
    top_skills: list[SkillCount]
    common_missing_skills: list[SkillCount]
    average_experience_years: float
    qualification_gaps_summary: str
    pipeline_status: dict[str, int]
    pipeline_progression: dict[str, int] = Field(default_factory=dict)
    candidate_sources: dict[str, int] = Field(default_factory=dict)
    skill_coverage: list[SkillCoverage] = Field(default_factory=list)
    jd_suggestions_count: int = 0
    jd_top_flag: Optional[str] = None


class JDRecommendation(BaseModel):
    id: UUID
    skill: str
    is_must_have: bool
    coverage_pct: float
    candidates_matching: int
    total_candidates: int
    classification: Literal[
        "too_strict",
        "low_signal",
        "under_filtered",
        "balanced",
        "insufficient_data",
    ]
    suggested_modification: str
    supporting_data: dict[str, Any] = Field(default_factory=dict)
    status: Literal["pending", "accepted", "rejected", "modified"] = "pending"
    recruiter_note: Optional[str] = None


class JDOptimizationResponse(BaseModel):
    job_id: UUID
    job_title: str
    recommendations: list[JDRecommendation]
    summary: str
    generated_at: datetime
    empty_reason: Optional[str] = None


class JDRecommendationDecisionRequest(BaseModel):
    status: Literal["accepted", "rejected", "modified"]
    note: Optional[str] = None


class DashboardDistribution(BaseModel):
    job_id: UUID
    score_distribution: list[ScoreBucket]
    experience_levels: dict[str, int]
    pipeline_progression: dict[str, int] = Field(default_factory=dict)
    candidate_sources: dict[str, int] = Field(default_factory=dict)


# ---------- Top-level recruiter dashboard: job listings & pipeline ----------


class JobPipelineSummary(BaseModel):
    job_id: UUID
    title: str
    status: str
    sourcing_mode: str = "both"
    created_at: datetime
    total_candidates: int
    internal_candidates: int
    external_candidates: int
    average_score: float
    stage_counts: dict[str, int]



class PipelineCandidate(BaseModel):
    candidate_id: UUID
    candidate_name: str
    candidate_email: Optional[str] = None
    source: str
    employment_status: Optional[str] = None
    overall_score: Optional[float] = None
    stage: str
    #: Which interview round they are in, set only while stage is
    #: "interviewing" and only once someone has been placed explicitly.
    round_id: Optional[str] = None
    round_name: Optional[str] = None
    round_sequence: Optional[int] = None
    #: Who last moved them — blank for a stage that was derived, not chosen.
    moved_by: Optional[str] = None
    moved_by_name: Optional[str] = None
    moved_by_role: Optional[str] = None
    updated_at: datetime


class CandidateMoveRequest(BaseModel):
    """Move one candidate to a stage, optionally into a specific round."""

    stage: str
    round_id: Optional[str] = None
    candidate_name: Optional[str] = None
    note: Optional[str] = None


class CandidatePlacementResponse(BaseModel):
    job_id: UUID
    candidate_id: str
    stage: str
    round_id: Optional[str] = None
    round_name: Optional[str] = None
    round_sequence: Optional[int] = None
    moved_by: Optional[str] = None
    moved_by_name: Optional[str] = None
    moved_by_role: Optional[str] = None
    note: Optional[str] = None
    updated_at: datetime


# ---------- Agent ----------


class AgentAskRequest(BaseModel):
    query: Optional[str] = None
    question: Optional[str] = None
    job_id: Optional[UUID] = None
    session_id: Optional[UUID] = None
    chatbot_conversation_id: Optional[str] = None
    blind_mode: bool = False
    weights: Optional[WeightConfig] = None
    candidate_id: Optional[UUID] = None
    model_id: Optional[str] = None
    attachment_ids: list[UUID] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_prompt(self) -> "AgentAskRequest":
        text = self.query or self.question
        if not text or not str(text).strip():
            raise ValueError("Field 'query' or 'question' is required.")
        return self

    @property
    def prompt_text(self) -> str:
        text = self.query or self.question or ""
        return text.strip()



class AgentAskResponse(BaseModel):
    session_id: UUID
    response: str
    candidates_referenced: list[UUID] = Field(default_factory=list)
    chat_turn: int
    source: str = "local"  # "chatbot" | "local" | "agent"
    engine: str = "deterministic"  # "agent" | "deterministic" | "chatbot" | "comparison"
    tools: list[str] = Field(default_factory=list)
    citations: list[Any] = Field(default_factory=list)
    chatbot_conversation_id: Optional[str] = None
    job_id: Optional[UUID] = None
    candidate_id: Optional[UUID] = None
    model_id: str = "gpt-4o"
    structured: Optional[dict[str, Any]] = None


class AgentStatusResponse(BaseModel):
    local_agent: bool = True
    chatbot: dict[str, Any]


class AgentSessionResponse(ORMModel):
    id: UUID
    recruiter_email: Optional[str] = None
    job_id: Optional[UUID] = None
    messages: list[Any] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
    candidate_id: Optional[UUID] = None
    candidate_name: Optional[str] = None
    title: Optional[str] = None


# ---------- Copilot structured payloads ----------
#
# Every tool function in `copilot_agent.py` optionally returns a `structured`
# payload built from rows it already computed. All variants share a `type`
# discriminator so the frontend can switch on `.type`; `AgentAskResponse.
# structured` carries whichever one applies as a plain dict
# (`.model_dump(mode="json")`).


class AgentCandidateCard(BaseModel):
    type: Literal["candidate_card"] = "candidate_card"
    candidate_id: Optional[str] = None
    label: str
    rank: Optional[int] = None
    score: Optional[float] = None
    years: Optional[float] = None
    level: Optional[str] = None
    categories: dict[str, float] = Field(default_factory=dict)
    must_haves: Optional[dict[str, Any]] = None
    skills: list[str] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    gaps: list[str] = Field(default_factory=list)
    summary: Optional[str] = None
    source: Optional[str] = None
    employment_status: Optional[str] = None
    current_assignment: Optional[str] = None


class AgentRankingList(BaseModel):
    type: Literal["ranking_list"] = "ranking_list"
    candidates: list[AgentCandidateCard] = Field(default_factory=list)


class AgentComparisonTable(BaseModel):
    type: Literal["comparison_table"] = "comparison_table"
    candidates: list[AgentCandidateCard] = Field(default_factory=list)


class AgentRequirementVerdict(BaseModel):
    requirement: Optional[str] = None
    category: Optional[str] = None
    must: bool = False
    status: Optional[str] = None
    score: Optional[float] = None
    justification: Optional[str] = None


class AgentEvaluationSummary(BaseModel):
    type: Literal["evaluation_summary"] = "evaluation_summary"
    candidate: AgentCandidateCard
    verdicts: list[AgentRequirementVerdict] = Field(default_factory=list)


class AgentMustHaveRow(BaseModel):
    requirement: Optional[str] = None
    met_count: int = 0
    candidates: list[str] = Field(default_factory=list)


class AgentMustHaveReport(BaseModel):
    type: Literal["must_have_report"] = "must_have_report"
    rows: list[AgentMustHaveRow] = Field(default_factory=list)
    candidates_meeting_all: list[str] = Field(default_factory=list)


class CopilotModelInfo(BaseModel):
    id: str
    label: str
    description: str = ""
    is_default: bool = False


class AgentModelsResponse(BaseModel):
    models: list[CopilotModelInfo] = Field(default_factory=list)
    default_model_id: str


class AgentAttachmentResponse(ORMModel):
    id: UUID
    session_id: Optional[UUID] = None
    recruiter_email: Optional[str] = None
    filename: str
    blob_path: Optional[str] = None
    content_type: Optional[str] = None
    size_bytes: int = 0
    status: str = "queued"
    kind: Optional[str] = None
    extracted_summary: Optional[str] = None
    candidate_id: Optional[UUID] = None
    error: Optional[str] = None
    created_at: datetime


# ---------- Fraud / background verification ----------


class FraudScreenRequest(BaseModel):
    name: str
    email: str
    employers: list[str] = Field(default_factory=list)
    education: list[str] = Field(default_factory=list)
    location: Optional[str] = None


class FraudScreenCandidate(FraudScreenRequest):
    id: str


class FraudScreenBatchRequest(BaseModel):
    candidates: list[FraudScreenCandidate]


class FraudSignal(BaseModel):
    id: str
    label: str
    severity: str


class FraudScreenResponse(BaseModel):
    status: str
    risk_score: int
    summary: str
    checks: dict[str, bool]
    sources: dict[str, str]
    signals: list[FraudSignal]
    details: dict[str, Any] = Field(default_factory=dict)


class FraudScreenBatchItem(FraudScreenResponse):
    id: str


class FraudScreenBatchResponse(BaseModel):
    results: list[FraudScreenBatchItem]


# ---------- Resume / profile consistency review ----------


class ConsistencyFlag(BaseModel):
    id: str
    category: str  # missing_document | date_conflict | overlapping_positions | title_inconsistency | inflated_experience | external_discrepancy
    label: str
    severity: str  # low | medium | high
    detail: Optional[str] = None


class ResumeConsistencyResponse(BaseModel):
    candidate_id: str
    flags: list[ConsistencyFlag]
    flagged_count: int
    requires_review: bool
    summary: str
    engine: str  # "azure-openai" | "heuristic"


class ResumeConsistencyBatchRequest(BaseModel):
    candidate_ids: list[UUID]


class ResumeConsistencyBatchResponse(BaseModel):
    results: list[ResumeConsistencyResponse]


# ---------- Interview handoff & historical data ----------


class CandidateHistoryEventResponse(ORMModel):
    id: UUID
    candidate_id: str
    candidate_name: Optional[str] = None
    job_id: Optional[str] = None
    job_title: Optional[str] = None
    event_type: str
    actor_email: Optional[str] = None
    summary: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime


class BriefingScorecard(BaseModel):
    overall_score: Optional[float] = None
    skill_score: Optional[float] = None
    experience_score: Optional[float] = None
    education_score: Optional[float] = None
    certification_score: Optional[float] = None
    project_score: Optional[float] = None


class CandidateBriefing(BaseModel):
    candidate_id: str
    candidate_name: str
    candidate_email: Optional[str] = None
    job_id: Optional[str] = None
    job_title: Optional[str] = None
    generated_at: datetime
    scorecard: BriefingScorecard = Field(default_factory=BriefingScorecard)
    matched_skills: list[Any] = Field(default_factory=list)
    missing_skills: list[Any] = Field(default_factory=list)
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    transferable_skills: Optional[str] = None
    evidence_highlights: list[Any] = Field(default_factory=list)
    interview_focus_areas: list[str] = Field(default_factory=list)
    recruiter_notes: Optional[str] = None


class HandoffCreateRequest(BaseModel):
    candidate_id: str
    candidate_name: str
    candidate_email: Optional[str] = None
    job_id: Optional[str] = None
    job_title: Optional[str] = None
    interviewer_name: str
    interviewer_email: EmailStr
    recruiter_notes: Optional[str] = None
    # Inline score snapshot — the ranking UI can show candidates that only
    # exist client-side, so we can't always look this up from an Evaluation row.
    scorecard: Optional[BriefingScorecard] = None
    matched_skills: list[Any] = Field(default_factory=list)
    missing_skills: list[Any] = Field(default_factory=list)
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    transferable_skills: Optional[str] = None
    evidence_highlights: list[Any] = Field(default_factory=list)


class HandoffResponse(ORMModel):
    id: UUID
    candidate_id: str
    candidate_name: str
    candidate_email: Optional[str] = None
    job_id: Optional[str] = None
    job_title: Optional[str] = None
    interviewer_name: str
    interviewer_email: str
    created_by: Optional[str] = None
    briefing: CandidateBriefing
    status: str
    interviewer_notes: Optional[str] = None
    email_sent: bool = False
    email_source: Optional[str] = None
    created_at: datetime
    viewed_at: Optional[datetime] = None
    acknowledged_at: Optional[datetime] = None


class HandoffAcknowledgeRequest(BaseModel):
    interviewer_notes: Optional[str] = None


# ---------- Candidate decisions (approve / reject) ----------


class CandidateDecisionRequest(BaseModel):
    candidate_id: str
    name: str
    email: str
    decision: str  # "approved" | "rejected"
    job_title: Optional[str] = "this role"


class InterviewSlotOut(BaseModel):
    label: str
    start: str
    end: str
    outlook_url: str


class CandidateDecisionResponse(BaseModel):
    candidate_id: str
    decision: str
    email_sent: bool
    email_source: str
    email_error: Optional[str] = None
    calendar_slots: list[InterviewSlotOut] = Field(default_factory=list)


# ---------- Ops / SRE dashboard ----------


class OpsServiceStatus(BaseModel):
    service: str
    label: str
    status: str  # "healthy" | "degraded" | "critical"
    detail: str


class OpsOverviewResponse(BaseModel):
    generated_at: datetime
    overall_status: str
    services: list[OpsServiceStatus]


class OpsRequestBucket(BaseModel):
    bucket_start: datetime
    count: int
    error_count: int
    avg_latency_ms: float


class OpsRequestHealthResponse(BaseModel):
    window_hours: int
    total_requests: int
    error_rate_pct: float
    avg_latency_ms: float
    p95_latency_ms: float
    buckets: list[OpsRequestBucket]


class OpsAiServiceStat(BaseModel):
    service: str
    label: str
    call_count: int
    failure_count: int
    fallback_count: int
    avg_latency_ms: float
    p95_latency_ms: float
    mock_call_pct: float
    breaker_open: Optional[bool] = None
    consecutive_failures: Optional[int] = None


class OpsAiServiceHealthResponse(BaseModel):
    window_hours: int
    services: list[OpsAiServiceStat]


class OpsToolUsage(BaseModel):
    tool: str
    count: int


class OpsAgentHealthResponse(BaseModel):
    window_hours: int
    total_turns: int
    deterministic_turns: int
    agent_turns: int
    fallback_turns: int
    fallback_rate_pct: float
    tool_usage: list[OpsToolUsage]


class OpsLogEntry(BaseModel):
    created_at: datetime
    event_type: str
    service: str
    status: str
    duration_ms: float
    error_message: Optional[str] = None
    details: dict[str, Any] = Field(default_factory=dict)


class OpsLogsResponse(BaseModel):
    window_hours: int
    total_count: int
    entries: list[OpsLogEntry]


class OpsEndpointStat(BaseModel):
    method: str
    path: str
    count: int
    error_count: int
    error_rate_pct: float
    avg_latency_ms: float


class OpsEndpointBreakdownResponse(BaseModel):
    window_hours: int
    endpoints: list[OpsEndpointStat]
