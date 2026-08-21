"""`Store` facade: bundles every entity's repository behind one object.

Routes and services depend on `AppStore` (see `app/dependencies.py`), which
resolves via `get_store()`. A module-level `store` singleton is also
exposed for the one call site that can't use FastAPI DI — the resume-upload
background task in `app/routes/resumes.py`, which today opens its own
`SessionLocal()` because it runs outside the request/response cycle.
"""

from __future__ import annotations

from app.models.ats_benchmark import AtsBenchmarkScore
from app.models.candidate import Candidate
from app.models.user import User
from app.models.company_document import CompanyDocument
from app.models.collaboration import CandidateNote, CandidateShare, DirectMessage
from app.models.placement import CandidatePlacement
from app.models.connection import RecruiterConnection
from app.models.evaluation import (
    AgentSession,
    AuditLog,
    CandidateDecision,
    ChatAttachment,
    ResumeUpload,
)
from app.models.handoff import CandidateHistoryEvent, InterviewHandoff
from app.models.interview import ScheduledInterview
from app.models.interview_questions import RoundQuestionSet
from app.models.job_posting import JobPosting
from app.models.jd_recommendation import JDRecommendationRecord
from app.models.readiness import CandidateAssessmentRecord

from app.models.screening import ScreeningSession
from app.services.azure_services import JsonBlobStore, document_store
from app.storage.repository import (
    AppendOnlyRepository,
    CandidateHistoryRepository,
    AtsBenchmarkRepository,
    EvaluationRepository,
    EvidenceRepository,
    Repository,
)


class Store:
    """Bundles all repositories over a single `JsonBlobStore`.

    Defaults to the module-level `document_store` (mock-local-disk or real
    Azure Blob depending on `settings.USE_MOCK_AZURE`). Tests construct
    `Store(InMemoryJsonBlobStore())` for a fresh, isolated backing store per
    test — see `tests/conftest.py`.
    """

    def __init__(self, blob_store: JsonBlobStore | None = None) -> None:
        backing = blob_store if blob_store is not None else document_store

        self.candidates: Repository[Candidate] = Repository(backing, Candidate, "candidates")
        self.jobs: Repository[JobPosting] = Repository(backing, JobPosting, "job_postings")
        self.evaluations = EvaluationRepository(backing)
        self.evidence = EvidenceRepository(backing)
        self.audit_logs: AppendOnlyRepository[AuditLog] = AppendOnlyRepository(
            backing, AuditLog, "audit_logs"
        )
        self.candidate_decisions: AppendOnlyRepository[CandidateDecision] = AppendOnlyRepository(
            backing, CandidateDecision, "candidate_decisions"
        )
        self.agent_sessions: Repository[AgentSession] = Repository(
            backing, AgentSession, "agent_sessions"
        )
        self.resume_uploads: Repository[ResumeUpload] = Repository(
            backing, ResumeUpload, "resume_uploads"
        )
        self.chat_attachments: Repository[ChatAttachment] = Repository(
            backing, ChatAttachment, "chat_attachments"
        )
        self.candidate_history_events = CandidateHistoryRepository(backing)
        self.handoffs: Repository[InterviewHandoff] = Repository(
            backing, InterviewHandoff, "interview_handoffs"
        )
        self.ats_benchmarks: AtsBenchmarkRepository = AtsBenchmarkRepository(backing)
        self.interviews: Repository[ScheduledInterview] = Repository(
            backing, ScheduledInterview, "scheduled_interviews"
        )
        self.screening_sessions: Repository[ScreeningSession] = Repository(
            backing, ScreeningSession, "screening_sessions"
        )
        self.readiness_assessments: Repository[CandidateAssessmentRecord] = Repository(
            backing, CandidateAssessmentRecord, "readiness_assessments"
        )
        self.round_questions: Repository[RoundQuestionSet] = Repository(
            backing, RoundQuestionSet, "round_questions"
        )
        self.jd_recommendations: Repository[JDRecommendationRecord] = Repository(
            backing, JDRecommendationRecord, "jd_recommendations"
        )
        self.company_documents: Repository[CompanyDocument] = Repository(
            backing, CompanyDocument, "company_documents"
        )
        self.users: Repository[User] = Repository(backing, User, "users")
        self.recruiter_connections: Repository[RecruiterConnection] = Repository(
            backing, RecruiterConnection, "recruiter_connections"
        )
        self.candidate_shares: Repository[CandidateShare] = Repository(
            backing, CandidateShare, "candidate_shares"
        )
        self.direct_messages: Repository[DirectMessage] = Repository(
            backing, DirectMessage, "direct_messages"
        )
        self.candidate_notes: Repository[CandidateNote] = Repository(
            backing, CandidateNote, "candidate_notes"
        )
        self.candidate_placements: Repository[CandidatePlacement] = Repository(
            backing, CandidatePlacement, "candidate_placements"
        )





# Module-level singleton, matching the existing `blob_service = AzureBlobService()`
# pattern in azure_services.py.
store = Store()


def get_store() -> Store:
    """FastAPI dependency: yields the process-wide Store singleton."""
    return store
