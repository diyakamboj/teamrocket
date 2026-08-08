from typing import Annotated, Optional

from fastapi import Depends, Header
from sqlalchemy.orm import Session

from app.database import get_db


DbSession = Annotated[Session, Depends(get_db)]


def get_recruiter_email(
    x_recruiter_email: Optional[str] = Header(default="recruiter@example.com"),
) -> str:
    """Extract recruiter identity from request header for audit logging."""
    return x_recruiter_email or "recruiter@example.com"


RecruiterEmail = Annotated[str, Depends(get_recruiter_email)]
