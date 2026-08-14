from typing import Annotated, Optional

from fastapi import Depends, Header

from app.storage.store import Store, get_store


AppStore = Annotated[Store, Depends(get_store)]


def get_recruiter_email(
    x_recruiter_email: Optional[str] = Header(default="recruiter@example.com"),
) -> str:
    """Extract recruiter identity from request header for audit logging."""
    return x_recruiter_email or "recruiter@example.com"


RecruiterEmail = Annotated[str, Depends(get_recruiter_email)]
