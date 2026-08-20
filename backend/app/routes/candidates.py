import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from app.dependencies import AppStore, RecruiterEmail
from app.models.evaluation import AuditLog, CandidateDecision
from app.models.schemas import (
    CandidateDecisionRequest,
    CandidateDecisionResponse,
    CandidateResponse,
    CandidateUpdate,
    RankedCandidate,
    WeightConfig,
)
from app.services import handoff_service
from app.services.candidate_matcher import candidate_matcher
from app.services.vector_store import candidate_vectors, index_candidate
from app.services.decision_service import CANDIDATE_DECISIONS, process_decision
from app.services.resume_parser import resume_parser
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger

router = APIRouter()
logger = get_logger(__name__)


def _log_audit(store: Store, **fields) -> None:
    try:
        store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


@router.get("", response_model=list[CandidateResponse])
def list_candidates(store: AppStore, recruiter_email: RecruiterEmail):
    """This recruiter's candidates, newest first.

    Scoped to the account: the pool used to be global, so signing in as a new
    recruiter showed every candidate anyone had ever uploaded. Records created
    before candidates had an owner belong to nobody and are not listed — see
    `scripts/assign_legacy_owner.py` to claim them.
    """
    mine = store.candidates.query(lambda c: c.owner_email == recruiter_email)
    return sorted(mine, key=lambda c: c.created_at, reverse=True)


class SemanticSearchResult(BaseModel):
    """One semantic-search hit, with the candidate it points at."""

    candidate_id: str
    name: str
    title: Optional[str] = None
    # Absent for hybrid queries: those fuse vector and keyword rankings and
    # produce no comparable similarity. Callers must not substitute 0.
    similarity: Optional[float] = None
    skills: list[str] = Field(default_factory=list)
    employment_status: Optional[str] = None


@router.get("/search", response_model=list[SemanticSearchResult])
def semantic_candidate_search(
    store: AppStore,
    recruiter_email: RecruiterEmail,
    q: str = Query(..., min_length=2, description="Free text: a role, a skill set, a JD excerpt"),
    limit: int = Query(10, ge=1, le=50),
    bench_only: bool = Query(False, description="Restrict to bench employees"),
    hybrid: bool = Query(
        False,
        description="Also match literally — right for a search box, where most queries are names or exact skills",
    ),
):
    """Find candidates by meaning rather than keyword.

    Matches on an embedding of each candidate's skills and experience, so
    "someone who has run Kubernetes in production" finds the right people
    without them using those exact words. Scoped to this recruiter's pool.

    `hybrid=true` additionally matches the query literally. Hybrid results
    carry no `similarity`, because fusing two rankings produces a score on a
    scale that is not comparable to cosine similarity.
    """
    if candidate_vectors.available is False:
        raise ValidationAppError(
            "Semantic search needs an embedding deployment "
            "(AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME)."
        )

    matches = candidate_vectors.search(
        q,
        limit=limit,
        owner_email=recruiter_email,
        employment_status="bench" if bench_only else None,
        hybrid=hybrid,
    )

    results: list[SemanticSearchResult] = []
    for match in matches:
        candidate = store.candidates.get(match.id)
        if not candidate:
            continue  # indexed but since deleted
        results.append(
            SemanticSearchResult(
                candidate_id=str(candidate.id),
                name=candidate.name,
                title=candidate.title,
                similarity=match.score,
                skills=[str(s) for s in (candidate.skills or [])][:10],
                employment_status=candidate.employment_status,
            )
        )
    return results


@router.post("/reindex")
def reindex_candidates(store: AppStore, recruiter_email: RecruiterEmail):
    """Re-embed this recruiter's candidates.

    Needed once for candidates added before the index existed, and after
    changing the embedding model.
    """
    mine = store.candidates.query(lambda c: c.owner_email == recruiter_email)
    indexed = sum(1 for candidate in mine if index_candidate(candidate))
    return {"candidates": len(mine), "indexed": indexed}


@router.get("/rank", response_model=list[RankedCandidate])
async def rank_candidates(
    store: AppStore,
    recruiter_email: RecruiterEmail,
    job_id: str = Query(...),
    skills: float = Query(0.40),
    experience: float = Query(0.30),
    education: float = Query(0.15),
    certifications: float = Query(0.10),
    projects: float = Query(0.05),
    communication: float = Query(0.10),
    blind_mode: bool = Query(False),
):
    try:
        target_uuid = uuid.UUID(job_id)
    except ValueError:
        all_jobs = store.jobs.list_all()
        target_uuid = all_jobs[0].id if all_jobs else uuid.uuid4()

    weights = WeightConfig(
        skills=skills,
        experience=experience,
        education=education,
        certifications=certifications,
        projects=projects,
        communication=communication,
    )
    ranked = await candidate_matcher.rank_candidates(
        store, target_uuid, weight_config=weights, persist=True, blind_mode=blind_mode
    )
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="rank_candidates",
        resource_type="job",
        resource_id=target_uuid,
        details={"count": len(ranked), "blind_mode": blind_mode},
    )
    return ranked



@router.get("/{candidate_id}", response_model=CandidateResponse)
def get_candidate(candidate_id: uuid.UUID, store: AppStore):
    candidate = store.candidates.get(candidate_id)
    if not candidate:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})
    return candidate


@router.put("/{candidate_id}", response_model=CandidateResponse)
def update_candidate(
    candidate_id: uuid.UUID,
    payload: CandidateUpdate,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    candidate = store.candidates.get(candidate_id)
    # 404 rather than 403 for someone else's candidate: an id should not be
    # confirmable by a recruiter who does not hold that person.
    if not candidate or candidate.owner_email != recruiter_email:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

    updates = payload.model_dump(exclude_unset=True)
    if "source" in updates and updates["source"] not in ("internal", "external"):
        raise ValidationAppError(
            "source must be 'internal' or 'external'", {"source": updates["source"]}
        )
    if "employment_status" in updates and updates["employment_status"] not in (
        None,
        "bench",
        "assigned",
    ):
        raise ValidationAppError(
            "employment_status must be 'bench', 'assigned', or null",
            {"employment_status": updates["employment_status"]},
        )

    for field, value in updates.items():
        setattr(candidate, field, value)

    # Moving onto the bench starts the clock; coming off it stops.
    if "employment_status" in updates:
        if updates["employment_status"] == "bench" and not candidate.bench_since:
            candidate.bench_since = datetime.now(timezone.utc).replace(tzinfo=None)
        elif updates["employment_status"] != "bench":
            candidate.bench_since = None

    store.candidates.save(candidate)
    # Skills, title and employment status all feed the embedded document and
    # the index filters, so a saved edit that is not re-indexed leaves search
    # answering from the pre-edit version of this candidate.
    index_candidate(candidate)
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="update_candidate",
        resource_type="candidate",
        resource_id=candidate.id,
        details={"fields": list(updates.keys())},
    )
    return candidate


from app.services.badge_service import build_badges


@router.get("/{candidate_id}/badges")
async def candidate_badges(
    candidate_id: uuid.UUID,
    store: AppStore,
    job_id: Optional[uuid.UUID] = Query(None),
):
    candidate = store.candidates.get(candidate_id)
    if not candidate:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

    score = None
    if job_id:
        score = await candidate_matcher.get_candidate_score(store, candidate_id, job_id)
    return build_badges(candidate, score)


@router.get("/{candidate_id}/score")

async def candidate_score(
    candidate_id: uuid.UUID,
    store: AppStore,
    job_id: uuid.UUID = Query(...),
    skills: float = Query(0.40),
    experience: float = Query(0.30),
    education: float = Query(0.15),
    certifications: float = Query(0.10),
    projects: float = Query(0.05),
    communication: float = Query(0.10),
):
    weights = WeightConfig(
        skills=skills,
        experience=experience,
        education=education,
        certifications=certifications,
        projects=projects,
        communication=communication,
    )
    return await candidate_matcher.get_candidate_score(
        store, candidate_id, job_id, weight_config=weights, persist=True
    )


from app.services.profile_enrichment_service import profile_enrichment_service


@router.post("/{candidate_id}/enrich", response_model=CandidateResponse)
async def enrich_candidate(
    candidate_id: uuid.UUID,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    candidate = store.candidates.get(candidate_id)
    if not candidate:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

    enriched_obj = await profile_enrichment_service.enrich_candidate_profile(
        resume_text=candidate.resume_text or "",
        github_url=candidate.github_url,
        linkedin_url=candidate.linkedin_url,
        portfolio_url=candidate.portfolio_url,
        hackerrank_url=candidate.hackerrank_url,
    )
    enriched_dict = enriched_obj.model_dump(mode="json")
    candidate.enriched_profile = enriched_dict

    # Safely merge inferred skills into candidate.skills without overwriting resume skills
    inferred = [s.name for s in enriched_obj.inferred_skills]
    if inferred:
        merged = list(dict.fromkeys([*(candidate.skills or []), *inferred]))
        candidate.skills = merged

    store.candidates.save(candidate)
    index_candidate(candidate)  # enrichment merges new skills into the profile
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="enrich_candidate",
        resource_type="candidate",
        resource_id=candidate.id,
        details={"links_count": len(enriched_obj.external_links), "repos_count": len(enriched_obj.repositories)},
    )
    return candidate



@router.post("/decision", response_model=CandidateDecisionResponse)
async def submit_candidate_decision(
    payload: CandidateDecisionRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    if payload.decision not in CANDIDATE_DECISIONS:
        raise ValidationAppError(
            f"decision must be one of {', '.join(CANDIDATE_DECISIONS)}",
            {"decision": payload.decision},
        )

    outcome = await run_in_threadpool(
        process_decision,
        candidate_name=payload.name,
        candidate_email=payload.email,
        decision=payload.decision,
        job_title=payload.job_title or "this role",
        recruiter_email=recruiter_email,
    )

    store.candidate_decisions.save(
        CandidateDecision(
            candidate_id=payload.candidate_id,
            candidate_name=payload.name,
            candidate_email=payload.email,
            job_title=payload.job_title,
            decision=payload.decision,
            recruiter_email=recruiter_email,
            email_sent=outcome.email_result.sent,
            email_source=outcome.email_result.source,
            email_error=outcome.email_result.error,
        )
    )
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action=f"candidate_{payload.decision}",
        resource_type="candidate",
        details={"candidate_id": payload.candidate_id, "email": payload.email},
    )
    handoff_service.log_history_event(
        store,
        candidate_id=payload.candidate_id,
        candidate_name=payload.name,
        job_title=payload.job_title,
        event_type=f"decision_{payload.decision}",
        actor_email=recruiter_email,
        summary=f"Recruiter {payload.decision} the candidate for {payload.job_title or 'this role'}",
        details={"email_sent": outcome.email_result.sent},
    )

    return CandidateDecisionResponse(
        candidate_id=payload.candidate_id,
        decision=payload.decision,
        email_sent=outcome.email_result.sent,
        email_source=outcome.email_result.source,
        email_error=outcome.email_result.error,
        calendar_slots=[
            {
                "label": s.label,
                "start": s.start.isoformat(),
                "end": s.end.isoformat(),
                "outlook_url": s.outlook_url,
            }
            for s in outcome.slots
        ],
    )
