import uuid

from fastapi import APIRouter

from app.dependencies import AppStore, RecruiterEmail
from app.models.evaluation import AuditLog
from app.models.schemas import (
    AtsBenchmarkResponse,
    BlindReviewRequest,
    CompareRequest,
    CompareResponse,
    EvidenceResponse,
    EvaluationResponse,
)
from app.services import ats_benchmark_service, handoff_service
from app.services.candidate_comparison import candidate_comparison
from app.storage.store import Store
from app.utils.error_handlers import NotFoundError
from app.utils.logger import get_logger
from app.utils.validators import redact_pii

router = APIRouter()
logger = get_logger(__name__)


def _log_audit(store: Store, **fields) -> None:
    try:
        store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


@router.post("/compare", response_model=CompareResponse)
async def compare_candidates(
    payload: CompareRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    result = await candidate_comparison.compare(
        store, payload.job_id, payload.candidate_ids, blind_mode=payload.blind_mode
    )
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="compare_candidates",
        resource_type="job",
        resource_id=payload.job_id,
        details={"candidate_ids": [str(c) for c in payload.candidate_ids]},
    )
    return result


@router.get("/{evaluation_id}/evidence", response_model=list[EvidenceResponse])
def get_evidence(evaluation_id: uuid.UUID, store: AppStore):
    evaluation = store.evaluations.get(evaluation_id)
    if not evaluation:
        raise NotFoundError("Evaluation not found", {"evaluation_id": str(evaluation_id)})
    evidence = store.evidence.list_for_evaluation(evaluation_id)
    return sorted(evidence, key=lambda e: e.created_at)


@router.get("/{evaluation_id}", response_model=EvaluationResponse)
def get_evaluation(evaluation_id: uuid.UUID, store: AppStore):
    evaluation = store.evaluations.get(evaluation_id)
    if not evaluation:
        raise NotFoundError("Evaluation not found", {"evaluation_id": str(evaluation_id)})
    evidence = sorted(store.evidence.list_for_evaluation(evaluation_id), key=lambda e: e.created_at)
    data = EvaluationResponse.model_validate(evaluation)
    data.evidence = [EvidenceResponse.model_validate(e) for e in evidence]
    return data


@router.post("/{candidate_id}/{job_id}/blind-review", response_model=EvaluationResponse)
def toggle_blind_review(
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    payload: BlindReviewRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    evaluation = store.evaluations.get_for(job_id, candidate_id)
    if not evaluation:
        raise NotFoundError(
            "Evaluation not found for candidate/job",
            {"candidate_id": str(candidate_id), "job_id": str(job_id)},
        )

    evaluation.blind_review_mode = payload.enabled
    if payload.enabled:
        evaluation.strengths = redact_pii(evaluation.strengths or "")
        evaluation.weaknesses = redact_pii(evaluation.weaknesses or "")
        evaluation.transferable_skills = redact_pii(evaluation.transferable_skills or "")

    store.evaluations.save(evaluation)

    candidate = store.candidates.get(candidate_id)
    _log_audit(
        store,
        recruiter_email=recruiter_email,
        action="toggle_blind_review",
        resource_type="evaluation",
        resource_id=evaluation.id,
        details={"enabled": payload.enabled},
    )
    handoff_service.log_history_event(
        store,
        candidate_id=str(candidate_id),
        candidate_name=candidate.name if candidate else None,
        job_id=str(job_id),
        event_type="blind_review_toggled",
        actor_email=recruiter_email,
        summary=f"Blind review {'enabled' if payload.enabled else 'disabled'}",
        details={"enabled": payload.enabled},
    )

    evidence = store.evidence.list_for_evaluation(evaluation.id)
    response = EvaluationResponse.model_validate(evaluation)
    response.evidence = [EvidenceResponse.model_validate(e) for e in evidence]
    return response


def _score_label(score) -> str:
    """Either half of the benchmark can be absent; say so rather than "None"."""
    return "n/a" if score is None else str(score)


@router.post("/{candidate_id}/{job_id}/ats-benchmark", response_model=AtsBenchmarkResponse)
async def run_ats_benchmark(
    candidate_id: uuid.UUID,
    job_id: uuid.UUID,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Run (or re-run) the dual ATS-keyword-baseline vs LLM-semantic benchmark."""
    candidate = store.candidates.get(candidate_id)
    job = store.jobs.get(job_id)
    if not candidate or not job:
        raise NotFoundError(
            "Candidate or job not found", {"candidate_id": str(candidate_id), "job_id": str(job_id)}
        )
    evaluation = store.evaluations.get_for(job_id, candidate_id)
    if not evaluation:
        raise NotFoundError(
            "Score this candidate against the job before requesting an ATS benchmark",
            {"candidate_id": str(candidate_id), "job_id": str(job_id)},
        )

    result = await ats_benchmark_service.get_benchmark(candidate, job)
    benchmark = ats_benchmark_service.upsert_benchmark(store, evaluation, candidate, job, result)

    handoff_service.log_history_event(
        store,
        candidate_id=str(candidate.id),
        candidate_name=candidate.name,
        job_id=str(job.id),
        job_title=job.title,
        event_type="ats_benchmark_computed",
        actor_email=recruiter_email,
        summary=(
            f"ATS keyword baseline {_score_label(result['keyword_score'])} vs "
            f"AI semantic {_score_label(result['semantic_score'])} "
            f"({result['verdict'].replace('_', ' ')})"
        ),
        details={
            "keyword_score": result["keyword_score"],
            "semantic_score": result["semantic_score"],
            "score_delta": result["score_delta"],
            "verdict": result["verdict"],
        },
    )
    return benchmark


@router.get("/{candidate_id}/{job_id}/ats-benchmark", response_model=AtsBenchmarkResponse)
def get_ats_benchmark(candidate_id: uuid.UUID, job_id: uuid.UUID, store: AppStore):
    evaluation = store.evaluations.get_for(job_id, candidate_id)
    benchmark = (
        store.ats_benchmarks.get_for_evaluation(evaluation.id) if evaluation else None
    )
    if not benchmark:
        raise NotFoundError(
            "No ATS benchmark computed yet for this candidate/job",
            {"candidate_id": str(candidate_id), "job_id": str(job_id)},
        )
    return benchmark
