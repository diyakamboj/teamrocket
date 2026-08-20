"""Interview questions generated for one round of a job's loop.

Two audiences read the same round, and they need different things:

  A **non-technical recruiter** running a screen cannot judge whether an
  answer to a systems question is any good. They get questions about
  motivation, scope and experience, each with what a solid answer sounds
  like, so they can score a call without pretending to expertise.

  A **technical interviewer** wants depth, and gets the follow-ups and the
  signal to listen for -- what separates a strong answer from a rehearsed
  one.

Difficulty is per question, so one round can open easy and escalate rather
than being uniformly hard.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class Difficulty(str, Enum):
    EASY = "easy"
    MEDIUM = "medium"
    HARD = "hard"


class Audience(str, Enum):
    #: Recruiter screen: no domain expertise assumed of the interviewer.
    NON_TECHNICAL = "non_technical"
    #: Engineer or hiring manager who can evaluate depth.
    TECHNICAL = "technical"


class InterviewQuestion(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    question: str
    difficulty: Difficulty
    audience: Audience
    #: What a good answer contains — the thing that makes this usable by
    #: someone who could not otherwise grade it.
    model_answer: str
    #: Concrete things to listen for, beyond the model answer.
    signals: list[str] = Field(default_factory=list)
    follow_ups: list[str] = Field(default_factory=list)
    #: Which JD skill or competency this probes, when it maps to one.
    competency: Optional[str] = None

    model_config = {"protected_namespaces": ()}


class RoundQuestionSet(BaseModel):
    """The generated question bank for one round of one job."""

    id: uuid.UUID = Field(default_factory=uuid.uuid4)
    job_id: uuid.UUID
    round_id: str
    round_name: str
    interview_type: str
    questions: list[InterviewQuestion] = Field(default_factory=list)
    #: False when the model could not be reached and these are the built-in
    #: fallbacks, so the UI can say so rather than passing them off as
    #: tailored to the role.
    generated_by_ai: bool = True
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    def for_audience(self, audience: Audience) -> list[InterviewQuestion]:
        return [q for q in self.questions if q.audience == audience]

    def by_difficulty(self, difficulty: Difficulty) -> list[InterviewQuestion]:
        return [q for q in self.questions if q.difficulty == difficulty]
