"""Recruiter directory and connections.

Lets technical recruiters find each other and connect, so a candidate can be
discussed with the person who screened them elsewhere. Everything is scoped
to the signed-in recruiter: you see the directory, your own requests, and the
connections you are part of — never someone else's.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone

from fastapi import APIRouter
from pydantic import BaseModel

from app.dependencies import AppStore, RecruiterEmail
from app.models.collaboration import (
    SHARE_PERMISSIONS,
    CandidateNote,
    CandidateShare,
    DirectMessage,
    MessageThread,
    SharedCandidateView,
    SharedRound,
)
from app.models.connection import (
    CONNECTION_STATUSES,
    ConnectionView,
    RecruiterConnection,
    RecruiterDirectoryEntry,
)
from app.models.evaluation import AuditLog
from app.services import placement_service
from app.utils.error_handlers import NotFoundError, ValidationAppError
from app.utils.logger import get_logger
from app.utils.validators import normalize_email

router = APIRouter()
logger = get_logger(__name__)


class ConnectRequest(BaseModel):
    email: str
    message: str | None = None


class RespondRequest(BaseModel):
    accept: bool


def _audit(store, **fields) -> None:
    try:
        store.audit_logs.save(AuditLog(**fields))
    except Exception as exc:
        logger.warning("Failed to persist audit log %s: %s", fields.get("action"), exc)


def _connections_for(store, email: str) -> list[RecruiterConnection]:
    return store.recruiter_connections.query(lambda c: c.involves(email))


def _pair_key(a: str, b: str) -> frozenset[str]:
    return frozenset({normalize_email(a), normalize_email(b)})


def _view(connection: RecruiterConnection, me: str, profiles: dict[str, dict]) -> ConnectionView:
    other = connection.other_party(me)
    profile = profiles.get(other, {})
    return ConnectionView(
        id=connection.id,
        status=connection.status,
        direction="outgoing" if connection.requester_email == me else "incoming",
        counterpart_email=other,
        counterpart_name=profile.get("name") or other,
        counterpart_role=profile.get("role") or "Recruiter",
        message=connection.message,
        created_at=connection.created_at,
    )


def _profiles(store) -> dict[str, dict]:
    return {
        normalize_email(u.email): {"name": u.name, "role": u.role, "department": u.department}
        for u in store.users.list_all()
    }


@router.get("/directory", response_model=list[RecruiterDirectoryEntry])
def directory(store: AppStore, recruiter_email: RecruiterEmail):
    """Other recruiters on this deployment, with your connection state to each.

    Only the fields needed to decide whether to connect — never anyone's
    candidates, jobs or documents.
    """
    me = normalize_email(recruiter_email)
    mine = _connections_for(store, me)
    state_by_pair: dict[frozenset[str], str] = {}
    for connection in mine:
        pair = _pair_key(connection.requester_email, connection.addressee_email)
        if connection.status == "accepted":
            state_by_pair[pair] = "connected"
        elif connection.status == "pending":
            state_by_pair[pair] = (
                "pending_outgoing" if connection.requester_email == me else "pending_incoming"
            )

    entries = []
    for user in store.users.list_all():
        email = normalize_email(user.email)
        if email == me:
            continue
        entries.append(
            RecruiterDirectoryEntry(
                email=email,
                name=user.name,
                role=user.role,
                department=user.department,
                connection_state=state_by_pair.get(_pair_key(me, email), "none"),
            )
        )
    return sorted(entries, key=lambda e: e.name.lower())


@router.get("", response_model=list[ConnectionView])
def list_connections(store: AppStore, recruiter_email: RecruiterEmail):
    me = normalize_email(recruiter_email)
    profiles = _profiles(store)
    views = [_view(c, me, profiles) for c in _connections_for(store, me)]
    return sorted(views, key=lambda v: v.created_at, reverse=True)


@router.post("", response_model=ConnectionView, status_code=201)
def request_connection(payload: ConnectRequest, store: AppStore, recruiter_email: RecruiterEmail):
    me = normalize_email(recruiter_email)
    target = normalize_email(payload.email)

    if target == me:
        raise ValidationAppError("You cannot connect with yourself.")

    profiles = _profiles(store)
    if target not in profiles:
        raise NotFoundError("No recruiter with that email", {"email": target})

    existing = next(
        (
            c
            for c in _connections_for(store, me)
            if _pair_key(c.requester_email, c.addressee_email) == _pair_key(me, target)
            and c.status in ("pending", "accepted")
        ),
        None,
    )
    if existing:
        raise ValidationAppError(
            "You are already connected to that recruiter."
            if existing.status == "accepted"
            else "There is already a pending request with that recruiter."
        )

    connection = RecruiterConnection(
        requester_email=me,
        addressee_email=target,
        message=(payload.message or "").strip() or None,
    )
    store.recruiter_connections.save(connection)
    _audit(
        store,
        recruiter_email=me,
        action="connection_requested",
        resource_type="recruiter_connection",
        resource_id=connection.id,
        details={"addressee": target},
    )
    return _view(connection, me, profiles)


@router.post("/{connection_id}/respond", response_model=ConnectionView)
def respond(
    connection_id: uuid.UUID,
    payload: RespondRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Accept or decline a request addressed to you."""
    me = normalize_email(recruiter_email)
    connection = store.recruiter_connections.get(connection_id)
    # Only the addressee may answer, and a stranger must not learn the request
    # exists — hence 404 rather than 403.
    if not connection or connection.addressee_email != me:
        raise NotFoundError("Connection request not found", {"connection_id": str(connection_id)})
    if connection.status != "pending":
        raise ValidationAppError("That request has already been answered.")

    connection.status = "accepted" if payload.accept else "declined"
    connection.responded_at = datetime.now(timezone.utc).replace(tzinfo=None)
    store.recruiter_connections.save(connection)

    _audit(
        store,
        recruiter_email=me,
        action=f"connection_{connection.status}",
        resource_type="recruiter_connection",
        resource_id=connection.id,
        details={"requester": connection.requester_email},
    )
    return _view(connection, me, _profiles(store))


@router.delete("/{connection_id}", status_code=204)
def remove(connection_id: uuid.UUID, store: AppStore, recruiter_email: RecruiterEmail):
    """Withdraw a request or disconnect. Either side may do this."""
    me = normalize_email(recruiter_email)
    connection = store.recruiter_connections.get(connection_id)
    if not connection or not connection.involves(me):
        raise NotFoundError("Connection not found", {"connection_id": str(connection_id)})
    store.recruiter_connections.delete(connection_id)
    return None


assert set(CONNECTION_STATUSES) == {"pending", "accepted", "declined"}


# ---------------------------------------------------------------------------
# Collaboration: sharing candidates and messaging, both gated on an accepted
# connection. Connecting is what grants the ability to share and message;
# without it these all answer 403.
# ---------------------------------------------------------------------------


class ShareCandidateRequest(BaseModel):
    candidate_id: uuid.UUID
    email: str
    note: str | None = None
    job_id: uuid.UUID | None = None
    #: "view" (read-only) or "collaborate" (may add notes and move the
    #: candidate in the owner's pipeline).
    permission: str = "view"


class SharePermissionUpdate(BaseModel):
    permission: str


class CandidateNoteRequest(BaseModel):
    body: str
    job_id: uuid.UUID | None = None


class SendMessageRequest(BaseModel):
    email: str
    body: str
    candidate_id: uuid.UUID | None = None


def _is_connected(store, me: str, other: str) -> bool:
    return any(
        c.status == "accepted"
        and _pair_key(c.requester_email, c.addressee_email) == _pair_key(me, other)
        for c in _connections_for(store, me)
    )


def _require_connection(store, me: str, other: str) -> None:
    if not _is_connected(store, me, other):
        raise ValidationAppError(
            "You can only do that with a recruiter you are connected to.",
            {"email": other},
        )


@router.post("/share", response_model=SharedCandidateView, status_code=201)
def share_candidate(
    payload: ShareCandidateRequest, store: AppStore, recruiter_email: RecruiterEmail
):
    """Share one of your candidates with a connected recruiter.

    At "view" they can read the profile and screening result. At
    "collaborate" they can also add notes and move the candidate through
    your pipeline — the record still belongs to you and you can revoke or
    downgrade the share at any time.
    """
    me = normalize_email(recruiter_email)
    target = normalize_email(payload.email)
    _require_connection(store, me, target)
    if payload.permission not in SHARE_PERMISSIONS:
        raise ValidationAppError(
            f"permission must be one of {', '.join(SHARE_PERMISSIONS)}",
            {"permission": payload.permission},
        )

    candidate = store.candidates.get(payload.candidate_id)
    # You can only share what you own — sharing someone else's candidate would
    # be a way around the ownership scoping.
    if not candidate or candidate.owner_email != me:
        raise NotFoundError("Candidate not found", {"candidate_id": str(payload.candidate_id)})

    existing = next(
        (
            s
            for s in store.candidate_shares.list_all()
            if s.candidate_id == candidate.id
            and s.owner_email == me
            and s.shared_with_email == target
        ),
        None,
    )
    if existing:
        # Re-sharing is how the owner changes their mind about access, so
        # take the new permission rather than rejecting the whole request.
        if existing.permission != payload.permission:
            existing.permission = payload.permission
            store.candidate_shares.save(existing)
            return _share_view(store, existing)
        raise ValidationAppError("That candidate is already shared with them.")

    job = store.jobs.get(payload.job_id) if payload.job_id else None
    share = CandidateShare(
        candidate_id=candidate.id,
        owner_email=me,
        shared_with_email=target,
        permission=payload.permission,
        note=(payload.note or "").strip() or None,
        job_id=job.id if job else None,
        job_title=job.title if job else None,
    )
    store.candidate_shares.save(share)
    _audit(
        store,
        recruiter_email=me,
        action="candidate_shared",
        resource_type="candidate",
        resource_id=candidate.id,
        details={"shared_with": target, "permission": share.permission},
    )
    return _share_view(store, share)


@router.patch("/share/{share_id}", response_model=SharedCandidateView)
def update_share_permission(
    share_id: uuid.UUID,
    payload: SharePermissionUpdate,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Promote a share to collaboration, or demote it back to read-only."""
    me = normalize_email(recruiter_email)
    if payload.permission not in SHARE_PERMISSIONS:
        raise ValidationAppError(
            f"permission must be one of {', '.join(SHARE_PERMISSIONS)}",
            {"permission": payload.permission},
        )
    share = store.candidate_shares.get(share_id)
    # Only the owner sets access; the recipient must not be able to grant
    # themselves more than they were given.
    if not share or share.owner_email != me:
        raise NotFoundError("Share not found", {"share_id": str(share_id)})

    share.permission = payload.permission
    store.candidate_shares.save(share)
    _audit(
        store,
        recruiter_email=me,
        action="candidate_share_permission_changed",
        resource_type="candidate",
        resource_id=share.candidate_id,
        details={"shared_with": share.shared_with_email, "permission": share.permission},
    )
    return _share_view(store, share)


def _share_view(store, share: CandidateShare) -> SharedCandidateView:
    candidate = store.candidates.get(share.candidate_id)
    profiles = _profiles(store)
    sessions = [
        s
        for s in store.screening_sessions.query(lambda s: s.candidate_id == share.candidate_id)
        if s.status == "completed"
    ]
    latest = max(sessions, key=lambda s: s.updated_at, default=None)

    # Pipeline context, so a collaborator can act without listing the owner's
    # jobs — which ownership scoping correctly refuses them.
    job = store.jobs.get(share.job_id) if share.job_id else None
    placement = (
        placement_service.get_placement(store, job.id, str(share.candidate_id)) if job else None
    )
    rounds = sorted(job.rounds or [], key=lambda r: r.sequence) if job else []

    return SharedCandidateView(
        share_id=share.id,
        candidate_id=share.candidate_id,
        name=candidate.name if candidate else "Unavailable",
        title=candidate.title if candidate else None,
        location=candidate.location if candidate else None,
        skills=[str(s) for s in (candidate.skills if candidate else [])][:12],
        shared_by_email=share.owner_email,
        shared_by_name=(profiles.get(share.owner_email) or {}).get("name") or share.owner_email,
        shared_with_email=share.shared_with_email,
        shared_with_name=(profiles.get(share.shared_with_email) or {}).get("name")
        or share.shared_with_email,
        permission=share.permission,
        note=share.note,
        job_id=share.job_id,
        job_title=share.job_title,
        stage=placement.stage if placement else ("screened" if job else None),
        round_id=placement.round_id if placement else None,
        round_name=next(
            (r.name for r in rounds if placement and r.id == placement.round_id), None
        ),
        rounds=[SharedRound(id=r.id, name=r.name, sequence=r.sequence) for r in rounds],
        screening_summary=latest.summary_pack if latest else None,
        screening_score=latest.overall_score if latest else None,
        created_at=share.created_at,
    )


@router.get("/shared-with-me", response_model=list[SharedCandidateView])
def shared_with_me(store: AppStore, recruiter_email: RecruiterEmail):
    me = normalize_email(recruiter_email)
    shares = store.candidate_shares.query(lambda s: s.shared_with_email == me)
    views = [_share_view(store, s) for s in shares]
    return sorted(views, key=lambda v: v.created_at, reverse=True)


@router.get("/shared-by-me", response_model=list[SharedCandidateView])
def shared_by_me(store: AppStore, recruiter_email: RecruiterEmail):
    me = normalize_email(recruiter_email)
    shares = store.candidate_shares.query(lambda s: s.owner_email == me)
    views = [_share_view(store, s) for s in shares]
    return sorted(views, key=lambda v: v.created_at, reverse=True)


@router.delete("/share/{share_id}", status_code=204)
def unshare(share_id: uuid.UUID, store: AppStore, recruiter_email: RecruiterEmail):
    """Revoke a share. Only the owner can — the recipient never had the record."""
    me = normalize_email(recruiter_email)
    share = store.candidate_shares.get(share_id)
    if not share or share.owner_email != me:
        raise NotFoundError("Share not found", {"share_id": str(share_id)})
    store.candidate_shares.delete(share_id)
    return None


@router.get("/messages", response_model=list[MessageThread])
def list_threads(store: AppStore, recruiter_email: RecruiterEmail):
    """Inbox: one row per conversation, newest first."""
    me = normalize_email(recruiter_email)
    profiles = _profiles(store)
    mine = store.direct_messages.query(lambda m: me in (m.sender_email, m.recipient_email))

    threads: dict[str, MessageThread] = {}
    for message in sorted(mine, key=lambda m: m.created_at):
        other = message.recipient_email if message.sender_email == me else message.sender_email
        unread = threads[other].unread_count if other in threads else 0
        if message.recipient_email == me and message.read_at is None:
            unread += 1
        threads[other] = MessageThread(
            counterpart_email=other,
            counterpart_name=(profiles.get(other) or {}).get("name") or other,
            last_message=message.body,
            last_message_at=message.created_at,
            unread_count=unread,
        )
    return sorted(threads.values(), key=lambda t: t.last_message_at, reverse=True)


@router.get("/messages/{email}", response_model=list[DirectMessage])
def read_thread(email: str, store: AppStore, recruiter_email: RecruiterEmail):
    """One conversation, oldest first. Reading it marks their messages read."""
    me = normalize_email(recruiter_email)
    other = normalize_email(email)
    key = DirectMessage.key_for(me, other)
    messages = sorted(
        store.direct_messages.query(lambda m: m.thread_key == key),
        key=lambda m: m.created_at,
    )
    now = datetime.now(timezone.utc).replace(tzinfo=None)
    unread = [m for m in messages if m.recipient_email == me and m.read_at is None]
    for message in unread:
        message.read_at = now
    if unread:
        store.direct_messages.save_many(unread)
    return messages


@router.post("/messages", response_model=DirectMessage, status_code=201)
def send_message(payload: SendMessageRequest, store: AppStore, recruiter_email: RecruiterEmail):
    me = normalize_email(recruiter_email)
    target = normalize_email(payload.email)
    _require_connection(store, me, target)

    body = (payload.body or "").strip()
    if not body:
        raise ValidationAppError("Write a message first.")
    if len(body) > 4000:
        raise ValidationAppError("Messages are limited to 4000 characters.")

    message = DirectMessage(
        thread_key=DirectMessage.key_for(me, target),
        sender_email=me,
        recipient_email=target,
        body=body,
        candidate_id=payload.candidate_id,
    )
    store.direct_messages.save(message)
    return message


# ---------------------------------------------------------------------------
# Shared candidate notes
#
# Notes hang off the candidate rather than off a conversation: both recruiters
# working a candidate see the same thread, and it stays attached to the
# candidate rather than scattered through direct messages.
# ---------------------------------------------------------------------------


class CandidateNoteView(BaseModel):
    """A note plus who wrote it, resolved for display."""

    id: uuid.UUID
    candidate_id: uuid.UUID
    author_email: str
    author_name: str
    body: str
    job_id: uuid.UUID | None = None
    created_at: datetime
    #: True when the signed-in recruiter wrote it.
    mine: bool = False


def _candidate_access(store, candidate_id: uuid.UUID, me: str) -> tuple[bool, bool]:
    """(can_read, can_collaborate) for one recruiter on one candidate."""
    candidate = store.candidates.get(candidate_id)
    if candidate and normalize_email(candidate.owner_email or "") == me:
        return True, True
    share = next(
        (
            s
            for s in store.candidate_shares.list_all()
            if str(s.candidate_id) == str(candidate_id)
            and normalize_email(s.shared_with_email) == me
        ),
        None,
    )
    if share is None:
        return False, False
    return True, share.allows_collaboration()


@router.get("/candidates/{candidate_id}/notes", response_model=list[CandidateNoteView])
def list_candidate_notes(
    candidate_id: uuid.UUID, store: AppStore, recruiter_email: RecruiterEmail
):
    """Every note on a candidate, oldest first — readable by the owner and
    anyone the candidate is shared with."""
    me = normalize_email(recruiter_email)
    can_read, _ = _candidate_access(store, candidate_id, me)
    if not can_read:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})

    profiles = _profiles(store)
    notes = store.candidate_notes.query(lambda n: str(n.candidate_id) == str(candidate_id))
    notes.sort(key=lambda n: n.created_at)
    return [
        CandidateNoteView(
            id=note.id,
            candidate_id=note.candidate_id,
            author_email=note.author_email,
            author_name=note.author_name
            or (profiles.get(note.author_email) or {}).get("name")
            or note.author_email,
            body=note.body,
            job_id=note.job_id,
            created_at=note.created_at,
            mine=note.author_email == me,
        )
        for note in notes
    ]


@router.post("/candidates/{candidate_id}/notes", response_model=CandidateNoteView, status_code=201)
def add_candidate_note(
    candidate_id: uuid.UUID,
    payload: CandidateNoteRequest,
    store: AppStore,
    recruiter_email: RecruiterEmail,
):
    """Add a note. Writing needs collaborate access — a read-only share can
    see the thread but not add to it."""
    me = normalize_email(recruiter_email)
    can_read, can_collaborate = _candidate_access(store, candidate_id, me)
    if not can_read:
        raise NotFoundError("Candidate not found", {"candidate_id": str(candidate_id)})
    if not can_collaborate:
        raise ValidationAppError(
            "This candidate was shared with you read-only, so you cannot add notes.",
            {"candidate_id": str(candidate_id)},
        )

    body = (payload.body or "").strip()
    if not body:
        raise ValidationAppError("Write a note first.")
    if len(body) > 4000:
        raise ValidationAppError("Notes are limited to 4000 characters.")

    profiles = _profiles(store)
    note = CandidateNote(
        candidate_id=candidate_id,
        author_email=me,
        author_name=(profiles.get(me) or {}).get("name"),
        body=body,
        job_id=payload.job_id,
    )
    store.candidate_notes.save(note)
    return CandidateNoteView(
        id=note.id,
        candidate_id=note.candidate_id,
        author_email=note.author_email,
        author_name=note.author_name or me,
        body=note.body,
        job_id=note.job_id,
        created_at=note.created_at,
        mine=True,
    )
