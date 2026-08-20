"""One person, one profile — however many times their résumé is uploaded.

Duplicates used to be caught on filename alone: the same résumé re-exported
as "resume (1).pdf" became a second profile, and two different people who
both called their file "resume.pdf" blocked each other.
"""

import uuid

import pytest

from app.models.candidate import Candidate
from app.models.evaluation import ResumeUpload
from app.services import candidate_dedupe

OWNER = "recruiter@example.com"
OTHER = "someone.else@example.com"


@pytest.fixture()
def pooled(store):
    candidate = Candidate(
        id=uuid.uuid4(),
        owner_email=OWNER,
        name="Alice Johnson",
        email="alice.johnson@example.com",
        phone="+1 (555) 123-4567",
        resume_text="Python, SQL.",
        skills=["Python"],
    )
    store.candidates.save(candidate)
    return candidate


def test_the_same_bytes_are_the_same_resume():
    assert candidate_dedupe.content_digest(b"abc") == candidate_dedupe.content_digest(b"abc")
    assert candidate_dedupe.content_digest(b"abc") != candidate_dedupe.content_digest(b"abd")


def test_an_identical_file_is_recognised_whatever_it_is_called(store, pooled):
    digest = candidate_dedupe.content_digest(b"resume-bytes")
    store.resume_uploads.save(
        ResumeUpload(
            recruiter_email=OWNER,
            filename="resume.pdf",
            content_sha256=digest,
            candidate_id=pooled.id,
            status="complete",
        )
    )

    # Same bytes, different filename — still the same résumé.
    assert candidate_dedupe.digests_for_recruiter(store, OWNER).get(digest) == str(pooled.id)


def test_another_recruiters_upload_does_not_block_yours(store, pooled):
    digest = candidate_dedupe.content_digest(b"resume-bytes")
    store.resume_uploads.save(
        ResumeUpload(
            recruiter_email=OTHER,
            filename="resume.pdf",
            content_sha256=digest,
            candidate_id=uuid.uuid4(),
            status="complete",
        )
    )

    assert digest not in candidate_dedupe.digests_for_recruiter(store, OWNER)


def test_an_upload_that_never_produced_a_candidate_does_not_block_a_retry(store):
    digest = candidate_dedupe.content_digest(b"resume-bytes")
    store.resume_uploads.save(
        ResumeUpload(
            recruiter_email=OWNER, filename="resume.pdf", content_sha256=digest, status="failed"
        )
    )

    assert digest not in candidate_dedupe.digests_for_recruiter(store, OWNER)


def test_email_identifies_the_same_person(store, pooled):
    found = candidate_dedupe.find_existing_candidate(
        store, owner_email=OWNER, email="ALICE.JOHNSON@example.com"
    )
    assert found is not None and found.id == pooled.id


def test_a_different_person_is_not_a_duplicate(store, pooled):
    assert (
        candidate_dedupe.find_existing_candidate(
            store, owner_email=OWNER, email="bob@example.com", name="Bob Smith", phone="555-9999"
        )
        is None
    )


def test_name_and_phone_catch_a_resume_with_no_readable_email(store, pooled):
    """A résumé with no parseable email is given a fresh placeholder address
    on every upload, so email alone could never match it to itself."""
    found = candidate_dedupe.find_existing_candidate(
        store,
        owner_email=OWNER,
        email="candidate.9f2ab31c7d@example.com",
        name="  alice   johnson ",
        phone="555.123.4567",
    )
    assert found is not None and found.id == pooled.id


def test_a_shared_name_alone_is_not_enough_to_merge(store, pooled):
    """Two people can be called Alice Johnson; merging them would be worse
    than a duplicate."""
    assert (
        candidate_dedupe.find_existing_candidate(
            store, owner_email=OWNER, email=None, name="Alice Johnson", phone="555-0000"
        )
        is None
    )


def test_two_placeholder_emails_are_never_the_same_person(store):
    store.candidates.save(
        Candidate(
            owner_email=OWNER,
            name="Unknown",
            email="candidate.aaaaaaaaaa@example.com",
            resume_text="x",
        )
    )

    assert (
        candidate_dedupe.find_existing_candidate(
            store, owner_email=OWNER, email="candidate.bbbbbbbbbb@example.com"
        )
        is None
    )


def test_the_refusal_names_the_right_list(store, pooled):
    assert "candidate pool" in candidate_dedupe.already_in_pool_message(pooled)

    pooled.source = "internal"
    assert "employee list" in candidate_dedupe.already_in_pool_message(pooled)


def test_prior_digests_come_back_as_one_map(store, pooled):
    """The upload route builds this once and then does dict lookups. It used
    to re-scan every upload record per file, on the event loop, which made a
    multi-file upload block every other request to the server."""
    for text in (b"one", b"two", b"three"):
        store.resume_uploads.save(
            ResumeUpload(
                recruiter_email=OWNER,
                filename=f"{text.decode()}.pdf",
                content_sha256=candidate_dedupe.content_digest(text),
                candidate_id=pooled.id,
                status="complete",
            )
        )

    digests = candidate_dedupe.digests_for_recruiter(store, OWNER)

    assert len(digests) == 3
    for text in (b"one", b"two", b"three"):
        assert candidate_dedupe.content_digest(text) in digests
