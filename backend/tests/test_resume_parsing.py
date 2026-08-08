import pytest

from app.services.resume_parser import ResumeParser


@pytest.mark.asyncio
async def test_parse_resume_returns_structured_fields():
    parser = ResumeParser()
    text = """
    Jane Doe
    jane.doe@example.com
    Skills: Python, FastAPI, Azure
    Experience: Backend engineer for 3 years
    Education: BSc Computer Science
    """
    parsed = await parser.parse_resume(text)
    assert "name" in parsed
    assert "email" in parsed
    assert isinstance(parsed["skills"], list)
    assert len(parsed["skills"]) >= 1


@pytest.mark.asyncio
async def test_extract_resume_text_from_txt_bytes():
    parser = ResumeParser()
    content = b"Sample resume content with Python and SQL"
    text = await parser.extract_resume_text(content, "resume.txt")
    assert "Python" in text
