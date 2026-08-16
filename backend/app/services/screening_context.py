"""Everything the screening agent needs to know before it asks anything.

A screening session can be opened two ways, and both end up as the same
`ScreeningContext`:

  from the database   candidate row + job posting + the latest evaluation for
                      that pair, including the evidence snippets the matcher
                      already extracted. Results can be written back.
  from a payload      a candidate profile supplied by the caller, for rows the
                      recruiter is looking at client-side that have no
                      candidates table entry (same reason the fraud screening
                      endpoint accepts inline candidates). Nothing to write
                      back to, so the session record holds the results.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Mapping, Optional
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.candidate import Candidate
from app.models.evaluation import Evaluation, Evidence
from app.models.job_posting import JobPosting
from app.utils.error_handlers import NotFoundError
from app.utils.validators import normalize_skill


@dataclass
class EvidenceRef:
    """A prior finding the agent can cite when it asks or concludes."""

    source: str  # "resume" | "evaluation" | "job_requirement" | "screening"
    label: str
    detail: str

    def as_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass
class ScreeningContext:
    candidate_ref: str
    candidate_name: str
    title: Optional[str] = None
    years_experience: float = 0.0
    skills: list[str] = field(default_factory=list)
    education: Optional[str] = None
    certifications: list[str] = field(default_factory=list)
    experience: list[dict[str, Any]] = field(default_factory=list)
    projects: list[dict[str, Any]] = field(default_factory=list)

    job_title: str = "the role"
    required_skills: list[str] = field(default_factory=list)
    nice_to_have_skills: list[str] = field(default_factory=list)
    required_experience_years: Optional[int] = None

    # From the existing evaluation, when there is one.
    overall_score: Optional[float] = None
    matched_skills: list[str] = field(default_factory=list)
    missing_skills: list[str] = field(default_factory=list)
    strengths: list[str] = field(default_factory=list)
    gaps: list[str] = field(default_factory=list)
    resume_evidence: list[EvidenceRef] = field(default_factory=list)

    job_id: Optional[UUID] = None
    evaluation_id: Optional[UUID] = None

    def evidence_for_skill(self, skill: str) -> Optional[EvidenceRef]:
        key = normalize_skill(skill)
        for item in self.resume_evidence:
            if key and key in normalize_skill(f"{item.label} {item.detail}"):
                return item
        return None

    def as_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["job_id"] = str(self.job_id) if self.job_id else None
        data["evaluation_id"] = str(self.evaluation_id) if self.evaluation_id else None
        return data


def _skill_names(items: Any) -> list[str]:
    """Skills arrive as bare strings or as {skill|skill_name, source} dicts."""
    names: list[str] = []
    for item in items or []:
        if isinstance(item, Mapping):
            name = str(item.get("skill") or item.get("skill_name") or "").strip()
        else:
            name = str(item or "").strip()
        if name:
            names.append(name)
    return names


def _split_sentences(text: Optional[str]) -> list[str]:
    if not text:
        return []
    parts = [p.strip() for p in str(text).replace("\n", ". ").split(". ")]
    return [p.rstrip(".") for p in parts if len(p.strip()) > 8][:4]


def _education_label(education: Any) -> Optional[str]:
    for item in education or []:
        if isinstance(item, Mapping):
            bits = [
                str(item.get("degree") or "").strip(),
                str(item.get("field") or "").strip(),
                str(item.get("school") or "").strip(),
            ]
            label = " ".join(b for b in bits if b)
            if label:
                return label
        elif str(item).strip():
            return str(item).strip()
    return None


def build_from_db(
    db: Session,
    *,
    candidate_id: UUID,
    job_id: Optional[UUID] = None,
) -> ScreeningContext:
    candidate = db.get(Candidate, candidate_id)
    if not candidate:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

    job: Optional[JobPosting] = db.get(JobPosting, job_id) if job_id else None
    if job_id and not job:
        raise NotFoundError("Job posting not found", {"job_id": str(job_id)})

    context = ScreeningContext(
        candidate_ref=str(candidate.id),
        candidate_name=candidate.name,
        years_experience=candidate.years_of_experience(),
        skills=_skill_names(candidate.skills),
        education=_education_label(candidate.education),
        certifications=_skill_names(candidate.certifications),
        experience=[e for e in (candidate.experience or []) if isinstance(e, Mapping)],
        projects=[p for p in (candidate.projects or []) if isinstance(p, Mapping)],
        job_id=job.id if job else None,
    )

    for item in context.experience:
        title = str(item.get("title") or "").strip()
        if title:
            context.title = title
            break

    if job:
        context.job_title = job.title
        context.required_skills = _skill_names(job.required_skills)
        context.nice_to_have_skills = _skill_names(job.nice_to_have_skills)
        context.required_experience_years = job.required_experience_years

        evaluation = (
            db.query(Evaluation)
            .filter(Evaluation.candidate_id == candidate.id, Evaluation.job_id == job.id)
            .order_by(Evaluation.created_at.desc())
            .first()
        )
        if evaluation:
            context.evaluation_id = evaluation.id
            context.overall_score = (
                float(evaluation.overall_score) if evaluation.overall_score is not None else None
            )
            context.matched_skills = _skill_names(evaluation.matched_skills)
            context.missing_skills = _skill_names(evaluation.missing_skills)
            context.strengths = _split_sentences(evaluation.strengths)
            context.gaps = _split_sentences(evaluation.weaknesses)
            for row in (
                db.query(Evidence)
                .filter(Evidence.evaluation_id == evaluation.id)
                .limit(20)
                .all()
            ):
                context.resume_evidence.append(
                    EvidenceRef(
                        source="resume",
                        label=f"{row.skill_name or 'Resume'} · {row.source_section or 'Unknown'}",
                        detail=(row.resume_text_snippet or "").strip(),
                    )
                )

    _fill_skill_split(context)
    return context


def build_from_payload(payload: Mapping[str, Any]) -> ScreeningContext:
    """Build context from a caller-supplied candidate/job profile."""
    candidate = payload.get("candidate") or {}
    job = payload.get("job") or {}

    context = ScreeningContext(
        candidate_ref=str(candidate.get("id") or "unknown"),
        candidate_name=str(candidate.get("name") or "Candidate"),
        title=(str(candidate["title"]).strip() if candidate.get("title") else None),
        years_experience=float(candidate.get("years") or 0),
        skills=_skill_names(candidate.get("skills")),
        education=(str(candidate["education"]).strip() if candidate.get("education") else None),
        certifications=_skill_names(candidate.get("certifications")),
        overall_score=(
            float(candidate["score"]) if candidate.get("score") is not None else None
        ),
        strengths=[str(s) for s in (candidate.get("strengths") or []) if str(s).strip()],
        gaps=[str(g) for g in (candidate.get("gaps") or []) if str(g).strip()],
        job_title=str(job.get("title") or "the role"),
        required_skills=_skill_names(job.get("required_skills")),
        nice_to_have_skills=_skill_names(job.get("nice_to_have_skills")),
        required_experience_years=(
            int(job["required_experience_years"])
            if job.get("required_experience_years") is not None
            else None
        ),
    )

    for item in candidate.get("evidence") or []:
        if not isinstance(item, Mapping):
            continue
        skill = str(item.get("skill") or "").strip()
        detail = str(item.get("detail") or "").strip()
        source = str(item.get("source") or "").strip()
        if not (skill or detail):
            continue
        context.resume_evidence.append(
            EvidenceRef(
                source="resume",
                label=f"{skill or 'Resume'} · {source or 'Profile'}",
                detail=detail,
            )
        )

    _fill_skill_split(context)
    return context


def apply_job(context: ScreeningContext, job: JobPosting) -> ScreeningContext:
    """Point an inline-profile context at a real job posting.

    Lets a recruiter screen a candidate they are looking at client-side
    against the actual requirements on file, rather than a job description
    the client had to invent.
    """
    context.job_id = job.id
    context.job_title = job.title
    context.required_skills = _skill_names(job.required_skills)
    context.nice_to_have_skills = _skill_names(job.nice_to_have_skills)
    context.required_experience_years = job.required_experience_years
    context.matched_skills = []
    context.missing_skills = []
    _fill_skill_split(context)
    return context


def _fill_skill_split(context: ScreeningContext) -> None:
    """Derive matched/missing required skills when no evaluation supplied them."""
    if not context.required_skills:
        return
    owned = {normalize_skill(s) for s in context.skills}
    if not context.matched_skills:
        context.matched_skills = [
            s for s in context.required_skills if normalize_skill(s) in owned
        ]
    if not context.missing_skills:
        context.missing_skills = [
            s for s in context.required_skills if normalize_skill(s) not in owned
        ]
