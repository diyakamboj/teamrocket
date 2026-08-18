"""Tests for AI-Powered Interview Scheduling Workflow, Teams links, calendar availability, and Copilot integration."""

from datetime import datetime, timedelta, timezone
import uuid
import pytest

from app.models.candidate import Candidate
from app.models.job_posting import JobPosting
from app.services.calendar_service import find_available_slots, generate_teams_meeting, list_known_interviewers
from app.services.copilot_agent import copilot_answer
from app.services.scheduling_service import scheduling_service
from app.storage.store import Store


def test_list_known_interviewers():
    interviewers = list_known_interviewers()
    assert len(interviewers) >= 4
    names = [i["name"] for i in interviewers]
    assert "Alex Chen" in names
    assert "Priya Sharma" in names


def test_teams_meeting_generation():
    now = datetime.now(timezone.utc)
    meeting = generate_teams_meeting(
        subject="Technical Interview - Alice Johnson",
        start_time=now,
        end_time=now + timedelta(minutes=45),
        organizer_email="recruiter@example.com",
    )
    assert meeting["teams_link"].startswith("https://teams.microsoft.com/l/meetup-join/")
    assert len(meeting["teams_meeting_id"]) > 0
    assert len(meeting["teams_passcode"]) > 0


def test_find_available_slots():
    slots = find_available_slots(
        required_interviewers=["Alex Chen", "Priya Sharma"],
        duration_minutes=45,
        candidate_name="Alice Johnson",
        job_title="Backend Engineer",
    )
    assert len(slots) >= 1
    assert slots[0].outlook_url is not None
    assert "Alex Chen" in slots[0].available_interviewers or "Priya Sharma" in slots[0].available_interviewers


def test_scheduling_workflow_propose_confirm_reschedule_cancel(store: Store, sample_candidate: Candidate, sample_job: JobPosting):
    recruiter = "recruiter@example.com"

    # 1. Propose interview
    proposal = scheduling_service.propose_interview(
        store,
        candidate_id=sample_candidate.id,
        recruiter_email=recruiter,
        job_id=sample_job.id,
        interview_type="Technical Interview",
        duration_minutes=45,
        required_interviewers=["Alex Chen", "Priya Sharma"],
    )
    assert proposal.candidate_name == sample_candidate.name
    assert len(proposal.proposed_slots) >= 1

    # 2. Confirm booking
    slot = proposal.proposed_slots[0]
    scheduled = scheduling_service.confirm_interview(
        store,
        candidate_id=sample_candidate.id,
        recruiter_email=recruiter,
        start_time=slot.start_time,
        end_time=slot.end_time,
        interviewers=proposal.required_interviewers,
        interview_type="Technical Interview",
        duration_minutes=45,
        job_id=sample_job.id,
        proposal_id=proposal.proposal_id,
    )
    assert scheduled.status == "confirmed"
    assert scheduled.teams_link.startswith("https://teams.microsoft.com/")

    # 3. Retrieve interviews for candidate
    interviews = scheduling_service.get_candidate_interviews(store, sample_candidate.id)
    assert len(interviews) == 1
    assert interviews[0].id == scheduled.id

    # 4. Reschedule interview proposal & confirmation
    reschedule_prop = scheduling_service.reschedule_propose(store, scheduled.id, recruiter)
    assert len(reschedule_prop.proposed_slots) >= 1
    new_slot = reschedule_prop.proposed_slots[0]

    rescheduled = scheduling_service.confirm_reschedule(
        store,
        scheduled.id,
        recruiter,
        start_time=new_slot.start_time,
        end_time=new_slot.end_time,
    )
    assert rescheduled.status == "rescheduled"

    # 5. Cancel interview
    cancelled = scheduling_service.cancel_interview(
        store,
        scheduled.id,
        recruiter,
        reason="Candidate requested time change",
    )
    assert cancelled.status == "cancelled"
    assert "Candidate requested time change" in (cancelled.notes or "")


@pytest.mark.asyncio
async def test_copilot_natural_language_scheduling(store: Store, sample_candidate: Candidate, sample_job: JobPosting):
    res = await copilot_answer(
        db=store,
        job=sample_job,
        question="Schedule a 45-minute technical interview with Alex and Priya next week",
        focus_candidate_id=str(sample_candidate.id),
    )
    assert res["structured"] is not None
    assert res["structured"]["type"] == "interview_proposal"
    assert len(res["structured"]["proposed_slots"]) >= 1
    assert "Alex Chen" in res["structured"]["required_interviewers"]
    assert "Priya Sharma" in res["structured"]["required_interviewers"]


def test_interviews_api_endpoints(client, sample_candidate: Candidate, sample_job: JobPosting):
    # GET interviewers
    res = client.get("/api/interviews/interviewers")
    assert res.status_code == 200
    assert len(res.json()) >= 4

    # POST propose
    payload = {
        "candidate_id": str(sample_candidate.id),
        "job_id": str(sample_job.id),
        "interview_type": "Technical Interview",
        "duration_minutes": 45,
        "required_interviewers": ["Alex Chen", "Priya Sharma"],
    }
    propose_res = client.post(
        "/api/interviews/propose",
        json=payload,
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    assert propose_res.status_code == 200
    proposal = propose_res.json()
    assert len(proposal["proposed_slots"]) >= 1

    # POST confirm
    slot = proposal["proposed_slots"][0]
    confirm_payload = {
        "proposal_id": proposal["proposal_id"],
        "candidate_id": str(sample_candidate.id),
        "job_id": str(sample_job.id),
        "interview_type": "Technical Interview",
        "duration_minutes": 45,
        "interviewers": ["Alex Chen", "Priya Sharma"],
        "start_time": slot["start_time"],
        "end_time": slot["end_time"],
    }
    confirm_res = client.post(
        "/api/interviews/confirm",
        json=confirm_payload,
        headers={"X-Recruiter-Email": "recruiter@example.com"},
    )
    assert confirm_res.status_code == 200
    interview = confirm_res.json()
    assert interview["status"] == "confirmed"
    assert "teams_link" in interview

    # GET list candidate interviews
    list_res = client.get(f"/api/interviews/candidate/{sample_candidate.id}")
    assert list_res.status_code == 200
    assert len(list_res.json()) == 1
