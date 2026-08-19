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
            # Empty on failure -> no skills -> falls through to the
            # heuristic parse below rather than failing the upload.
            parsed = openai_service.chat_json_or_empty(
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

    # Section headings as they appear on real resumes: with or without a
    # colon, on their own line, in any case.
    _SECTION_ALIASES: dict[str, tuple[str, ...]] = {
        "skills": ("skills", "technical skills", "core competencies", "technologies"),
        "experience": ("experience", "work experience", "employment", "professional experience"),
        "education": ("education", "academic background"),
        "certifications": ("certifications", "certificates", "licenses"),
        "projects": ("projects", "selected projects", "personal projects"),
        "summary": ("summary", "profile", "objective", "about"),
    }

    # Words that show up inside a skills block as connective tissue, never as
    # a skill in their own right.
    _SKILL_STOPWORDS = frozenset(
        {
            "and", "or", "with", "using", "the", "a", "an", "of", "in", "on",
            "for", "to", "etc", "including", "such", "as", "other", "various",
            "skills", "technical", "core", "competencies", "technologies",
        }
    )

    def _split_sections(self, resume_text: str) -> dict[str, str]:
        """Splits a resume into named sections keyed by canonical name.

        A heading is a short standalone line matching a known alias — this is
        what lets the skills block be bounded at the next heading instead of
        running to an arbitrary character count.
        """
        heading_for: dict[str, str] = {}
        for canonical, aliases in self._SECTION_ALIASES.items():
            for alias in aliases:
                heading_for[alias] = canonical

        sections: dict[str, list[str]] = {}
        current: str | None = None
        for raw_line in resume_text.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            # Heading alone on its own line: "SKILLS" or "Skills:"
            key = line.rstrip(":").strip().lower()
            if len(line) <= 40 and key in heading_for:
                current = heading_for[key]
                sections.setdefault(current, [])
                continue

            # Heading and content on one line: "Skills: Python, FastAPI"
            head, sep, rest = line.partition(":")
            head_key = head.strip().lower()
            if sep and head_key in heading_for:
                current = heading_for[head_key]
                sections.setdefault(current, [])
                if rest.strip():
                    sections[current].append(rest.strip())
                continue

            if current:
                sections[current].append(line)

        return {name: "\n".join(lines) for name, lines in sections.items()}

    def _parse_skills(self, skills_block: str) -> list[str]:
        """Skills are delimited items (comma/semicolon/pipe/bullet/newline).

        Tokenizing on every word instead turned prose into "skills" like
        "and", "on" and the candidate's own name.
        """
        if not skills_block:
            return []

        # Sub-category labels ("Languages:", "Tools:", "Core Areas:") often
        # sit at the start of a line inside the skills section rather than
        # being their own heading — without this they'd glue onto the first
        # item as a single "skill" like "Languages:Python".
        skills_block = re.sub(r"(?m)^\s*[A-Za-z][A-Za-z /&]{1,24}:\s*", "", skills_block)

        candidates: list[str] = []
        for part in re.split(r"[,;|\u2022\u00b7\n\t]+", skills_block):
            item = part.strip(" .-–—\t")
            if not item:
                continue
            # A skill is a short phrase, not a sentence.
            if len(item) > 40 or len(item.split()) > 4:
                continue
            if item.lower() in self._SKILL_STOPWORDS:
                continue
            if not re.search(r"[A-Za-z]", item):
                continue
            candidates.append(item)

        return unique_normalized(candidates)[:30]

    _EMAIL_PATTERN = r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}"

    def _first_email(self, resume_text: str) -> str:
        """The first address in the resume — used when the model omits it."""
        match = re.search(self._EMAIL_PATTERN, resume_text, re.I)
        return match.group(0) if match else ""

    def _likely_name(self, resume_text: str) -> str:
        """The candidate's name, read the way a person reads a resume: the
        first non-empty line, provided it looks like a name rather than a
        heading, an address or a contact line."""
        for line in (l.strip() for l in resume_text.splitlines()):
            if not line or len(line) > 60:
                continue
            if re.search(self._EMAIL_PATTERN, line, re.I) or re.search(r"\d", line):
                continue
            # A colon anywhere means a labelled line ("Skills: Python"),
            # never a name.
            if ":" in line or line.lower() in {"resume", "curriculum vitae", "cv"}:
                continue
            if line.split()[0].rstrip(":").lower() in self._SECTION_ALIASES:
                continue
            words = line.split()
            if 1 < len(words) <= 5 and all(w[:1].isalpha() for w in words):
                return line
            break
        return ""

    def _heuristic_parse(self, resume_text: str) -> dict[str, Any]:
        lines = [line.strip() for line in resume_text.splitlines() if line.strip()]
        name = lines[0] if lines else "Unknown Candidate"
        email_match = re.search(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", resume_text, re.I)
        phone_match = re.search(r"\+?\d[\d\s().-]{7,}\d", resume_text)

        # "City, ST" or "City, Country" in the contact block at the top.
        location = None
        for line in lines[:6]:
            if email_match and email_match.group(0) in line:
                continue
            match = re.fullmatch(r"([A-Z][A-Za-z.\- ]{1,30}),\s*([A-Z]{2}|[A-Z][A-Za-z ]{1,20})", line)
            if match:
                location = line
                break

        sections = self._split_sections(resume_text)
        skills = self._parse_skills(sections.get("skills", ""))

        experience: list[dict[str, Any]] = []
        experience_block = sections.get("experience", "")
        if experience_block:
            years = None
            years_match = re.search(r"approximately\s+(\d+)\s*months", experience_block, re.I)
            if years_match:
                years = round(int(years_match.group(1)) / 12, 1)
            else:
                span = re.search(r"(19|20)\d{2}\s*[-–]\s*((19|20)\d{2}|present)", experience_block, re.I)
                if span:
                    start = int(span.group(0)[:4])
                    end_text = span.group(2)
                    end = 2026 if end_text.lower() == "present" else int(end_text)
                    years = max(0.0, float(end - start))
            first_line = experience_block.splitlines()[0]
            title = first_line.split("|")[0].strip() or None
            experience.append(
                {
                    "company": None,
                    "title": title,
                    "duration": None,
                    "years": years,
                    "description": experience_block[:1000],
                }
            )

        education = [
            line for line in sections.get("education", "").splitlines() if line
        ][:5]
        certifications = self._parse_skills(sections.get("certifications", ""))
        projects = [line for line in sections.get("projects", "").splitlines() if line][:5]

        return self._normalize_parsed(
            {
                "contact_info": {
                    "name": name,
                    "email": email_match.group(0) if email_match else None,
                    "phone": phone_match.group(0) if phone_match else None,
                    "location": location,
                },
                "skills": skills,
                "work_experience": experience,
                "education": education,
                "certifications": certifications,
                "projects": projects,
            },
            resume_text,
        )

    #: Wrappers a model may put contact details in. The prompt asks for JSON
    #: without pinning a schema, so the same deployment legitimately returns
    #: `{"name": ...}` one day and `{"contact_info": {"name": ...}}` another.
    _CONTACT_WRAPPERS = ("contact_info", "contactInfo", "contact", "basics", "personal_info")

    def _contact_fields(self, parsed: dict[str, Any]) -> dict[str, Any]:
        """Contact details from wherever the model put them.

        Reading only `contact_info` meant a top-level `{"name": ...}` — which
        is what the current deployment returns — was silently dropped, and
        every uploaded resume became "Unknown Candidate" with a synthesised
        email address.
        """
        contact: dict[str, Any] = {}
        for wrapper in self._CONTACT_WRAPPERS:
            nested = parsed.get(wrapper)
            if isinstance(nested, dict):
                contact = {**nested, **contact}
        for field in ("name", "email", "phone", "location"):
            if not contact.get(field) and parsed.get(field):
                contact[field] = parsed[field]
        return contact

    def _normalize_parsed(self, parsed: dict[str, Any], resume_text: str) -> dict[str, Any]:
        contact = self._contact_fields(parsed)

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

        # Read it off the resume ourselves before giving up on the identity:
        # a candidate filed as "Unknown Candidate" is invisible to the
        # recruiter who just uploaded them.
        email = str(contact.get("email") or "").strip() or self._first_email(resume_text)
        name = str(contact.get("name") or "").strip() or self._likely_name(resume_text)
        email = email or f"unknown.{abs(hash(resume_text)) % 10_000_000}@example.com"
        name = name or "Unknown Candidate"

        return {
            "name": name,
            "email": normalize_email(str(email)),
            "phone": contact.get("phone"),
            "location": contact.get("location"),
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
        return openai_service.chat_json_or_empty(prompt, temperature=0.2)


resume_parser = ResumeParser()
