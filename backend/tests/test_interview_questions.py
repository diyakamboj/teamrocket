"""Question bank generation for an interview round."""

import pytest

from app.models.interview_questions import Audience, Difficulty
from app.models.job_posting import InterviewRound
from app.services import interview_question_service as svc


@pytest.fixture
def round_():
    return InterviewRound(name="Technical interview", interview_type="Technical Interview")


def _payload(n=2):
    """What the model returns for one audience."""
    out = []
    for difficulty in ("easy", "medium", "hard"):
        for i in range(n):
            out.append(
                {
                    "question": f"{difficulty} question {i}",
                    "difficulty": difficulty,
                    "model_answer": "A concrete description of a good answer.",
                    "signals": ["listens for X"],
                    "follow_ups": ["and then?"],
                    "competency": "Python",
                }
            )
    return {"questions": out}


def test_both_audiences_are_generated(monkeypatch, sample_job, round_):
    monkeypatch.setattr(svc.openai_service, "chat_json_or_empty", lambda *a, **k: _payload())
    result = svc.generate_for_round(sample_job, round_)

    assert result.generated_by_ai is True
    assert {q.audience for q in result.questions} == {Audience.NON_TECHNICAL, Audience.TECHNICAL}
    assert {q.difficulty for q in result.questions} == {
        Difficulty.EASY,
        Difficulty.MEDIUM,
        Difficulty.HARD,
    }


def test_every_question_carries_a_model_answer(monkeypatch, sample_job, round_):
    """The answer is what makes a question usable by someone who could not
    otherwise grade it — a question without one is not shippable."""
    monkeypatch.setattr(svc.openai_service, "chat_json_or_empty", lambda *a, **k: _payload())
    result = svc.generate_for_round(sample_job, round_)
    assert all(q.model_answer.strip() for q in result.questions)


def test_questions_missing_an_answer_are_dropped(monkeypatch, sample_job, round_):
    monkeypatch.setattr(
        svc.openai_service,
        "chat_json_or_empty",
        lambda *a, **k: {
            "questions": [
                {"question": "no answer here", "difficulty": "easy"},
                {"question": "fine", "difficulty": "easy", "model_answer": "Good answers say X."},
            ]
        },
    )
    kept = svc._generate_for_audience(sample_job, round_, Audience.TECHNICAL)
    assert [q.question for q in kept] == ["fine"]


def test_a_model_failure_falls_back_to_generic_questions(monkeypatch, sample_job, round_):
    monkeypatch.setattr(svc.openai_service, "chat_json_or_empty", lambda *a, **k: {})
    result = svc.generate_for_round(sample_job, round_)

    # Flagged as generic so the UI does not present these as role-specific.
    assert result.generated_by_ai is False
    assert len(result.questions) > 0
    assert all(q.model_answer.strip() for q in result.questions)
    assert {q.audience for q in result.questions} == {Audience.NON_TECHNICAL, Audience.TECHNICAL}


def test_one_sided_generation_is_rejected(monkeypatch, sample_job, round_):
    """A recruiter screen with only technical questions is worse than generic.

    If the model covers one audience and fails the other, the partial set is
    discarded rather than shipped half-empty.
    """
    calls = {"n": 0}

    def flaky(*args, **kwargs):
        calls["n"] += 1
        return _payload() if calls["n"] == 1 else {}

    monkeypatch.setattr(svc.openai_service, "chat_json_or_empty", flaky)
    result = svc.generate_for_round(sample_job, round_)

    assert result.generated_by_ai is False
    assert {q.audience for q in result.questions} == {Audience.NON_TECHNICAL, Audience.TECHNICAL}


def test_generation_asks_for_enough_tokens(monkeypatch, sample_job, round_):
    """On a reasoning deployment the budget covers thinking as well as output.

    At the default 1200 the whole allowance went to reasoning and the reply
    came back as an empty string, which read downstream as "the model failed".
    """
    seen = {}

    def capture(prompt, **kwargs):
        seen.update(kwargs)
        return _payload()

    monkeypatch.setattr(svc.openai_service, "chat_json_or_empty", capture)
    svc.generate_for_round(sample_job, round_)
    assert seen["max_tokens"] >= 4000


def test_each_request_asks_for_a_single_audience(monkeypatch, sample_job, round_):
    """Splitting the request is what keeps each response small enough."""
    prompts = []

    def capture(prompt, **kwargs):
        prompts.append(prompt)
        return _payload()

    monkeypatch.setattr(svc.openai_service, "chat_json_or_empty", capture)
    svc.generate_for_round(sample_job, round_)

    assert len(prompts) == 2
    assert any("NON_TECHNICAL audience only" in p for p in prompts)
    assert any("TECHNICAL audience only" in p for p in prompts)
