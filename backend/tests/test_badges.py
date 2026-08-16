import uuid

import pytest

from app.models.candidate import Candidate
from app.services.badge_service import build_badges
from app.services.candidate_matcher import CandidateMatcher


def flag_ids(badges) -> set[str]:
    return {f.id for f in badges.status_flags}


def badge_named(badges, name: str):
    return next((b for b in badges.skill_badges if b.name.lower() == name.lower()), None)


def test_top_match_flag_for_strong_complete_profile(sample_candidate):
    badges = build_badges(
        sample_candidate,
        {"overall_score": 91.0, "skill_score": 88.0, "matched_skills": ["Python", "SQL"]},
    )
    assert "top_match" in flag_ids(badges)
    assert "bench_candidate" not in flag_ids(badges)
    top = next(f for f in badges.status_flags if f.id == "top_match")
    assert top.emoji == "🟢"
    assert top.evidence and top.evidence[0].origin == "screening"


def test_bench_flag_for_mid_score(sample_candidate):
    badges = build_badges(
        sample_candidate,
        {"overall_score": 68.0, "skill_score": 60.0, "missing_skills": ["Kubernetes"]},
    )
    assert "bench_candidate" in flag_ids(badges)
    bench = next(f for f in badges.status_flags if f.id == "bench_candidate")
    assert "Kubernetes" in bench.reason


def test_low_score_gets_no_match_flag(sample_candidate):
    badges = build_badges(sample_candidate, {"overall_score": 41.0, "skill_score": 30.0})
    assert not {"top_match", "bench_candidate"} & flag_ids(badges)


def test_no_score_omits_match_flags_but_keeps_profile_flags(sample_candidate):
    badges = build_badges(sample_candidate)
    assert not {"top_match", "bench_candidate"} & flag_ids(badges)
    assert badge_named(badges, "Python") is not None


@pytest.mark.parametrize(
    "phrase",
    [
        "Available immediately for full-time roles.",
        "Notice period: none",
        "Notice period - 15 days",
        "I am an immediate joiner based in Berlin.",
    ],
)
def test_immediate_joiner_detected_from_resume(sample_candidate, phrase):
    sample_candidate.resume_text = f"{sample_candidate.resume_text} {phrase}"
    badges = build_badges(sample_candidate)
    assert "immediate_joiner" in flag_ids(badges)
    flag = next(f for f in badges.status_flags if f.id == "immediate_joiner")
    assert flag.evidence[0].origin == "resume"
    assert phrase.split()[0].lower() in flag.evidence[0].detail.lower()


def test_immediate_joiner_from_enriched_profile(sample_candidate):
    sample_candidate.enriched_profile = {"notice_period": "Immediate joiner"}
    badges = build_badges(sample_candidate)
    flag = next(f for f in badges.status_flags if f.id == "immediate_joiner")
    assert flag.evidence[0].origin == "external_profile"


def test_long_notice_period_is_not_an_immediate_joiner(sample_candidate):
    sample_candidate.resume_text = f"{sample_candidate.resume_text} Notice period: 90 days"
    assert "immediate_joiner" not in flag_ids(build_badges(sample_candidate))


def test_incomplete_profile_lists_missing_sections_and_blocks_top_match():
    sparse = Candidate(
        id=uuid.uuid4(),
        name="Sparse Sam",
        email="sam@example.com",
        skills=["Python"],
        experience=[],
        education=[],
    )
    badges = build_badges(sparse, {"overall_score": 95.0, "skill_score": 95.0})
    ids = flag_ids(badges)
    assert "incomplete_profile" in ids
    assert "top_match" not in ids
    assert "bench_candidate" in ids
    flag = next(f for f in badges.status_flags if f.id == "incomplete_profile")
    for section in ("work experience", "education", "contact details", "parsed resume text"):
        assert section in flag.reason


def test_skill_badge_links_to_resume_evidence(sample_candidate):
    badge = badge_named(build_badges(sample_candidate), "Python")
    assert badge is not None
    assert badge.level == "verified"
    assert badge.evidence[0].origin == "resume"
    assert "Python" in badge.evidence[0].detail


def test_skill_absent_from_resume_gets_no_badge(sample_candidate):
    sample_candidate.skills = [*sample_candidate.skills, "Haskell"]
    assert badge_named(build_badges(sample_candidate), "Haskell") is None


def test_external_profile_corroborates_skill(sample_candidate):
    sample_candidate.github_url = "https://github.com/alicejohnson"
    sample_candidate.enriched_profile = {"inferred_skills": ["Python"]}
    badge = badge_named(build_badges(sample_candidate), "Python")
    assert badge.level == "corroborated"
    external = next(e for e in badge.evidence if e.origin == "external_profile")
    assert external.url == "https://github.com/alicejohnson"


def test_external_profile_alone_is_not_enough(sample_candidate):
    sample_candidate.github_url = "https://github.com/alicejohnson"
    sample_candidate.enriched_profile = {"inferred_skills": ["Rust"]}
    assert badge_named(build_badges(sample_candidate), "Rust") is None


def test_certification_badge_requires_resume_evidence(sample_candidate):
    sample_candidate.certifications = ["AZ-900", "Ghost Certification"]
    sample_candidate.resume_text = (
        f"{sample_candidate.resume_text} Certifications: AZ-900 Azure Fundamentals."
    )
    badges = build_badges(sample_candidate)
    az = badge_named(badges, "AZ-900")
    assert az is not None and az.kind == "certification"
    assert badge_named(badges, "Ghost Certification") is None
    # Certifications lead the list so credentials are seen before loose skills.
    assert badges.skill_badges[0].kind == "certification"


@pytest.mark.asyncio
async def test_ranking_includes_badges(db, sample_candidate, sample_job):
    ranked = await CandidateMatcher().rank_candidates(db, sample_job.id, persist=False)
    assert {"status_flags", "skill_badges"} <= ranked[0].keys()
    assert any(b["name"] == "Python" for b in ranked[0]["skill_badges"])


@pytest.mark.asyncio
async def test_blind_mode_redacts_badge_evidence(db, sample_candidate, sample_job):
    sample_candidate.resume_text = (
        "Contact alice.johnson@example.com. Skills: Python, SQL, Azure, Docker. "
        "Built Python APIs for 4 years."
    )
    db.commit()

    ranked = await CandidateMatcher().rank_candidates(
        db, sample_job.id, persist=False, blind_mode=True
    )
    details = [
        e["detail"]
        for badge in ranked[0]["skill_badges"] + ranked[0]["status_flags"]
        for e in badge["evidence"]
    ]
    assert details
    assert not any("alice.johnson@example.com" in d for d in details)


def test_badges_endpoint_without_job(client, sample_candidate):
    response = client.get(f"/api/candidates/{sample_candidate.id}/badges")
    assert response.status_code == 200
    body = response.json()
    assert body["candidate_id"] == str(sample_candidate.id)
    assert body["job_id"] is None
    assert any(b["name"] == "Python" for b in body["skill_badges"])
    assert not {"top_match", "bench_candidate"} & {f["id"] for f in body["status_flags"]}


def test_badges_endpoint_with_job(client, sample_candidate, sample_job):
    response = client.get(
        f"/api/candidates/{sample_candidate.id}/badges", params={"job_id": str(sample_job.id)}
    )
    assert response.status_code == 200
    body = response.json()
    assert {"top_match", "bench_candidate"} & {f["id"] for f in body["status_flags"]}


def test_badges_endpoint_unknown_candidate(client):
    assert client.get(f"/api/candidates/{uuid.uuid4()}/badges").status_code == 404
