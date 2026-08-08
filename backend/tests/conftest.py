import os
import uuid
from typing import Generator

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

# Force mock Azure before app imports
os.environ["USE_MOCK_AZURE"] = "true"
os.environ["DATABASE_URL"] = "sqlite://"
os.environ["DEBUG"] = "true"

from app.database import Base, get_db
from app.main import app
from app.models.candidate import Candidate
from app.models.job_posting import JobPosting


engine = create_engine(
    "sqlite://",
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)


@event.listens_for(engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture()
def db() -> Generator[Session, None, None]:
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()
        Base.metadata.drop_all(bind=engine)


@pytest.fixture()
def client(db: Session) -> Generator[TestClient, None, None]:
    def _override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = _override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture()
def sample_job(db: Session) -> JobPosting:
    job = JobPosting(
        id=uuid.uuid4(),
        title="Backend Engineer",
        description="Build APIs with Python, FastAPI, SQL, and Azure. Docker preferred.",
        required_skills=["Python", "SQL", "Azure", "Docker"],
        required_experience_years=3,
        education_requirements="Bachelor's in Computer Science",
        nice_to_have_skills=["Kubernetes"],
        created_by="recruiter@example.com",
    )
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


@pytest.fixture()
def sample_candidate(db: Session) -> Candidate:
    candidate = Candidate(
        id=uuid.uuid4(),
        name="Alice Johnson",
        email="alice.johnson@example.com",
        phone="+1-555-1111",
        resume_text="Alice Johnson. Skills: Python, SQL, Azure, Docker. Built APIs for 4 years.",
        skills=["Python", "SQL", "Azure", "Docker"],
        experience=[
            {
                "company": "Acme",
                "title": "Software Engineer",
                "years": 4,
                "description": "Built Python APIs on Azure",
            }
        ],
        education=[{"school": "State U", "degree": "BSc", "field": "Computer Science"}],
        certifications=["AZ-900"],
        projects=[{"name": "API Platform", "description": "FastAPI service", "technologies": ["Python"]}],
    )
    db.add(candidate)
    db.commit()
    db.refresh(candidate)
    return candidate
