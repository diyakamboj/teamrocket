import re
from typing import Any, Optional

from app.models.evaluation import Evidence
from app.storage.store import Store
from app.utils.validators import normalize_skill


class EvidenceTracker:
    def find_snippet(self, resume_text: str, skill: str) -> tuple[Optional[str], str, float]:
        if not resume_text:
            return None, "Unknown", 0.4

        pattern = re.compile(re.escape(skill), re.IGNORECASE)
        match = pattern.search(resume_text)
        if not match:
            return None, "Unknown", 0.3

        start = max(0, match.start() - 60)
        end = min(len(resume_text), match.end() + 60)
        snippet = resume_text[start:end].replace("\n", " ").strip()

        section = "Skills"
        lower = resume_text.lower()
        idx = match.start()
        for label, name in [
            ("experience", "Experience"),
            ("education", "Education"),
            ("project", "Projects"),
            ("certification", "Certifications"),
            ("skill", "Skills"),
        ]:
            pos = lower.rfind(label, 0, idx)
            if pos != -1 and idx - pos < 800:
                section = name
                break
        return snippet, section, 0.85

    def build_evidence(
        self,
        *,
        resume_text: str,
        matched_skills: list[Any],
        experience: list[Any] | None = None,
        projects: list[Any] | None = None,
        dimension: str | None = None,
    ) -> list[dict[str, Any]]:
        evidence: list[dict[str, Any]] = []
        for item in matched_skills:
            if isinstance(item, dict):
                skill = str(item.get("skill") or item.get("skill_name") or "")
            else:
                skill = str(item)
            if not skill:
                continue
            snippet, section, confidence = self.find_snippet(resume_text, skill)
            if not snippet and experience:
                for exp in experience:
                    desc = str(exp.get("description", "")) if isinstance(exp, dict) else str(exp)
                    if normalize_skill(skill) in normalize_skill(desc):
                        snippet = desc[:160]
                        section = "Experience"
                        confidence = 0.75
                        break
            if not snippet and projects:
                for project in projects:
                    desc = (
                        f"{project.get('name', '')} {project.get('description', '')}"
                        if isinstance(project, dict)
                        else str(project)
                    )
                    if normalize_skill(skill) in normalize_skill(desc):
                        snippet = desc[:160]
                        section = "Projects"
                        confidence = 0.7
                        break
            evidence.append(
                {
                    "skill_name": skill,
                    "resume_text_snippet": snippet or f"Mentioned in candidate profile: {skill}",
                    "source_section": section,
                    "confidence_score": confidence,
                    "dimension": dimension,
                }
            )
        return evidence

    def build_rows(self, evaluation_id, evidence_items: list[dict[str, Any]]) -> list[Evidence]:
        """Evidence rows for an evaluation, unsaved — lets bulk re-scoring
        collect every candidate's rows and write them in one batch."""
        return [
            Evidence(
                evaluation_id=evaluation_id,
                skill_name=item.get("skill_name"),
                resume_text_snippet=item.get("resume_text_snippet"),
                source_section=item.get("source_section"),
                confidence_score=item.get("confidence_score"),
                dimension=item.get("dimension"),
            )
            for item in evidence_items
        ]

    def persist(self, store: Store, evaluation_id, evidence_items: list[dict[str, Any]]) -> list[Evidence]:
        # One write for the whole set: evidence is a single document per
        # evaluation, so saving row by row would read-modify-write per row.
        rows = self.build_rows(evaluation_id, evidence_items)
        store.evidence.replace_for_evaluations({str(evaluation_id): rows})
        return rows


evidence_tracker = EvidenceTracker()
