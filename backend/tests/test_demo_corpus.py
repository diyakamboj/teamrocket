import pytest

from app.services.azure_services import openai_service
from app.services.resume_parser import ResumeParser


@pytest.mark.asyncio
async def test_labeled_demo_resume_keeps_distinct_identity():
    text = (  # mirrors demo/resumes/alice-johnson.txt labels
        "Name: Alice Johnson\n"
        "Email: alice.johnson@example.com\n"
        "Title: Senior Backend Engineer\n"
        "Company: Northwind Cloud\n"
        "Years: 6\n"
        "Skills: Python, FastAPI, SQL, Azure, Docker, Kubernetes\n"
        "Education: BSc Computer Science, TU Berlin\n"
        "Certifications: AZ-204, AZ-900\n"
        "Project: Payments API\n"
        "Summary: Owned the FastAPI payments API on Azure.\n"
    )
    parsed = await ResumeParser().parse_resume(text)
    assert parsed["name"] == "Alice Johnson"
    assert parsed["email"] == "alice.johnson@example.com"
    assert "FastAPI" in parsed["skills"]
    assert "Java" not in parsed["skills"]


def test_mock_parse_does_not_clone_two_labeled_resumes():
    alice = openai_service._mock_parse_resume_from_prompt(
        "Parse this resume and extract JSON.\nResume text:\n"
        "Name: Alice Johnson\nEmail: alice.johnson@example.com\n"
        "Skills: Python, FastAPI, Azure\nYears: 6\nTitle: Senior Backend Engineer\n"
        "Return ONLY valid JSON."
    )
    bob = openai_service._mock_parse_resume_from_prompt(
        "Parse this resume and extract JSON.\nResume text:\n"
        "Name: Bob Martinez\nEmail: bob.martinez@example.com\n"
        "Skills: Java, SQL, Excel\nYears: 2\nTitle: Reporting Analyst\n"
        "Return ONLY valid JSON."
    )
    assert alice is not None and bob is not None
    assert alice["contact_info"]["name"] == "Alice Johnson"
    assert bob["contact_info"]["name"] == "Bob Martinez"
    assert "Python" in alice["skills"]
    assert "Java" in bob["skills"]
    assert alice["skills"] != bob["skills"]
