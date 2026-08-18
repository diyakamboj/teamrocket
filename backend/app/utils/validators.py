import re
from pathlib import Path
from typing import Iterable, Optional

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


def redact_identity(text: str, names: Optional[list[str]] = None) -> str:
    """Redact contact info and known person names for blind review."""
    text = redact_pii(text or "")
    for name in names or []:
        cleaned = (name or "").strip()
        if len(cleaned) < 2 or cleaned.lower().startswith("candidate"):
            continue
        text = re.sub(re.escape(cleaned), "the candidate", text, flags=re.IGNORECASE)
        first = cleaned.split()[0]
        if len(first) > 2:
            text = re.sub(rf"\b{re.escape(first)}\b", "the candidate", text, flags=re.IGNORECASE)
    return text


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
