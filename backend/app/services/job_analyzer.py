from typing import Any

from app.services.azure_services import openai_service
from app.services.jd_heuristics import analyze_job_text
from app.utils.validators import unique_normalized


class JobAnalyzer:
    async def analyze(self, title: str, description: str) -> dict[str, Any]:
        # Always compute role-aware heuristics so mock/LLM gaps still return relevant skills
        heuristic = analyze_job_text(title, description)

        if openai_service.mock:
            return {
                "required_skills": unique_normalized(heuristic["required_skills"]),
                "nice_to_have_skills": unique_normalized(heuristic["nice_to_have_skills"]),
                "required_experience_years": heuristic["required_experience_years"],
                "education_requirements": heuristic["education_requirements"],
                "summary": heuristic["summary"],
                "detected_title": heuristic.get("title"),
            }

        prompt = f"""
Analyze this job description and extract requirements as JSON with keys:
required_skills (list of skills specific to THIS role — do not invent unrelated tech),
nice_to_have_skills (list),
required_experience_years (int or null),
education_requirements (string or null),
summary (short string about this specific role).

Title: {title}

Description:
{description[:10000]}
"""
        result = openai_service.chat_json(
            prompt,
            system=(
                "You extract structured hiring requirements that match the actual job. "
                "A plumber must not get Python/AWS skills. A software engineer must not get plumbing tools. "
                "Return JSON only."
            ),
            temperature=0.2,
        )
        required = result.get("required_skills") or heuristic["required_skills"]
        nice = result.get("nice_to_have_skills") or heuristic["nice_to_have_skills"]
        if isinstance(required, str):
            required = [s.strip() for s in required.split(",")]
        if isinstance(nice, str):
            nice = [s.strip() for s in nice.split(",")]

        years = result.get("required_experience_years")
        try:
            years = int(years) if years is not None else heuristic["required_experience_years"]
        except (TypeError, ValueError):
            years = heuristic["required_experience_years"]

        if not required:
            required = heuristic["required_skills"]

        return {
            "required_skills": unique_normalized([str(s) for s in required]),
            "nice_to_have_skills": unique_normalized([str(s) for s in nice]),
            "required_experience_years": years,
            "education_requirements": result.get("education_requirements")
            or heuristic["education_requirements"],
            "summary": result.get("summary") or heuristic["summary"],
            "detected_title": heuristic.get("title"),
        }


job_analyzer = JobAnalyzer()
