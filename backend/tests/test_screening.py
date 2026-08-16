import uuid

import pytest

from app.models.candidate import Candidate
from app.models.evaluation import Evidence
from app.services import screening_questions
from app.services.evidence_tracker import SCREENING_EVIDENCE_SECTION
from app.services.candidate_matcher import CandidateMatcher
from app.services.recruiter_agent import RecruiterCopilot
from app.services.screening_briefing import build_briefing
from app.services.screening_context import build_from_db, build_from_payload
from app.services.screening_evaluator import build_scorecard, evaluate_answer
from app.services.screening_service import screening_service

STRONG_TECHNICAL_ANSWER = (
    "I designed the Python ingestion service in production, and the hardest problem was a "
    "trade-off between throughput and ordering. We were dropping about 5% of events at scale "
    "because the consumer rebalanced, so I moved to keyed partitions and added idempotent "
    "writes. I had to debug it from the consumer lag metrics first, which showed the root cause "
    "was our commit interval. After the change we held 20k events per second with no loss."
)

WEAK_ANSWER = "Yeah I basically did some stuff with things there. It was fine."


def _profile_payload(**overrides):
    candidate = {
        "id": "c-1",
        "name": "Dana Reyes",
        "title": "Backend Engineer",
        "years": 6,
        "score": 78,
        "education": "BSc Computer Science",
        "skills": ["Python", "SQL", "Docker"],
        "strengths": ["6 years shipping Python services"],
        "gaps": ["Limited exposure to Kubernetes"],
        "evidence": [
            {"skill": "Python", "detail": "Built the billing API", "source": "Platform Team"}
        ],
    }
    candidate.update(overrides.pop("candidate", {}))
    job = {
        "title": "Backend Engineer",
        "required_skills": ["Python", "SQL", "Azure", "Docker"],
        "required_experience_years": 3,
    }
    job.update(overrides.pop("job", {}))
    return {"candidate": candidate, "job": job}


# ---------- context ----------


@pytest.mark.asyncio
async def test_context_from_db_pulls_evaluation_and_evidence(db, sample_candidate, sample_job):
    await CandidateMatcher().rank_candidates(db, sample_job.id, persist=True)
    context = build_from_db(db, candidate_id=sample_candidate.id, job_id=sample_job.id)

    assert context.candidate_name == "Alice Johnson"
    assert context.evaluation_id is not None
    assert context.overall_score is not None
    assert "Python" in context.matched_skills
    assert context.resume_evidence, "evidence rows from ranking should be available to screening"


def test_context_from_payload_derives_skill_split():
    context = build_from_payload(_profile_payload())
    assert context.candidate_ref == "c-1"
    assert set(context.matched_skills) == {"Python", "SQL", "Docker"}
    assert context.missing_skills == ["Azure"]


# ---------- question generation ----------


def test_plan_adapts_to_matched_and_missing_skills():
    context = build_from_payload(_profile_payload())
    plan = screening_questions.generate_plan(context, use_model=False)

    competencies = [q.competency for q in plan]
    assert "technical_depth" in competencies
    assert "technical_gap" in competencies
    assert "communication" in competencies

    gap_question = next(q for q in plan if q.competency == "technical_gap")
    assert "Azure" in gap_question.question
    depth_question = next(q for q in plan if q.competency == "technical_depth")
    assert "Python" in depth_question.question


def test_plan_differs_between_candidates():
    strong = build_from_payload(_profile_payload())
    weak = build_from_payload(
        _profile_payload(candidate={"id": "c-2", "name": "Sam Ng", "skills": ["Java"]})
    )
    strong_text = [q.question for q in screening_questions.generate_plan(strong, use_model=False)]
    weak_text = [q.question for q in screening_questions.generate_plan(weak, use_model=False)]
    assert strong_text != weak_text


def test_questions_cite_resume_evidence_and_requirements():
    context = build_from_payload(_profile_payload())
    plan = screening_questions.generate_plan(context, use_model=False)
    depth = next(q for q in plan if q.competency == "technical_depth")

    sources = {c["source"] for c in depth.citations}
    assert "job_requirement" in sources
    assert "resume" in sources
    assert "Built the billing API" in depth.question


def test_full_coverage_candidate_gets_no_gap_question():
    context = build_from_payload(
        _profile_payload(candidate={"skills": ["Python", "SQL", "Azure", "Docker"]})
    )
    plan = screening_questions.generate_plan(context, use_model=False)
    assert "technical_gap" not in [q.competency for q in plan]
    assert "role_fit" in [q.competency for q in plan]


def test_question_count_is_bounded():
    context = build_from_payload(_profile_payload())
    assert len(screening_questions.generate_plan(context, question_count=1, use_model=False)) == 3
    assert len(screening_questions.generate_plan(context, question_count=99, use_model=False)) <= 10


# ---------- answer evaluation ----------


def test_strong_answer_outscores_weak_answer():
    context = build_from_payload(_profile_payload())
    question = screening_questions.generate_plan(context, use_model=False)[0].as_dict()

    strong = evaluate_answer(question, STRONG_TECHNICAL_ANSWER, use_model=False)
    weak = evaluate_answer(question, WEAK_ANSWER, use_model=False)

    assert strong.score > weak.score
    assert strong.rating == "strong"
    assert weak.rating == "weak"
    assert strong.matched_signals


def test_non_answer_is_flagged_not_scored():
    context = build_from_payload(_profile_payload())
    question = screening_questions.generate_plan(context, use_model=False)[0].as_dict()

    evaluation = evaluate_answer(question, "I don't know", use_model=False)
    assert evaluation.rating == "weak"
    assert evaluation.score < 25
    assert "No substantive answer" in " ".join(evaluation.notes)


def test_evaluation_cites_the_answer_it_scored():
    context = build_from_payload(_profile_payload())
    question = screening_questions.generate_plan(context, use_model=False)[0].as_dict()
    evaluation = evaluate_answer(question, STRONG_TECHNICAL_ANSWER, use_model=False)

    screening_citation = next(c for c in evaluation.citations if c["source"] == "screening")
    assert screening_citation["detail"]
    assert screening_citation["detail"] in " ".join(STRONG_TECHNICAL_ANSWER.split())


def test_scorecard_aggregates_by_category():
    turns = [
        {"competency": "technical_depth", "weight": 1.2, "evaluation": {"score": 80.0}},
        {"competency": "communication", "weight": 0.9, "evaluation": {"score": 30.0}},
    ]
    scorecard = build_scorecard(turns)

    assert scorecard["answered"] == 2
    assert scorecard["categories"]["technical"]["score"] == 80.0
    assert scorecard["categories"]["communication"]["rating"] == "weak"
    assert "communication" in scorecard["weak_areas"]
    assert scorecard["recommendation"] in {"advance_with_reservations", "hold"}


def test_scorecard_without_answers_is_incomplete():
    assert build_scorecard([])["recommendation"] == "incomplete"


# ---------- session state machine ----------


def _start(db, **kwargs):
    return screening_service.start_session(
        db,
        recruiter_email="recruiter@example.com",
        profile=_profile_payload(),
        use_model=False,
        **kwargs,
    )


def test_session_advances_question_by_question(db):
    session = _start(db, question_count=4)
    assert session.status == "in_progress"
    assert screening_service.current_question(session)["id"] == "q1"

    session = screening_service.submit_answer(
        db, session_id=session.id, answer=STRONG_TECHNICAL_ANSWER, use_model=False
    )
    assert session.current_index == 1
    assert screening_service.current_question(session)["id"] == "q2"
    assert len(session.turns) == 1
    assert session.scorecard["answered"] == 1


def test_session_state_survives_reload(db):
    session = _start(db, question_count=3)
    screening_service.submit_answer(
        db, session_id=session.id, answer=STRONG_TECHNICAL_ANSWER, use_model=False
    )

    db.expire_all()
    reloaded = screening_service.get_session(db, session.id)
    assert reloaded.current_index == 1
    assert screening_service.current_question(reloaded)["id"] == "q2"


def test_session_completes_and_builds_briefing(db):
    session = _start(db, question_count=3)
    for _ in range(3):
        session = screening_service.submit_answer(
            db, session_id=session.id, answer=STRONG_TECHNICAL_ANSWER, use_model=False
        )

    assert session.status == "completed"
    assert session.completed_at is not None
    assert screening_service.current_question(session) is None
    assert session.scorecard["overall_score"] > 0
    assert session.briefing["summary"]


def test_answering_a_closed_session_is_rejected(db):
    session = _start(db, question_count=3)
    screening_service.complete_session(db, session_id=session.id, use_model=False)
    with pytest.raises(Exception) as exc:
        screening_service.submit_answer(
            db, session_id=session.id, answer="hello", use_model=False
        )
    assert "closed" in str(exc.value).lower()


def test_skip_records_unanswered_question(db):
    session = _start(db, question_count=3)
    session = screening_service.skip_question(db, session_id=session.id)
    assert session.current_index == 1
    assert session.turns[0]["skipped"] is True
    assert session.turns[0]["evaluation"] is None


def test_early_completion_marks_remaining_questions_unanswered(db):
    session = _start(db, question_count=5)
    session = screening_service.submit_answer(
        db, session_id=session.id, answer=STRONG_TECHNICAL_ANSWER, use_model=False
    )
    session = screening_service.complete_session(db, session_id=session.id, use_model=False)

    assert session.status == "completed"
    assert len(session.turns) == 5
    assert len([t for t in session.turns if t["evaluation"]]) == 1
    concerns = " ".join(c["point"] for c in session.briefing["concerns"])
    assert "unanswered" in concerns.lower()


def test_unanswered_questions_are_not_reported_as_weaknesses(db):
    """A question never asked is a coverage gap, not evidence of weakness."""
    session = _start(db, question_count=5)
    session = screening_service.submit_answer(
        db, session_id=session.id, answer=STRONG_TECHNICAL_ANSWER, use_model=False
    )
    session = screening_service.complete_session(db, session_id=session.id, use_model=False)

    weaknesses = " ".join(w["point"] for w in session.briefing["weaknesses"])
    assert "0/100" not in weaknesses
    assert len([t for t in session.turns if not t["evaluation"]]) == 4


# ---------- writing results back into the evaluation ----------


@pytest.mark.asyncio
async def test_screening_writes_evidence_onto_evaluation(db, sample_candidate, sample_job):
    await CandidateMatcher().rank_candidates(db, sample_job.id, persist=True)

    session = screening_service.start_session(
        db,
        recruiter_email="recruiter@example.com",
        candidate_id=sample_candidate.id,
        job_id=sample_job.id,
        question_count=3,
        use_model=False,
    )
    assert session.evaluation_id is not None
    for _ in range(3):
        session = screening_service.submit_answer(
            db, session_id=session.id, answer=STRONG_TECHNICAL_ANSWER, use_model=False
        )

    rows = (
        db.query(Evidence)
        .filter(
            Evidence.evaluation_id == session.evaluation_id,
            Evidence.source_section == SCREENING_EVIDENCE_SECTION,
        )
        .all()
    )
    assert len(rows) == 4  # one per answer plus the overall result
    assert any("L1 screening result" in (r.skill_name or "") for r in rows)


@pytest.mark.asyncio
async def test_reranking_preserves_screening_evidence(db, sample_candidate, sample_job):
    matcher = CandidateMatcher()
    await matcher.rank_candidates(db, sample_job.id, persist=True)
    session = screening_service.start_session(
        db,
        recruiter_email="recruiter@example.com",
        candidate_id=sample_candidate.id,
        job_id=sample_job.id,
        question_count=3,
        use_model=False,
    )
    for _ in range(3):
        session = screening_service.submit_answer(
            db, session_id=session.id, answer=STRONG_TECHNICAL_ANSWER, use_model=False
        )

    await matcher.rank_candidates(db, sample_job.id, persist=True)

    remaining = (
        db.query(Evidence)
        .filter(
            Evidence.evaluation_id == session.evaluation_id,
            Evidence.source_section == SCREENING_EVIDENCE_SECTION,
        )
        .count()
    )
    assert remaining == 4, "re-ranking must not delete screening evidence"


def test_inline_profile_can_screen_against_a_real_job(db, sample_job):
    session = screening_service.start_session(
        db,
        recruiter_email="recruiter@example.com",
        profile=_profile_payload(job={"title": "ignored", "required_skills": []}),
        job_id=sample_job.id,
        question_count=4,
        use_model=False,
    )
    assert session.job_id == sample_job.id
    assert session.job_title == "Backend Engineer"
    # Requirements come from the posting, so the gap probe is a real gap.
    gap = next(q for q in session.plan if q["competency"] == "technical_gap")
    assert "Azure" in gap["question"]


def test_inline_profile_session_skips_write_back(db):
    session = _start(db, question_count=3)
    for _ in range(3):
        session = screening_service.submit_answer(
            db, session_id=session.id, answer=STRONG_TECHNICAL_ANSWER, use_model=False
        )
    assert session.evaluation_id is None
    assert session.briefing["summary"]


# ---------- briefing ----------


def test_briefing_sections_are_populated_and_cited(db):
    session = _start(db, question_count=4)
    answers = [STRONG_TECHNICAL_ANSWER, WEAK_ANSWER, STRONG_TECHNICAL_ANSWER, WEAK_ANSWER]
    for answer in answers:
        session = screening_service.submit_answer(
            db, session_id=session.id, answer=answer, use_model=False
        )

    briefing = session.briefing
    assert briefing["background"]["name"] == "Dana Reyes"
    assert briefing["screening_performance"]["by_category"]
    assert briefing["strengths"] and briefing["weaknesses"]
    assert briefing["recommended_areas"]
    assert len(briefing["transcript"]) == 4

    for section in ("strengths", "weaknesses"):
        for item in briefing[section]:
            assert item["citations"], f"{section} entries must cite their source"


def test_briefing_flags_unprobed_required_skills():
    context = build_from_payload(
        _profile_payload(candidate={"skills": ["Python"]}, job={"required_skills": ["Python", "Rust"]})
    )
    briefing = build_briefing(context, [], build_scorecard([]), use_model=False)

    rust = next(g for g in briefing["skill_gaps"] if g["skill"] == "Rust")
    assert rust["status"] == "unprobed"
    assert any("Rust" in area["area"] for area in briefing["recommended_areas"])


def test_briefing_calls_out_polished_but_shallow_candidates(db):
    context = build_from_payload(_profile_payload())
    turns = [
        {
            "question_id": "q1",
            "competency": "technical_depth",
            "weight": 1.2,
            "answer": WEAK_ANSWER,
            "evaluation": {"score": 30.0, "rating": "weak", "missing_signals": ["design"]},
        },
        {
            "question_id": "q2",
            "competency": "communication",
            "weight": 0.9,
            "answer": STRONG_TECHNICAL_ANSWER,
            "evaluation": {"score": 88.0, "rating": "strong", "matched_signals": ["explain"]},
        },
    ]
    briefing = build_briefing(context, turns, build_scorecard(turns), use_model=False)
    assert any("Presents well" in c["point"] for c in briefing["concerns"])


# ---------- HTTP API ----------


def test_screening_endpoints_drive_a_full_session(client):
    start = client.post("/api/screening/sessions", json={**_profile_payload(), "question_count": 3})
    assert start.status_code == 200
    body = start.json()
    session_id = body["session_id"]
    assert body["status"] == "in_progress"
    assert body["question_count"] == 3
    assert body["current_question"]["id"] == "q1"

    for _ in range(3):
        response = client.post(
            f"/api/screening/sessions/{session_id}/answer",
            json={"answer": STRONG_TECHNICAL_ANSWER},
        )
        assert response.status_code == 200
        body = response.json()

    assert body["status"] == "completed"
    assert body["current_question"] is None
    assert body["scorecard"]["overall_score"] > 0

    briefing = client.get(f"/api/screening/sessions/{session_id}/briefing")
    assert briefing.status_code == 200
    assert briefing.json()["briefing"]["summary"]

    listed = client.get("/api/screening/sessions")
    assert listed.status_code == 200
    assert any(s["session_id"] == session_id for s in listed.json())


def test_start_screening_requires_a_candidate(client):
    response = client.post("/api/screening/sessions", json={"question_count": 3})
    assert response.status_code == 422


def test_screening_session_not_found(client):
    assert client.get(f"/api/screening/sessions/{uuid.uuid4()}").status_code == 404


# ---------- copilot integration ----------


@pytest.mark.asyncio
async def test_copilot_starts_and_runs_a_screening(db, sample_candidate, sample_job):
    agent = RecruiterCopilot()

    started = await agent.query_candidates(
        db,
        user_query="start screening for Alice Johnson",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
    )
    assert started["source"] == "screening"
    assert started["screening"]["candidate_name"] == "Alice Johnson"
    assert started["screening"]["current_question"]["id"] == "q1"
    assert "Question 1 of" in started["response"]

    answered = await agent.query_candidates(
        db,
        user_query=STRONG_TECHNICAL_ANSWER,
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
        session_id=started["session_id"],
    )
    assert answered["source"] == "screening"
    assert answered["screening"]["answered_count"] == 1
    assert answered["screening"]["current_question"]["id"] == "q2"


@pytest.mark.asyncio
async def test_copilot_screening_is_scoped_to_its_own_chat_thread(db, sample_candidate, sample_job):
    agent = RecruiterCopilot()
    await agent.query_candidates(
        db,
        user_query="start screening for Alice Johnson",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
    )

    # A different chat thread must still get normal copilot answers.
    other = await agent.query_candidates(
        db,
        user_query="Who is the strongest candidate?",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
    )
    assert other["source"] != "screening"


@pytest.mark.asyncio
async def test_copilot_stop_command_closes_screening_with_briefing(db, sample_candidate, sample_job):
    agent = RecruiterCopilot()
    started = await agent.query_candidates(
        db,
        user_query="run an L1 screening for Alice Johnson",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
    )
    stopped = await agent.query_candidates(
        db,
        user_query="stop screening",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
        session_id=started["session_id"],
    )
    assert stopped["screening"]["status"] == "completed"
    assert "Pre-interview briefing" in stopped["response"]


@pytest.mark.asyncio
async def test_copilot_asks_who_to_screen_when_name_is_missing(db, sample_job):
    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        user_query="start a screening session",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
    )
    assert "Tell me who to screen" in result["response"]
    assert result["screening"] is None


@pytest.mark.asyncio
async def test_talking_about_screening_does_not_start_one(db, sample_candidate, sample_job):
    agent = RecruiterCopilot()
    result = await agent.query_candidates(
        db,
        user_query="What is her screening score so far?",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
    )
    assert result["source"] != "screening"
    assert result["screening"] is None


@pytest.mark.asyncio
async def test_copilot_returns_briefing_for_a_completed_screening(db, sample_candidate, sample_job):
    agent = RecruiterCopilot()
    started = await agent.query_candidates(
        db,
        user_query="screen Alice Johnson",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
    )
    screening_service.complete_session(
        db, session_id=uuid.UUID(str(started["screening"]["session_id"])), use_model=False
    )

    briefing = await agent.query_candidates(
        db,
        user_query="give me the pre-interview briefing for Alice Johnson",
        recruiter_email="recruiter@example.com",
        job_id=sample_job.id,
    )
    assert briefing["source"] == "screening"
    assert "Pre-interview briefing — Alice Johnson" in briefing["response"]


def test_candidate_name_extraction_ignores_command_words():
    assert RecruiterCopilot._extract_name("start an L1 screening for Alice Johnson") == "Alice Johnson"
    assert RecruiterCopilot._extract_name("screen Bob O'Neill please") == "Bob O'Neill"
