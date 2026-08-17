from datetime import datetime
from decimal import Decimal
from typing import Any, Literal, Optional
from uuid import UUID

from pydantic import BaseModel, ConfigDict, EmailStr, Field


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


# ---------- Candidates ----------


class CandidateBase(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = None
    skills: list[Any] = Field(default_factory=list)
    experience: list[Any] = Field(default_factory=list)
    education: list[Any] = Field(default_factory=list)
    certifications: list[Any] = Field(default_factory=list)
    projects: list[Any] = Field(default_factory=list)
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None


class CandidateCreate(CandidateBase):
    resume_text: Optional[str] = None


class CandidateUpdate(BaseModel):
    name: Optional[str] = None
    phone: Optional[str] = None
    skills: Optional[list[Any]] = None
    experience: Optional[list[Any]] = None
    education: Optional[list[Any]] = None
    certifications: Optional[list[Any]] = None
    projects: Optional[list[Any]] = None
    github_url: Optional[str] = None
    linkedin_url: Optional[str] = None
    portfolio_url: Optional[str] = None
    enriched_profile: Optional[dict[str, Any]] = None


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


# ---------- Jobs ----------


class JobCreate(BaseModel):
    title: str
    description: str
    required_skills: list[str] = Field(default_factory=list)
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    nice_to_have_skills: list[str] = Field(default_factory=list)
    created_by: Optional[str] = None


class JobUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    required_skills: Optional[list[str]] = None
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    nice_to_have_skills: Optional[list[str]] = None


class JobResponse(ORMModel):
    id: UUID
    title: str
    description: str
    required_skills: Optional[list[Any]] = None
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    nice_to_have_skills: Optional[list[Any]] = None
    created_by: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class JobAnalyzeResponse(BaseModel):
    job_id: UUID
    title: str
    required_skills: list[str]
    nice_to_have_skills: list[str]
    required_experience_years: Optional[int] = None
    education_requirements: Optional[str] = None
    summary: Optional[str] = None


# ---------- Evaluations ----------


class EvidenceResponse(ORMModel):
    id: UUID
    evaluation_id: UUID
    skill_name: Optional[str] = None
    resume_text_snippet: Optional[str] = None
    source_section: Optional[str] = None
    confidence_score: Optional[Decimal] = None
    created_at: datetime


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
    matched_skills: Optional[list[Any]] = None
    missing_skills: Optional[list[Any]] = None
    strengths: Optional[str] = None
    weaknesses: Optional[str] = None
    transferable_skills: Optional[str] = None
    blind_review_mode: bool = False
    created_at: datetime
    evidence: list[EvidenceResponse] = Field(default_factory=list)


class CompareRequest(BaseModel):
    job_id: UUID
    candidate_ids: list[UUID] = Field(min_length=2, max_length=10)


class CompareResponse(BaseModel):
    job_id: UUID
    comparison: str
    candidates: list[RankedCandidate]
    candidates_compared: list[UUID]


class BlindReviewRequest(BaseModel):
    enabled: bool = True


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
    jd_suggestions_count: int = 0
    jd_top_flag: Optional[str] = None


class JDSuggestion(BaseModel):
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
    suggestion: str


class JDOptimizationResponse(BaseModel):
    job_id: UUID
    job_title: str
    suggestions: list[JDSuggestion]
    summary: str
    generated_at: datetime


class DashboardDistribution(BaseModel):
    job_id: UUID
    score_distribution: list[ScoreBucket]
    experience_levels: dict[str, int]


# ---------- Agent ----------


class AgentAskRequest(BaseModel):
    query: str
    job_id: Optional[UUID] = None
    session_id: Optional[UUID] = None
    # External CWYD conversation id (string) when using the RAG chatbot service
    chatbot_conversation_id: Optional[str] = None


class AgentAskResponse(BaseModel):
    session_id: UUID
    response: str
    candidates_referenced: list[UUID] = Field(default_factory=list)
    chat_turn: int
    source: str = "local"  # "chatbot" | "local"
    citations: list[Any] = Field(default_factory=list)
    chatbot_conversation_id: Optional[str] = None
    job_id: Optional[UUID] = None


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
