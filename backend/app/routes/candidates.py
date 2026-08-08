import uuid

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from app.dependencies import DbSession, RecruiterEmail
from app.models.candidate import Candidate
from app.models.evaluation import AuditLog, CandidateDecision
from app.models.schemas import (
    CandidateDecisionRequest,
    CandidateDecisionResponse,
    CandidateResponse,
    RankedCandidate,
    WeightConfig,
)
from app.services.candidate_matcher import candidate_matcher
from app.services.decision_service import process_decision
from app.services.resume_parser import resume_parser
from app.utils.error_handlers import NotFoundError, ValidationAppError

router = APIRouter()


@router.get("", response_model=list[CandidateResponse])
def list_candidates(db: DbSession):
    return db.query(Candidate).order_by(Candidate.created_at.desc()).all()


@router.get("/rank", response_model=list[RankedCandidate])
async def rank_candidates(
    db: DbSession,
    recruiter_email: RecruiterEmail,
    job_id: uuid.UUID = Query(...),
    skills: float = Query(0.40),
    experience: float = Query(0.30),
    education: float = Query(0.15),
    certifications: float = Query(0.10),
    projects: float = Query(0.05),
    blind_mode: bool = Query(False),
):
    weights = WeightConfig(
        skills=skills,
        experience=experience,
        education=education,
        certifications=certifications,
        projects=projects,
    )
    ranked = await candidate_matcher.rank_candidates(
        db, job_id, weight_config=weights, persist=True, blind_mode=blind_mode
    )
    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="rank_candidates",
            resource_type="job",
            resource_id=job_id,
            details={"count": len(ranked), "blind_mode": blind_mode},
        )
    )
    db.commit()
    return ranked


@router.get("/{candidate_id}", response_model=CandidateResponse)
def get_candidate(candidate_id: uuid.UUID, db: DbSession):
    candidate = db.get(Candidate, candidate_id)
    if not candidate:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})
    return candidate


@router.get("/{candidate_id}/score")
async def candidate_score(
    candidate_id: uuid.UUID,
    db: DbSession,
    job_id: uuid.UUID = Query(...),
    skills: float = Query(0.40),
    experience: float = Query(0.30),
    education: float = Query(0.15),
    certifications: float = Query(0.10),
    projects: float = Query(0.05),
):
    weights = WeightConfig(
        skills=skills,
        experience=experience,
        education=education,
        certifications=certifications,
        projects=projects,
    )
    return await candidate_matcher.get_candidate_score(
        db, candidate_id, job_id, weight_config=weights, persist=True
    )


@router.post("/{candidate_id}/enrich", response_model=CandidateResponse)
async def enrich_candidate(
    candidate_id: uuid.UUID,
    db: DbSession,
    recruiter_email: RecruiterEmail,
):
    candidate = db.get(Candidate, candidate_id)
    if not candidate:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

    enriched = await resume_parser.enrich_from_public_profiles(
        github_url=candidate.github_url,
        linkedin_url=candidate.linkedin_url,
    )
    candidate.enriched_profile = enriched
    inferred = enriched.get("inferred_skills") or []
    if inferred:
        merged = list(dict.fromkeys([*(candidate.skills or []), *inferred]))
        candidate.skills = merged

    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action="enrich_candidate",
            resource_type="candidate",
            resource_id=candidate.id,
        )
    )
    db.commit()
    db.refresh(candidate)
    return candidate


@router.post("/decision", response_model=CandidateDecisionResponse)
async def submit_candidate_decision(
    payload: CandidateDecisionRequest,
    db: DbSession,
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

    db.add(
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
    db.add(
        AuditLog(
            recruiter_email=recruiter_email,
            action=f"candidate_{payload.decision}",
            resource_type="candidate",
            details={"candidate_id": payload.candidate_id, "email": payload.email},
        )
    )
    db.commit()

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
