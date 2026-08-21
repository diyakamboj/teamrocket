"""Where a candidate stands in one job's hiring pipeline.

Stage used to be derived from evaluations, handoffs and decisions (see
`job_pipeline_service`). Derivation cannot express *which* interview round a
candidate is in — "interviewing" was the whole vocabulary — and it matched
decisions to jobs by title, so two roles sharing a title shared their
pipelines. A placement records the position explicitly, per job.

Derivation is still the fallback: a candidate with no placement is read the
old way, so existing pipelines keep working and a placement is only written
once someone actually moves them.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field


def _utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


#: Namespace for deriving a placement's id from its (job, candidate) pair.
_PLACEMENT_NAMESPACE = uuid.UUID("6f0d1c2e-9b7a-4f3d-8c11-5a2e7d4b0e93")

#: Every stage a candidate can occupy, in pipeline order. "hired" and
#: "rejected" are terminal; "interviewing" is the only one that carries a
#: round, since it is the only stage the loop subdivides.
STAGE_ORDER: list[str] = [
    "screened",
    "interviewing",
    "interviewed",
    "selected",
    "hired",
    "rejected",
]

TERMINAL_STAGES = frozenset({"hired", "rejected"})


class CandidatePlacement(BaseModel):
    """One candidate's position in one job's pipeline.

    The id is derived from (job_id, candidate_id) rather than random, so a
    move is an upsert against a known key instead of a scan for an existing
    row — a candidate can only be in one place per job.
    """

    id: uuid.UUID
    job_id: uuid.UUID
    #: A plain string for the same reason `CandidateDecision.candidate_id` is
    #: — the ranking page can move candidates that exist only client-side.
    candidate_id: str
    #: Captured at move time so the board can still render this row if the
    #: candidate record cannot be resolved — a placement that silently
    #: disappears from the pipeline reads to the recruiter as "the move did
    #: nothing", which is worse than a row with a stale name.
    candidate_name: Optional[str] = None
    stage: str = "screened"
    #: Which round of the job's loop, when the stage is "interviewing".
    #: Cleared on every other stage so the two can never disagree.
    round_id: Optional[str] = None
    round_sequence: Optional[int] = None
    #: Who last moved them, and why — surfaced on the board card.
    moved_by: Optional[str] = None
    #: Display name and role at the time of the move, so the board can show
    #: "fardeen · IT Admin" without another lookup, and still can if the
    #: account is later renamed or removed.
    moved_by_name: Optional[str] = None
    moved_by_role: Optional[str] = None
    note: Optional[str] = None
    created_at: datetime = Field(default_factory=_utcnow)
    updated_at: datetime = Field(default_factory=_utcnow)

    @staticmethod
    def id_for(job_id: uuid.UUID | str, candidate_id: str) -> uuid.UUID:
        return uuid.uuid5(_PLACEMENT_NAMESPACE, f"{job_id}|{candidate_id}")

    @classmethod
    def create(cls, *, job_id: uuid.UUID, candidate_id: str, **fields) -> "CandidatePlacement":
        return cls(
            id=cls.id_for(job_id, candidate_id),
            job_id=job_id,
            candidate_id=str(candidate_id),
            **fields,
        )
