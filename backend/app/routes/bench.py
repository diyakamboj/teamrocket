"""Bench employees: who is available internally, and matching them to roles.

A bench employee is an internal person between assignments. They are the
cheapest, fastest hire available, so the point of this module is to make them
visible and matchable before a role goes external.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Query
from pydantic import BaseModel, Field

from app.dependencies import AppStore, RecruiterEmail
from app.models.evaluation import AuditLog
from app.services.vector_store import candidate_vectors, index_candidate
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


class BenchEmployee(BaseModel):
    candidate_id: str
    name: str
    title: Optional[str] = None
    email: str
    skills: list[str] = Field(default_factory=list)
    location: Optional[str] = None
    #: Whole days since they came off their last assignment. None when the
    #: date was never recorded — shown as "unknown", never as 0.
    days_on_bench: Optional[int] = None
    bench_since: Optional[datetime] = None
    previous_assignment: Optional[str] = None


class BenchMatch(BaseModel):
    """A bench employee scored against a role."""

    candidate_id: str
    name: str
    title: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    days_on_bench: Optional[int] = None
    similarity: float


class PlaceOnBenchRequest(BaseModel):
    previous_assignment: Optional[str] = None


class AssignRequest(BaseModel):
    assignment: str


def _audit(store, **fields) -> None:
    try:
        store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


def _owned(store, candidate_id: uuid.UUID, recruiter_email: str):
    candidate = store.candidates.get(candidate_id)
    if not candidate or candidate.owner_email != recruiter_email:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})
    return candidate


def _days_on_bench(bench_since: Optional[datetime]) -> Optional[int]:
    if not bench_since:
        return None
    reference = bench_since.replace(tzinfo=None) if bench_since.tzinfo else bench_since
    return max(0, (datetime.now(timezone.utc).replace(tzinfo=None) - reference).days)


def _to_bench_employee(candidate) -> BenchEmployee:
    return BenchEmployee(
        candidate_id=str(candidate.id),
        name=candidate.name,
        title=candidate.title,
        email=candidate.email,
        skills=[str(s) for s in (candidate.skills or [])][:12],
        location=candidate.location,
        days_on_bench=_days_on_bench(candidate.bench_since),
        bench_since=candidate.bench_since,
        previous_assignment=candidate.current_assignment,
    )


@router.get("", response_model=list[BenchEmployee])
def list_bench(store: AppStore, recruiter_email: RecruiterEmail):
    """Everyone on the bench, longest-waiting first.

    Longest first because bench time is the cost this page exists to reduce.
    """
    bench = store.candidates.query(
        lambda c: c.owner_email == recruiter_email and c.employment_status == "bench"
    )
    employees = [_to_bench_employee(c) for c in bench]
    # None (unknown start date) sorts last rather than as if it were zero.
    employees.sort(key=lambda e: (e.days_on_bench is None, -(e.days_on_bench or 0)))
    return employees


@router.post("/{candidate_id}/place", response_model=BenchEmployee)
def place_on_bench(
    candidate_id: uuid.UUID,
    payload: PlaceOnBenchRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Move an internal employee onto the bench."""
    candidate = _owned(store, candidate_id, recruiter_email)

    candidate.source = "internal"
    candidate.employment_status = "bench"
    candidate.current_assignment = payload.previous_assignment or candidate.current_assignment
    if not candidate.bench_since:
        candidate.bench_since = datetime.now(timezone.utc).replace(tzinfo=None)
    store.candidates.save(candidate)

    # Keep the search index in step, so bench filters find them immediately.
    try:
        index_candidate(candidate)
    except Exception as exc:
        logger.warning("Could not re-index %s after bench change: %s", candidate.id, exc)

    _audit(
        store,
        recruiter_email=recruiter_email,
        action="bench_place",
        resource_type="candidate",
        resource_id=candidate.id,
        details={"previous_assignment": candidate.current_assignment},
    )
    return _to_bench_employee(candidate)


@router.post("/{candidate_id}/assign", response_model=BenchEmployee)
def assign_from_bench(
    candidate_id: uuid.UUID,
    payload: AssignRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Take someone off the bench onto a project."""
    candidate = _owned(store, candidate_id, recruiter_email)
    assignment = (payload.assignment or "").strip()
    if not assignment:
        raise ValidationAppError("Name the assignment they are moving to.")

    days = _days_on_bench(candidate.bench_since)
    candidate.employment_status = "assigned"
    candidate.current_assignment = assignment
    candidate.bench_since = None
    store.candidates.save(candidate)

    try:
        index_candidate(candidate)
    except Exception as exc:
        logger.warning("Could not re-index %s after assignment: %s", candidate.id, exc)

    _audit(
        store,
        recruiter_email=recruiter_email,
        action="bench_assign",
        resource_type="candidate",
        resource_id=candidate.id,
        details={"assignment": assignment, "days_on_bench": days},
    )
    return _to_bench_employee(candidate)


@router.get("/match", response_model=list[BenchMatch])
def match_bench_to_role(
    store: AppStore,
    recruiter_email: RecruiterEmail,
    job_id: Optional[uuid.UUID] = Query(None, description="Match against this job's requirements"),
    q: Optional[str] = Query(None, description="Or match against free text"),
    limit: int = Query(10, ge=1, le=50),
):
    """Which bench employees fit a role, by meaning rather than keyword.

    Uses the vector index, so "needs someone for a Kubernetes platform team"
    surfaces the SRE who never wrote that phrase.
    """
    if job_id:
        job = store.jobs.get(job_id)
        if not job:
            raise NotFoundError("Job posting not found", {"job_id": str(job_id)})
        query_text = "\n".join(
            [
                job.title,
                job.description or "",
                "Required: " + ", ".join(str(s) for s in (job.required_skills or [])),
            ]
        )
    elif q:
        query_text = q
    else:
        raise ValidationAppError("Give either a job_id or a q to match against.")

    if not candidate_vectors.available:
        raise ValidationAppError(
            "Bench matching needs an embedding deployment "
            "(AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME)."
        )

    matches = candidate_vectors.search(
        query_text, limit=limit, owner_email=recruiter_email, employment_status="bench"
    )

    results: list[BenchMatch] = []
    for match in matches:
        candidate = store.candidates.get(match.id)
        if not candidate:
            continue
        results.append(
            BenchMatch(
                candidate_id=str(candidate.id),
                name=candidate.name,
                title=candidate.title,
                skills=[str(s) for s in (candidate.skills or [])][:10],
                days_on_bench=_days_on_bench(candidate.bench_since),
                similarity=match.score,
            )
        )
    return results
