from collections.abc import Generator

from sqlalchemy import create_engine, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker
from sqlalchemy.pool import StaticPool

from app.config import settings


def _build_engine():
    url = settings.DATABASE_URL
    if url.startswith("sqlite"):
        return create_engine(
            url,
            connect_args={"check_same_thread": False},
            poolclass=StaticPool,
        )
    return create_engine(
        url,
        pool_pre_ping=True,
        pool_size=10,
        max_overflow=20,
    )


engine = _build_engine()

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    """Create tables and ensure required Postgres extensions exist."""
    if engine.dialect.name == "postgresql":
        with engine.begin() as conn:
            conn.execute(text('CREATE EXTENSION IF NOT EXISTS "pgcrypto"'))
    # Import models so metadata is populated
    from app.models import candidate, evaluation, job_posting  # noqa: F401

    Base.metadata.create_all(bind=engine)
