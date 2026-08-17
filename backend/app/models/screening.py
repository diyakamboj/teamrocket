from datetime import datetime, timezone
import uuid
from typing import Literal, Optional
from pydantic import BaseModel, Field


class ScreeningQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    category: str = "Technical Depth"
    intent: str
    rubric: Optional[str] = None


class ScreeningAnswer(BaseModel):
    question_id: str
    answer_text: str
    score: float = 0.0  # 0 to 100
    feedback: Optional[str] = None
    evaluated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ScreeningSession(BaseModel):
    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    candidate_id: uuid.UUID
    candidate_name: str
    job_id: Optional[uuid.UUID] = None
    job_title: Optional[str] = None
    status: Literal["pending", "in_progress", "completed"] = "pending"
    questions: list[ScreeningQuestion] = Field(default_factory=list)
    answers: list[ScreeningAnswer] = Field(default_factory=list)
    overall_score: float = 0.0
    summary_pack: Optional[str] = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
