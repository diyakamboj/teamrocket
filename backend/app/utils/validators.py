import re
from pathlib import Path
from typing import Any, Iterable

ALLOWED_RESUME_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".png", ".jpg", ".jpeg"}
MAX_RESUME_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB

#: Company context documents are prose, never scans — no image types, so a
#: culture deck cannot smuggle in something that only OCR would read.
ALLOWED_COMPANY_DOC_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".md"}
MAX_COMPANY_DOC_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


def is_allowed_resume_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_RESUME_EXTENSIONS


def is_allowed_company_doc_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_COMPANY_DOC_EXTENSIONS


def safe_upload_filename(filename: str) -> str:
    """Reduce a client-supplied filename to a single safe path segment.

    The name goes into a blob key, so directory separators and `..` must not
    survive — an upload called `../../config.json` would otherwise write
    outside its intended prefix. Keeps the extension (validated separately)
    and a conservative character set, and never returns an empty string.
    """
    # Windows separators survive PurePosixPath, so normalise them first.
    base = Path((filename or "").replace("\\", "/")).name
    cleaned = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    cleaned = re.sub(r"_{2,}", "_", cleaned).strip("_")
    cleaned = cleaned.lstrip(".")  # no leading dots: no `..`, no dotfiles
    if not cleaned:
        return "upload"
    # Blob names are capped; keep the extension rather than the middle.
    if len(cleaned) > 120:
        suffix = Path(cleaned).suffix[:10]
        cleaned = cleaned[: 120 - len(suffix)] + suffix
    return cleaned


def normalize_email(email: str) -> str:
    return email.strip().lower()


def is_valid_email(email: str) -> bool:
    pattern = r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$"
    return bool(re.match(pattern, email))


def redact_pii(text: str) -> str:
    """Mask emails and phone numbers for blind review mode."""
    if not text:
        return text
    text = re.sub(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", "[REDACTED_EMAIL]", text)
    text = re.sub(r"(\+?\d[\d\-\s().]{7,}\d)", "[REDACTED_PHONE]", text)
    return text


def redact_name(text: str, name: str) -> str:
    """Strip a specific candidate's name out of free text for blind review mode.

    Resume excerpts (evidence snippets, strengths/weaknesses summaries) often
    quote the source text verbatim, which usually opens with the candidate's
    name — redact_pii's email/phone patterns don't catch that.
    """
    if not text or not name:
        return text
    return re.sub(re.escape(name), "[REDACTED_NAME]", text, flags=re.IGNORECASE)


def normalize_skill(skill: str) -> str:
    return re.sub(r"\s+", " ", skill.strip().lower())


def skill_text(value: Any) -> str:
    """Extract a skill name from a string or {skill/skill_name/...} dict."""
    if isinstance(value, dict):
        return str(
            value.get("skill")
            or value.get("skill_name")
            or value.get("name")
            or value.get("label")
            or ""
        ).strip()
    if value is None:
        return ""
    return str(value).strip()


def normalized_skill_set(skills: Iterable[Any] | None) -> set[str]:
    """Same membership keys CandidateMatcher._jaccard uses after normalize_skill."""
    result: set[str] = set()
    for item in skills or []:
        text = skill_text(item)
        if text:
            result.add(normalize_skill(text))
    return result


def has_normalized_skill(requirement: str, candidate_skills: set[str]) -> bool:
    """True when the requirement is present under CandidateMatcher skill-normalization."""
    key = normalize_skill(requirement)
    return bool(key) and key in candidate_skills


def unique_normalized(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = normalize_skill(item)
        if key and key not in seen:
            seen.add(key)
            result.append(item.strip())
    return result
