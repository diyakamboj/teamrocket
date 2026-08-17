import pytest
from app.services.screening_service import screening_service


def test_create_and_evaluate_screening_session(db, sample_candidate, sample_job):
    session = screening_service.create_session(
        db,
        candidate_id=sample_candidate.id,
        job_id=sample_job.id,
    )
    assert session.id is not None
    assert len(session.questions) == 3
    assert session.status == "pending"

    # Submit answer for question 1
    q1 = session.questions[0]
    updated = screening_service.submit_answer(
        db,
        session_id=session.id,
        question_id=q1.id,
        answer_text="I have 6 years of core Python experience working with FastAPI microservices and PostgreSQL databases.",
    )
    assert len(updated.answers) == 1
    assert updated.answers[0].score > 0
