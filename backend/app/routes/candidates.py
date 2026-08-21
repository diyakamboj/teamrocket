import uuid
from datetime import datetime, timezone
from typing import Optional

from pydantic import BaseModel, Field

from fastapi import APIRouter, Query
from fastapi.concurrency import run_in_threadpool

from app.dependencies import AppStore, CanRunPipeline, RecruiterEmail
from app.models.candidate import Candidate
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


def _job_id_for_title(store: Store, job_title: Optional[str], recruiter_email: str):
    """The recruiter's job matching this title, if there is exactly one.

    CandidateDecision carries a title rather than a job id (it predates jobs
    having real pipelines), so this is best-effort: an ambiguous or unknown
    title records no job rather than guessing at one.
    """
    if not job_title:
        return None
    matches = store.jobs.query(
        lambda j: j.title == job_title and (not j.created_by or j.created_by == recruiter_email)
    )
    return matches[0].id if len(matches) == 1 else None


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


class VectorIndexStatus(BaseModel):
    """What is actually answering semantic search right now.

    Exists so the answer to "are you really using a vector database?" is
    something the product shows rather than something a person claims.
    """

    backend: str
    backend_label: str
    is_external: bool
    embedding_model: str
    dimensions: int
    reachable: bool
    documents_indexed: Optional[int] = None
    indexed_for_me: int
    my_candidates: int
    detail: str
    #: One entry per engine when more than one is in play, so a half-down
    #: pair is visible rather than averaged into a single "connected".
    engines: list["VectorEngineStatus"] = Field(default_factory=list)


class VectorEngineStatus(BaseModel):
    name: str
    role: str  # what this engine contributes to a query
    reachable: bool
    documents_indexed: Optional[int] = None


@router.get("/index-status", response_model=VectorIndexStatus)
def vector_index_status(store: AppStore, recruiter_email: RecruiterEmail):
    """Live state of the vector index backing semantic search."""
    from app.config import settings
    from app.services.azure_services import search_service
    from app.services.qdrant_store import candidate_qdrant

    backend = settings.VECTOR_BACKEND
    mine = store.candidates.query(lambda c: c.owner_email == recruiter_email)
    indexed_for_me = candidate_vectors.count(
        lambda metadata: metadata.get("owner_email") == recruiter_email
    )

    if backend == "dual":
        remote_ids = search_service.list_document_ids()
        azure_up = remote_ids is not None
        qdrant_up = candidate_qdrant.available
        engines = [
            VectorEngineStatus(
                name="Qdrant",
                role="Vector search (HNSW, cosine)",
                reachable=qdrant_up,
                documents_indexed=candidate_qdrant.count() if qdrant_up else None,
            ),
            VectorEngineStatus(
                name="Azure AI Search",
                role="Keyword search (BM25)",
                reachable=azure_up,
                documents_indexed=len(remote_ids) if remote_ids is not None else None,
            ),
        ]
        both = azure_up and qdrant_up
        return VectorIndexStatus(
            backend=backend,
            backend_label="Qdrant + Azure AI Search",
            is_external=True,
            embedding_model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME or "unset",
            dimensions=1536,
            # Either engine alone still answers, so this is only false when
            # both are down and search has fallen back to the local index.
            reachable=azure_up or qdrant_up,
            documents_indexed=candidate_qdrant.count() if qdrant_up else (
                len(remote_ids) if remote_ids is not None else None
            ),
            indexed_for_me=indexed_for_me,
            my_candidates=len(mine),
            engines=engines,
            detail=(
                "Vector and keyword results are fused, so meaning and exact terms both rank."
                if both
                else "One engine is unreachable — results come from the other alone."
            ),
        )

    if backend == "search":
        remote_ids = search_service.list_document_ids()
        reachable = remote_ids is not None
        return VectorIndexStatus(
            backend=backend,
            backend_label="Azure AI Search (vector index)",
            is_external=True,
            embedding_model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME or "unset",
            dimensions=1536,
            reachable=reachable,
            documents_indexed=len(remote_ids) if remote_ids is not None else None,
            indexed_for_me=indexed_for_me,
            my_candidates=len(mine),
            detail=(
                f"HNSW index '{settings.AZURE_SEARCH_INDEX_NAME}', cosine similarity."
                if reachable
                else "Index unreachable — semantic search is falling back to the local index."
            ),
        )

    if backend == "qdrant":
        reachable = candidate_qdrant.available
        return VectorIndexStatus(
            backend=backend,
            backend_label="Qdrant (vector database)",
            is_external=True,
            embedding_model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME or "unset",
            dimensions=1536,
            reachable=reachable,
            documents_indexed=candidate_qdrant.count() if reachable else None,
            indexed_for_me=indexed_for_me,
            my_candidates=len(mine),
            detail=(
                f"Collection '{settings.QDRANT_COLLECTION}', HNSW, cosine distance."
                if reachable
                else "Qdrant unreachable — semantic search is falling back to the local index."
            ),
        )

    return VectorIndexStatus(
        backend=backend,
        backend_label="Local vector index (blob-backed)",
        is_external=False,
        embedding_model=settings.AZURE_OPENAI_EMBEDDING_DEPLOYMENT_NAME or "unset",
        dimensions=1536,
        reachable=True,
        documents_indexed=candidate_vectors.count(),
        indexed_for_me=indexed_for_me,
        my_candidates=len(mine),
        detail="Exact cosine search over vectors stored in blob storage.",
    )


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



class MoveToRoleRequest(BaseModel):
    """Move a candidate to a role, or back to the pool.

    `job_id: null` removes them from whatever role they are on. They stay in
    the recruiter's pool and can be ranked for any opening again -- removing
    someone from a role is not the same as deleting them.
    """

    job_id: Optional[uuid.UUID] = None
    #: The board they are being taken off, when that is not simply the role
    #: recorded on the candidate. A pool candidate reaches a board by having
    #: been scored against it, so clearing `job_id` alone leaves them sitting
    #: there and the removal looks like it did nothing.
    from_job_id: Optional[uuid.UUID] = None


@router.put("/{candidate_id}/role", response_model=CandidateResponse)
def move_candidate_to_role(
    candidate_id: uuid.UUID,
    payload: MoveToRoleRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Move a candidate between roles, or off a role entirely."""
    candidate = store.candidates.get(candidate_id)
    if not candidate or candidate.owner_email != recruiter_email:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

    previous_job_id = candidate.job_id

    if payload.job_id is not None:
        job = store.jobs.get(payload.job_id)
        if not job or (job.created_by and job.created_by != recruiter_email):
            raise NotFoundError("Job posting not found", {"job_id": str(payload.job_id)})

    candidate.job_id = payload.job_id

    leaving = payload.from_job_id or previous_job_id
    exclusions = [str(x) for x in (candidate.excluded_job_ids or [])]
    if leaving is not None and str(leaving) != str(payload.job_id or ""):
        # Record it so the next ranking run does not undo the removal.
        if str(leaving) not in exclusions:
            candidate.excluded_job_ids = [*(candidate.excluded_job_ids or []), leaving]
    if payload.job_id is not None:
        # Being put on a role is the explicit reversal of having been removed.
        candidate.excluded_job_ids = [
            x for x in (candidate.excluded_job_ids or []) if str(x) != str(payload.job_id)
        ]

    store.candidates.save(candidate)

    # Every route onto the board they are leaving has to go, or they stay put.
    # `job_id` is one route; an evaluation for that job is another (that is
    # how an unassigned pool candidate joins a board at all).
    if leaving is not None and str(leaving) != str(payload.job_id or ""):
        evaluation = store.evaluations.get_for(leaving, candidate_id)
        if evaluation is not None:
            store.evaluations.delete(evaluation.id)

    # A placement is stage state on a board the candidate has just left. Left
    # behind it would keep pulling them back onto that board, because an
    # explicit placement is itself a membership route.
    if leaving is not None and str(leaving) != str(payload.job_id or ""):
        for placement in store.candidate_placements.query(
            lambda p: str(p.job_id) == str(leaving)
            and str(p.candidate_id) == str(candidate_id)
        ):
            store.candidate_placements.delete(placement.id)

    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="move_candidate_role",
        resource_type="candidate",
        resource_id=candidate.id,
        details={
            "from_job_id": str(previous_job_id) if previous_job_id else None,
            "to_job_id": str(payload.job_id) if payload.job_id else None,
        },
    )
    return candidate


class InternalEmployeeRequest(BaseModel):
    """An existing employee, added without a résumé upload."""

    name: str
    email: str
    title: Optional[str] = None
    #: What they are working on now. Blank means they are between assignments.
    current_assignment: Optional[str] = None
    #: What they do in that position, not just its title.
    current_role_duties: Optional[str] = None
    location: Optional[str] = None
    skills: list[str] = Field(default_factory=list)
    #: Put them straight on the bench — the common case for someone rolling
    #: off a project.
    on_bench: bool = False
    job_id: Optional[uuid.UUID] = None


@router.post("/internal", response_model=CandidateResponse, status_code=201)
def create_internal_employee(
    payload: InternalEmployeeRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
    _role: CanRunPipeline,
):
    """Add an internal employee directly.

    Internal people are already known to the company, so requiring a résumé
    upload to get them into the system was busywork -- and it was the only
    way in, which is why the bench stayed empty.
    """
    email = payload.email.strip().lower()
    if not email or "@" not in email:
        raise ValidationAppError("A valid email is required", {"email": payload.email})
    if not payload.name.strip():
        raise ValidationAppError("A name is required")

    existing = store.candidates.query(
        lambda c: c.owner_email == recruiter_email and (c.email or "").lower() == email
    )
    if existing:
        raise ValidationAppError(
            "Someone with that email is already in your pool",
            {"email": email, "candidate_id": str(existing[0].id)},
        )

    if payload.job_id is not None:
        job = store.jobs.get(payload.job_id)
        if not job or (job.created_by and job.created_by != recruiter_email):
            raise NotFoundError("Job posting not found", {"job_id": str(payload.job_id)})

    candidate = Candidate(
        owner_email=recruiter_email,
        name=payload.name.strip(),
        email=email,
        title=payload.title,
        location=payload.location,
        skills=[s for s in payload.skills if str(s).strip()],
        source="internal",
        job_id=payload.job_id,
        employment_status="bench" if payload.on_bench else "assigned",
        current_assignment=None if payload.on_bench else payload.current_assignment,
        current_role_duties=payload.current_role_duties,
        bench_since=datetime.now(timezone.utc).replace(tzinfo=None) if payload.on_bench else None,
    )
    store.candidates.save(candidate)
    # Without this they are invisible to semantic search and bench matching.
    index_candidate(candidate)

    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="create_internal_employee",
        resource_type="candidate",
        resource_id=candidate.id,
        details={"on_bench": payload.on_bench},
    )
    return candidate


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

    # Mirror the outcome onto the candidate. Without this the decision lived
    # only in the decisions log, so every other view still treated a hired
    # person as an open candidate.
    candidate = store.candidates.get(payload.candidate_id)
    if candidate is not None and candidate.owner_email == recruiter_email:
        if payload.decision == "hired":
            candidate.hiring_status = "hired"
            candidate.hired_at = datetime.now(timezone.utc).replace(tzinfo=None)
            candidate.hired_for_job_id = _job_id_for_title(store, payload.job_title, recruiter_email)
            # They work here now, so they stop being an applicant and become
            # an employee on the assignment they were hired into.
            candidate.source = "internal"
            candidate.employment_status = "assigned"
            candidate.current_assignment = payload.job_title or candidate.current_assignment
        elif payload.decision == "rejected":
            candidate.hiring_status = "rejected"
        else:
            candidate.hiring_status = "active"
        store.candidates.save(candidate)
        index_candidate(candidate)

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


VectorIndexStatus.model_rebuild()
