"""Contact details survive parsing, whatever shape the model returns.

Every uploaded résumé was becoming "Unknown Candidate" with a synthesised
email, because the normaliser only looked inside a `contact_info` wrapper
while the deployment returns `name`/`email` at the top level. A candidate
filed under a fake identity is invisible to the recruiter who uploaded them,
so these pin down both shapes and the read-it-ourselves fallback.
"""

import pytest

from app.services.resume_parser import ResumeParser

RESUME = """Jordan Blake
jordan.blake@example.com | +1 555 0142 | Austin, TX

Senior Backend Engineer

Skills: Python, FastAPI, PostgreSQL

Experience:
Senior Backend Engineer, Northwind Labs (2021-2025)
"""


@pytest.fixture()
def parser() -> ResumeParser:
    return ResumeParser()


def test_top_level_contact_fields_are_used(parser):
    """The shape the current Azure deployment actually returns."""
    parsed = parser._normalize_parsed(
        {"name": "Jordan Blake", "email": "jordan.blake@example.com", "skills": ["Python"]},
        RESUME,
    )
    assert parsed["name"] == "Jordan Blake"
    assert parsed["email"] == "jordan.blake@example.com"


def test_nested_contact_info_is_still_used(parser):
    parsed = parser._normalize_parsed(
        {"contact_info": {"name": "Jordan Blake", "email": "jordan.blake@example.com"}},
        RESUME,
    )
    assert parsed["name"] == "Jordan Blake"
    assert parsed["email"] == "jordan.blake@example.com"


@pytest.mark.parametrize("wrapper", ["contact", "basics", "personal_info", "contactInfo"])
def test_other_contact_wrappers_are_understood(parser, wrapper):
    parsed = parser._normalize_parsed(
        {wrapper: {"name": "Jordan Blake", "email": "jordan.blake@example.com"}}, RESUME
    )
    assert parsed["name"] == "Jordan Blake"


def test_contact_details_are_read_from_the_resume_when_the_model_omits_them(parser):
    """A model that returns only skills must not cost us the identity."""
    parsed = parser._normalize_parsed({"skills": ["Python"]}, RESUME)

    assert parsed["name"] == "Jordan Blake"
    assert parsed["email"] == "jordan.blake@example.com"


def test_unknown_identity_is_only_a_last_resort(parser):
    parsed = parser._normalize_parsed({"skills": ["Python"]}, "Skills: Python\nExperience: 3 years")

    assert parsed["name"] == "Unknown Candidate"
    assert parsed["email"].startswith("unknown.")


def test_a_heading_is_not_mistaken_for_a_name(parser):
    parsed = parser._normalize_parsed(
        {"skills": ["Python"]},
        "CURRICULUM VITAE\n\nDana Okonkwo\ndana@example.com\n",
    )
    assert parsed["email"] == "dana@example.com"
    assert parsed["name"] != "CURRICULUM VITAE"


def test_a_contact_line_is_not_mistaken_for_a_name(parser):
    parsed = parser._normalize_parsed({"skills": ["Go"]}, "+1 555 0142\nRavi Menon\nravi@example.com\n")
    assert parsed["name"] != "+1 555 0142"


def test_explicit_model_values_win_over_the_resume_text(parser):
    parsed = parser._normalize_parsed(
        {"name": "Preferred Name", "email": "preferred@example.com"}, RESUME
    )
    assert parsed["name"] == "Preferred Name"
    assert parsed["email"] == "preferred@example.com"
