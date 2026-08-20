import pytest
import uuid
from app.models.candidate import Candidate
from app.models.job_posting import JobPosting
from app.services.readiness_service import readiness_service
from app.storage.store import Store
from tests.conftest import InMemoryJsonBlobStore




@pytest.fixture
def test_store():
    return Store(blob_store=InMemoryJsonBlobStore())


@pytest.mark.asyncio
async def test_evaluate_candidate_readiness(test_store):
    candidate = Candidate(
        owner_email="recruiter@example.com",
        name="Alex Smith",
        email="alex@example.com",
        skills=["Python", "FastAPI"],
    )
    test_store.candidates.save(candidate)

    job = JobPosting(
        title="Senior Backend Engineer",
        description="Looking for Python, PostgreSQL, and System Architecture.",
    )
    test_store.jobs.save(job)

    rec = await readiness_service.evaluate_readiness(test_store, candidate_id=candidate.id, job_id=job.id)

    assert rec.candidate_id == candidate.id
    assert rec.candidate_name == "Alex Smith"
    assert rec.assessment_type in ["technical_depth", "aptitude", "domain_knowledge", "communication"]
    assert rec.reason != ""


def test_trigger_and_submit_assessment(test_store):
    candidate = Candidate(
        owner_email="recruiter@example.com",
        name="Priya Patel",
        email="priya@example.com",
        skills=["React", "TypeScript"],
    )
    test_store.candidates.save(candidate)

    record = readiness_service.trigger_assessment(
        test_store,
        candidate_id=candidate.id,
        assessment_type="technical_depth",
        target_competency="System Design & Data Modeling",
        recommendation_reason="AI recommended assessment for system architecture competency gap",
        recruiter_email="recruiter@example.com",
    )

    assert record.status == "sent"
    assert record.recruiter_approved is True
    # The assessment is recorded as sent, but the *notification* only counts
    # as sent when a mailer actually took it. Without SMTP configured it did
    # not, and the record has to reflect that.
    assert record.notification_sent is False
    assert record.notification_source == "mock"
    assert "SMTP is not configured" in (record.notification_error or "")

    # Submit assessment results
    updated = readiness_service.submit_assessment_results(
        test_store,
        assessment_id=record.id,
        score=88.5,
        result_summary="Strong performance on distributed caching and database indexing.",
    )

    assert updated.status == "completed"
    assert updated.score == 88.5

    # Check assessment list for candidate
    history = readiness_service.get_candidate_assessments(test_store, candidate_id=candidate.id)
    assert len(history) == 1
    assert history[0].id == record.id
