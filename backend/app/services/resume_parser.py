import json
from typing import Any

from app.services.azure_services import doc_intelligence_service, openai_service
from app.utils.logger import get_logger
from app.utils.validators import normalize_email, unique_normalized

logger = get_logger(__name__)


class ResumeParser:
    async def extract_resume_text(self, file_bytes: bytes, filename: str) -> str:
        return doc_intelligence_service.extract_text(file_bytes, filename)

    async def parse_resume(self, resume_text: str) -> dict[str, Any]:
        prompt = f"""
Parse this resume and extract the following in JSON format:
- skills (list of strings)
- work_experience (list with company, title, duration, years, description)
- education (list with school, degree, field)
- certifications (list of strings)
- projects (list with name, description, technologies)
- contact_info (name, email, phone)
- github_url, linkedin_url, portfolio_url if present

Resume text:
{resume_text[:12000]}

Return ONLY valid JSON.
"""
        parsed = openai_service.chat_json(prompt, temperature=0.2)
        return self._normalize_parsed(parsed, resume_text)

    def _normalize_parsed(self, parsed: dict[str, Any], resume_text: str) -> dict[str, Any]:
        contact = parsed.get("contact_info") or {}
        if not isinstance(contact, dict):
            contact = {}

        skills = parsed.get("skills") or []
        if isinstance(skills, str):
            skills = [s.strip() for s in skills.split(",")]

        experience = parsed.get("work_experience") or parsed.get("experience") or []
        education = parsed.get("education") or []
        certifications = parsed.get("certifications") or []
        projects = parsed.get("projects") or []

        if isinstance(certifications, str):
            certifications = [certifications]

        email = contact.get("email") or f"unknown.{abs(hash(resume_text)) % 10_000_000}@example.com"
        name = contact.get("name") or "Unknown Candidate"

        return {
            "name": name,
            "email": normalize_email(str(email)),
            "phone": contact.get("phone"),
            "skills": unique_normalized([str(s) for s in skills]),
            "experience": experience if isinstance(experience, list) else [],
            "education": education if isinstance(education, list) else [],
            "certifications": [str(c) for c in certifications] if isinstance(certifications, list) else [],
            "projects": projects if isinstance(projects, list) else [],
            "github_url": parsed.get("github_url"),
            "linkedin_url": parsed.get("linkedin_url"),
            "portfolio_url": parsed.get("portfolio_url"),
            "raw": parsed,
        }

    async def enrich_from_public_profiles(
        self,
        *,
        github_url: str | None = None,
        linkedin_url: str | None = None,
    ) -> dict[str, Any]:
        """Lightweight enrichment placeholder using LLM summarization of public URLs."""
        prompt = f"""
Summarize public professional signals for enrichment as JSON with keys:
github_summary, linkedin_summary, inferred_skills (list), notes.

GitHub URL: {github_url or "N/A"}
LinkedIn URL: {linkedin_url or "N/A"}
"""
        if openai_service.mock:
            return {
                "github_summary": "Active open-source contributor" if github_url else None,
                "linkedin_summary": "Experienced software professional" if linkedin_url else None,
                "inferred_skills": ["Python", "Cloud"] if github_url or linkedin_url else [],
                "notes": "Mock enrichment (set USE_MOCK_AZURE=false for live model calls).",
            }
        return openai_service.chat_json(prompt, temperature=0.2)


resume_parser = ResumeParser()
