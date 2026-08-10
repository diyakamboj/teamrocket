import re
from pathlib import Path
from typing import Iterable

ALLOWED_RESUME_EXTENSIONS = {".pdf", ".docx", ".doc", ".txt", ".png", ".jpg", ".jpeg"}
MAX_RESUME_SIZE_BYTES = 15 * 1024 * 1024  # 15 MB


def is_allowed_resume_filename(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_RESUME_EXTENSIONS


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


def unique_normalized(items: Iterable[str]) -> list[str]:
    seen: set[str] = set()
    result: list[str] = []
    for item in items:
        key = normalize_skill(item)
        if key and key not in seen:
            seen.add(key)
            result.append(item.strip())
    return result
