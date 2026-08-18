"""Sortable id generation for append-only / order-sensitive blob keys.

Replaces the SQLAlchemy `_utcnow()` Python-side-default ordering trick used
today for tables like CandidateHistoryEvent, where multiple rows written in
one commit must still sort chronologically. A timestamp-prefixed key gives
natural lexicographic == chronological ordering when listing a blob prefix;
the random suffix guarantees uniqueness even for two ids minted within the
same microsecond.
"""

from __future__ import annotations

import secrets
from datetime import datetime, timezone


def new_sortable_id() -> str:
    """Return a lexicographically sortable, (practically) unique id string.

    Format: `{utc timestamp, microsecond precision}-{random hex suffix}`,
    e.g. `20260814123456789012-a1b2c3d4e5f6`. Sorting these as plain strings
    sorts them chronologically.
    """
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S%f")
    suffix = secrets.token_hex(6)
    return f"{timestamp}-{suffix}"
