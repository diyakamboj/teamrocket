from typing import Any
from uuid import uuid4

from app.services.azure_services import openai_service
from app.services.jd_heuristics import analyze_job_text
from app.utils.validators import unique_normalized

JD_SYSTEM_PROMPT = """You extract screening requirements from job descriptions for a recruiting platform.

Produce one requirement per distinct, checkable hiring criterion. Rules:
- category must be exactly one of: Skills, Experience, Education, Certifications.
- text is a short recruiter-readable criterion (max 12 words).
- must = true only when the job description states it as required/essential/minimum.
- keywords are literal search terms including aliases (3-8 per requirement, lowercase).
- minYears only on Experience requirements that state a duration.
- Do not invent requirements. Do not duplicate criteria across categories.
- title is the role title. summary is 2-3 sentences describing what this role screens for.
Return JSON with keys: title, summary, requirements (list of {category, text, must, keywords, minYears?}),
required_skills, nice_to_have_skills, required_experience_years, education_requirements."""


class JobAnalyzer:
    async def analyze(self, title: str, description: str) -> dict[str, Any]:
        heuristic = analyze_job_text(title, description)

        if openai_service.mock:
            return self._from_heuristic(heuristic, title)

        prompt = f"""Title: {title}

Job description:
\"\"\"
{description[:30000]}
\"\"\"
"""
        result = openai_service.chat_json_or_empty(prompt, system=JD_SYSTEM_PROMPT, temperature=0)
        requirements = self._normalize_requirements(result.get("requirements") or [])
        required = result.get("required_skills") or [
            r["text"] for r in requirements if r.get("must") and r.get("category") == "Skills"
        ]
        nice = result.get("nice_to_have_skills") or [
            r["text"] for r in requirements if not r.get("must") and r.get("category") == "Skills"
        ]
        if isinstance(required, str):
            required = [s.strip() for s in required.split(",")]
        if isinstance(nice, str):
            nice = [s.strip() for s in nice.split(",")]
        if not required:
            required = heuristic["required_skills"]

        years = result.get("required_experience_years")
        try:
            years = int(years) if years is not None else heuristic["required_experience_years"]
        except (TypeError, ValueError):
            years = heuristic["required_experience_years"]

        if not requirements:
            requirements = self._requirements_from_lists(required, nice, years, result.get("education_requirements"))

        return {
            "required_skills": unique_normalized([str(s) for s in required]),
            "nice_to_have_skills": unique_normalized([str(s) for s in nice]),
            "required_experience_years": years,
            "education_requirements": result.get("education_requirements")
            or heuristic["education_requirements"],
            "summary": result.get("summary") or heuristic["summary"],
            "detected_title": result.get("title") or heuristic.get("title") or title,
            "requirements": requirements,
            "analyzed_by": "azure-openai",
        }

    def _from_heuristic(self, heuristic: dict[str, Any], title: str) -> dict[str, Any]:
        required = heuristic["required_skills"]
        nice = heuristic["nice_to_have_skills"]
        return {
            "required_skills": unique_normalized(required),
            "nice_to_have_skills": unique_normalized(nice),
            "required_experience_years": heuristic["required_experience_years"],
            "education_requirements": heuristic["education_requirements"],
            "summary": heuristic["summary"],
            "detected_title": heuristic.get("title") or title,
            "requirements": self._requirements_from_lists(
                required,
                nice,
                heuristic["required_experience_years"],
                heuristic["education_requirements"],
            ),
            "analyzed_by": "heuristic",
        }

    def _normalize_requirements(self, raw: list[Any]) -> list[dict[str, Any]]:
        requirements: list[dict[str, Any]] = []
        for item in raw:
            if not isinstance(item, dict):
                continue
            category = str(item.get("category") or "Skills")
            text = str(item.get("text") or "").strip()
            if not text:
                continue
            keywords = item.get("keywords") or [text.lower()]
            if isinstance(keywords, str):
                keywords = [keywords]
            req = {
                "id": str(item.get("id") or f"req-{uuid4().hex[:8]}"),
                "category": category,
                "text": text,
                "must": bool(item.get("must", True)),
                "keywords": [str(k).lower() for k in keywords if k],
            }
            if item.get("minYears") is not None:
                req["minYears"] = item.get("minYears")
            requirements.append(req)
        return requirements

    def _requirements_from_lists(
        self,
        required: list[str],
        nice: list[str],
        years: int | None,
        education: str | None,
    ) -> list[dict[str, Any]]:
        requirements: list[dict[str, Any]] = []
        for skill in required:
            requirements.append(
                {
                    "id": f"req-{uuid4().hex[:8]}",
                    "category": "Skills",
                    "text": skill,
                    "must": True,
                    "keywords": [skill.lower()],
                }
            )
        for skill in nice:
            requirements.append(
                {
                    "id": f"req-{uuid4().hex[:8]}",
                    "category": "Skills",
                    "text": skill,
                    "must": False,
                    "keywords": [skill.lower()],
                }
            )
        if years:
            requirements.append(
                {
                    "id": f"req-{uuid4().hex[:8]}",
                    "category": "Experience",
                    "text": f"{years}+ years experience",
                    "must": True,
                    "keywords": ["experience", "years"],
                    "minYears": years,
                }
            )
        if education:
            requirements.append(
                {
                    "id": f"req-{uuid4().hex[:8]}",
                    "category": "Education",
                    "text": education[:80],
                    "must": True,
                    "keywords": [w for w in education.lower().split() if len(w) > 3][:6],
                }
            )
        return requirements


job_analyzer = JobAnalyzer()
