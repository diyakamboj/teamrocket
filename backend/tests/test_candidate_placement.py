"""Moving candidates through a job's pipeline, and who is allowed to.

Covers the two things derivation could not do: put a candidate in a specific
interview round, and keep one job's pipeline out of another job's, including
when the two share a title.
"""

import uuid

import pytest

from app.models.candidate import Candidate
from app.models.collaboration import CandidateShare
from app.models.job_posting import InterviewRound, JobPosting
from app.models.placement import CandidatePlacement
from app.services import job_pipeline_service, placement_service
from app.storage.store import Store
from app.utils.error_handlers import AppError, ValidationAppError

RECRUITER = "recruiter@example.com"
OTHER = "other@example.com"


@pytest.fixture()
def looped_job(store: Store) -> JobPosting:
    """A job with a real interview loop, so rounds are addressable."""
    job = JobPosting(
        id=uuid.uuid4(),
        title="Backend Engineer",
        description="Build APIs.",
        created_by=RECRUITER,
        rounds=[
            InterviewRound(id="r1", name="Recruiter screen", sequence=1),
            InterviewRound(id="r2", name="Technical interview", sequence=2),
            InterviewRound(id="r3", name="Hiring manager", sequence=3),
        ],
    )
    store.jobs.save(job)
    return job


@pytest.fixture()
def candidate(store: Store) -> Candidate:
    person = Candidate(
        id=uuid.uuid4(),
        owner_email=RECRUITER,
        name="Alice Johnson",
        email="alice.johnson@example.com",
        resume_text="Python, SQL.",
        skills=["Python"],
    )
    store.candidates.save(person)
    return person


def _move(store, job, candidate, stage, round_id=None, actor=RECRUITER):
    return placement_service.move_candidate(
        store,
        job=job,
        candidate_id=str(candidate.id),
        candidate_name=candidate.name,
        stage=stage,
        round_id=round_id,
        actor_email=actor,
    )


def test_move_places_candidate_in_named_round(store, looped_job, candidate):
    placement = _move(store, looped_job, candidate, "interviewing", round_id="r2")

    assert placement.stage == "interviewing"
    assert placement.round_id == "r2"
    assert placement.round_sequence == 2
    assert placement.moved_by == RECRUITER


def test_move_records_the_actors_name_and_role(store, looped_job, candidate):
    """The board needs a name and role, not just an email, so others can
    see whether a recruiter, hiring manager or IT admin made the change."""
    from app.models.roles import Role
    from app.models.user import User

    store.users.save(
        User(
            email=RECRUITER,
            name="Alex Recruiter",
            role=Role.HIRING_MANAGER,
            password_hash="x",
            password_salt="y",
        )
    )
    placement = _move(store, looped_job, candidate, "interviewing", round_id="r1")

    assert placement.moved_by == RECRUITER
    assert placement.moved_by_name == "Alex Recruiter"
    assert placement.moved_by_role == "Hiring Manager"


def test_interviewing_without_a_round_starts_at_the_first(store, looped_job, candidate):
    placement = _move(store, looped_job, candidate, "interviewing")

    assert placement.round_id == "r1"
    assert placement.round_sequence == 1


def test_moving_off_interviewing_clears_the_round(store, looped_job, candidate):
    _move(store, looped_job, candidate, "interviewing", round_id="r3")
    placement = _move(store, looped_job, candidate, "hired")

    # A candidate must never read as "hired, round 3".
    assert placement.stage == "hired"
    assert placement.round_id is None
    assert placement.round_sequence is None


def test_moving_again_upserts_rather_than_duplicating(store, looped_job, candidate):
    first = _move(store, looped_job, candidate, "interviewing", round_id="r1")
    second = _move(store, looped_job, candidate, "selected")

    assert first.id == second.id
    assert len(store.candidate_placements.list_all()) == 1
    # The original placement time survives a re-move.
    assert second.created_at == first.created_at


def test_round_from_another_job_is_rejected(store, looped_job, candidate):
    with pytest.raises(ValidationAppError):
        _move(store, looped_job, candidate, "interviewing", round_id="not-a-round")


def test_unknown_stage_is_rejected(store, looped_job, candidate):
    with pytest.raises(ValidationAppError):
        _move(store, looped_job, candidate, "promoted")


def test_a_stranger_cannot_move_a_candidate(store, looped_job, candidate):
    with pytest.raises(AppError) as excinfo:
        _move(store, looped_job, candidate, "hired", actor=OTHER)

    assert excinfo.value.status_code == 403


def test_a_collaborator_can_move_a_shared_candidate(store, looped_job, candidate):
    store.candidate_shares.save(
        CandidateShare(
            candidate_id=candidate.id,
            owner_email=RECRUITER,
            shared_with_email=OTHER,
            permission="collaborate",
        )
    )

    placement = _move(store, looped_job, candidate, "interviewing", round_id="r2", actor=OTHER)

    assert placement.moved_by == OTHER


def test_a_view_only_share_cannot_move(store, looped_job, candidate):
    store.candidate_shares.save(
        CandidateShare(
            candidate_id=candidate.id,
            owner_email=RECRUITER,
            shared_with_email=OTHER,
            permission="view",
        )
    )

    with pytest.raises(AppError) as excinfo:
        _move(store, looped_job, candidate, "hired", actor=OTHER)

    assert excinfo.value.status_code == 403


def test_placement_beats_a_derived_stage(store, looped_job, candidate):
    """A recruiter moving someone back overrides what a decision implied."""
    from app.models.evaluation import CandidateDecision

    store.candidate_decisions.save(
        CandidateDecision(
            candidate_id=str(candidate.id),
            candidate_name=candidate.name,
            candidate_email=candidate.email,
            job_title=looped_job.title,
            decision="rejected",
        )
    )
    _move(store, looped_job, candidate, "interviewing", round_id="r2")

    rows = job_pipeline_service.get_job_pipeline_candidates(store, looped_job)
    row = next(r for r in rows if str(r["candidate_id"]) == str(candidate.id))

    assert row["stage"] == "interviewing"
    assert row["round_name"] == "Technical interview"


def test_placements_do_not_leak_between_jobs_sharing_a_title(store, looped_job, candidate):
    """Decisions match jobs by title; placements must not."""
    twin = JobPosting(
        id=uuid.uuid4(),
        title=looped_job.title,  # same title, different role
        description="A different team.",
        created_by=RECRUITER,
        rounds=[InterviewRound(id="x1", name="Screen", sequence=1)],
    )
    store.jobs.save(twin)

    _move(store, looped_job, candidate, "hired")

    assert placement_service.get_placement(store, looped_job.id, str(candidate.id)).stage == "hired"
    assert placement_service.get_placement(store, twin.id, str(candidate.id)) is None


def test_hired_is_counted_rather_than_crashing(store, looped_job, candidate):
    """`_stage_for` could return "hired" while STAGE_ORDER lacked it, which
    made the dashboard raise KeyError as soon as anyone was hired."""
    _move(store, looped_job, candidate, "hired")

    counts = job_pipeline_service.job_pipeline_progression(store, looped_job.id)

    assert counts["hired"] == 1


def test_move_endpoint_persists_and_returns_the_round(client, store, looped_job, candidate):
    response = client.put(
        f"/api/dashboard/jobs/{looped_job.id}/pipeline/{candidate.id}",
        json={"stage": "interviewing", "round_id": "r3"},
        headers={"X-Recruiter-Email": RECRUITER},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["stage"] == "interviewing"
    assert body["round_id"] == "r3"
    assert body["round_name"] == "Hiring manager"

    stored = store.candidate_placements.get(
        CandidatePlacement.id_for(looped_job.id, str(candidate.id))
    )
    assert stored is not None and stored.round_sequence == 3


def test_move_endpoint_404s_for_an_unknown_job(client, candidate):
    response = client.put(
        f"/api/dashboard/jobs/{uuid.uuid4()}/pipeline/{candidate.id}",
        json={"stage": "hired"},
        headers={"X-Recruiter-Email": RECRUITER},
    )

    assert response.status_code == 404


def test_a_move_survives_a_missing_candidate_record(store, looped_job):
    """A placement whose candidate record cannot be resolved used to be
    dropped from the pipeline, so the board re-read the old position and the
    move looked like it had done nothing at all."""
    ghost_id = str(uuid.uuid4())  # never saved to store.candidates
    placement_service.move_candidate(
        store,
        job=looped_job,
        candidate_id=ghost_id,
        candidate_name="Ghost Candidate",
        stage="interviewing",
        round_id="r2",
        actor_email=RECRUITER,
    )

    rows = job_pipeline_service.get_job_pipeline_candidates(store, looped_job)
    row = next(r for r in rows if str(r["candidate_id"]) == ghost_id)

    assert row["stage"] == "interviewing"
    assert row["round_name"] == "Technical interview"
    # The name captured at move time stands in for the missing record.
    assert row["candidate_name"] == "Ghost Candidate"


def test_a_placed_candidate_is_counted_without_a_record(store, looped_job):
    ghost_id = str(uuid.uuid4())
    placement_service.move_candidate(
        store,
        job=looped_job,
        candidate_id=ghost_id,
        candidate_name="Ghost Candidate",
        stage="selected",
        actor_email=RECRUITER,
    )

    counts = job_pipeline_service.job_pipeline_progression(store, looped_job.id)

    assert counts["selected"] == 1
