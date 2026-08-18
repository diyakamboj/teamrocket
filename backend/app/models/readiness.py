from datetime import datetime, timezone
import uuid
from typing import Literal, Optional
from pydantic import BaseModel, Field

AssessmentType = Literal["technical_depth", "aptitude", "communication", "domain_knowledge"]
AssessmentStatus = Literal["recommended", "sent", "in_progress", "completed", "reviewed", "cancelled"]


class AssessmentRecommendation(BaseModel):
    candidate_id: uuid.UUID
    candidate_name: str
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    assessment_type: AssessmentType = "technical_depth"
    reason: str
    target_competency: str
    triggered_by_gap: str
    recommended_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CandidateAssessmentRecord(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: uuid.UUID
    candidate_name: str
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    assessment_type: AssessmentType = "technical_depth"
    title: str
    status: AssessmentStatus = "recommended"
    recommendation_reason: str
    target_competency: str
    notification_sent: bool = False
    score: Optional[float] = None  # 0 to 100
    result_summary: Optional[str] = None
    recruiter_approved: bool = False
    recruiter_approved_by: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
