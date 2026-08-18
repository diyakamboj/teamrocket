import re
from typing import Any

from app.services.azure_services import doc_intelligence_service, openai_service
from app.services.jd_heuristics import analyze_job_text
from app.utils.logger import get_logger
from app.utils.validators import normalize_email, unique_normalized

logger = get_logger(__name__)

RESUME_SYSTEM_PROMPT = """You are a resume parsing engine for a recruiting platform.
Extract structured data from the resume text exactly as written — never invent, infer or embellish facts.
Rules:
- Use "" or omit a field when the resume does not state it. Do not guess.
- totalYearsExperience is the summed duration of professional roles (exclude internships shorter than 6 months and education). Round to one decimal.
- skills must be concrete technologies, tools, languages, methodologies or domain skills. No soft-skill filler like "team player".
- For every skill, evidence should quote or tightly paraphrase where in the resume it is demonstrated, when such a mention exists.
- highlights are the candidate's own bullet points, condensed to one line each.
- Keep dates in the format written on the resume.
Return JSON only."""


class ResumeParser:
    async def extract_resume_text(self, file_bytes: bytes, filename: str) -> str:
        return doc_intelligence_service.extract_text(file_bytes, filename)

    async def parse_resume(self, resume_text: str) -> dict[str, Any]:
        if not openai_service.mock:
            prompt = f'Resume text:\n"""\n{resume_text[:40000]}\n"""'
            parsed = openai_service.chat_json(
                prompt,
                system=RESUME_SYSTEM_PROMPT,
                temperature=0,
            )
            normalized = self._normalize_parsed(parsed, resume_text)
            if normalized.get("skills"):
                normalized["parse_engine"] = "azure-openai"
                return normalized

        heuristic = self._heuristic_parse(resume_text)
        heuristic["parse_engine"] = "heuristic"
        return heuristic

    def _heuristic_parse(self, resume_text: str) -> dict[str, Any]:
        lines = [line.strip() for line in resume_text.splitlines() if line.strip()]
        name = lines[0] if lines else "Unknown Candidate"
        email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", resume_text, re.I)
        phone_match = re.search(r"\+?\d[\d\s().-]{7,}\d", resume_text)
        skills_block = ""
        for label in ("skills:", "technical skills:", "core competencies:"):
            idx = resume_text.lower().find(label)
            if idx != -1:
                skills_block = resume_text[idx : idx + 400]
                break
        skills = re.findall(r"[A-Za-z][A-Za-z0-9+#.]{1,30}", skills_block or resume_text[:2000])
        skills = unique_normalized(skills)[:25]
        return self._normalize_parsed(
            {
                "contact_info": {
                    "name": name,
                    "email": email_match.group(0) if email_match else None,
                    "phone": phone_match.group(0) if phone_match else None,
                },
                "skills": skills,
                "work_experience": [],
                "education": [],
                "certifications": [],
                "projects": [],
            },
            resume_text,
        )

    def _normalize_parsed(self, parsed: dict[str, Any], resume_text: str) -> dict[str, Any]:
        contact = parsed.get("contact_info") or {}
        if not isinstance(contact, dict):
            contact = {}

        skills_raw = parsed.get("skills") or []
        if isinstance(skills_raw, str):
            skills_raw = [s.strip() for s in skills_raw.split(",")]
        skills: list[str] = []
        skill_evidence: dict[str, str] = {}
        for item in skills_raw:
            if isinstance(item, dict):
                name = str(item.get("name") or "").strip()
                if name:
                    skills.append(name)
                    if item.get("evidence"):
                        skill_evidence[name] = str(item["evidence"])
            elif item:
                skills.append(str(item))

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
            "skills": unique_normalized(skills),
            "skill_evidence": skill_evidence,
            "experience": experience if isinstance(experience, list) else [],
            "education": education if isinstance(education, list) else [],
            "certifications": [str(c) for c in certifications] if isinstance(certifications, list) else [],
            "projects": projects if isinstance(projects, list) else [],
            "github_url": parsed.get("github_url"),
            "linkedin_url": parsed.get("linkedin_url"),
            "portfolio_url": parsed.get("portfolio_url"),
            "total_years_experience": parsed.get("totalYearsExperience") or parsed.get("total_years_experience"),
            "raw": parsed,
        }

    async def enrich_from_public_profiles(
        self,
        *,
        github_url: str | None = None,
        linkedin_url: str | None = None,
    ) -> dict[str, Any]:
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
