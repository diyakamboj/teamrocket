import uuid
from typing import Optional

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
from app.services.decision_service import process_decision
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
def list_candidates(store: AppStore):
    return sorted(store.candidates.list_all(), key=lambda c: c.created_at, reverse=True)


@router.get("/rank", response_model=list[RankedCandidate])
async def rank_candidates(
    store: AppStore,
    recruiter_email: RecruiterEmail,
    job_id: uuid.UUID = Query(...),
    skills: float = Query(0.40),
    experience: float = Query(0.30),
    education: float = Query(0.15),
    certifications: float = Query(0.10),
    projects: float = Query(0.05),
    communication: float = Query(0.10),
    blind_mode: bool = Query(False),
):
    weights = WeightConfig(
        skills=skills,
        experience=experience,
        education=education,
        certifications=certifications,
        projects=projects,
        communication=communication,
    )
    ranked = await candidate_matcher.rank_candidates(
        store, job_id, weight_config=weights, persist=True, blind_mode=blind_mode
    )
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="rank_candidates",
        resource_type="job",
        resource_id=job_id,
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
    if not candidate:
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

    store.candidates.save(candidate)
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
    if payload.decision not in ("approved", "rejected"):
        raise ValidationAppError(
            "decision must be 'approved' or 'rejected'", {"decision": payload.decision}
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
