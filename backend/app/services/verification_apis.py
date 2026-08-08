"""Real, keyless, free-tier verification API clients used by fraud_service.

- SanctionsScreeningService screens names against the US Treasury OFAC SDN
  (Specially Designated Nationals) list — the same source-of-truth list
  commercial KYC vendors screen against. No API key required; the list is
  published as a public CSV export.
- EmployerVerificationService checks whether a claimed employer resolves to
  a real registered company via Clearbit's free company Autocomplete API.

Both are "live" checks (real network calls to real third-party data), unlike
the heuristic checks in fraud_service.py which only look at internal
consistency of the data we already have.
"""

from __future__ import annotations

import csv
import io
import re
import time
from dataclasses import dataclass, field
from difflib import SequenceMatcher

import requests

from app.utils.logger import get_logger

logger = get_logger(__name__)

SDN_CSV_URL = "https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/SDN.CSV"
SDN_REFRESH_SECONDS = 24 * 60 * 60  # OFAC publishes updates ~hourly; daily refresh is plenty here
SDN_MATCH_THRESHOLD = 0.87

CLEARBIT_AUTOCOMPLETE_URL = "https://autocomplete.clearbit.com/v1/companies/suggest"

_SUFFIX_RE = re.compile(
    r"\b(inc|incorporated|llc|ltd|limited|corp|corporation|co|company|group|holdings|plc)\b\.?",
    re.I,
)
_NON_ALNUM_RE = re.compile(r"[^a-z0-9]+")


def _normalize(text: str) -> str:
    text = _SUFFIX_RE.sub("", text.lower())
    text = _NON_ALNUM_RE.sub(" ", text)
    return " ".join(text.split())


def _tokens(text: str) -> set[str]:
    return {t for t in _normalize(text).split(" ") if len(t) >= 3}


def _canonical(text: str) -> str:
    """Token-order-invariant form, so 'LAST, First' matches 'First Last'."""
    return " ".join(sorted(_normalize(text).split(" ")))


@dataclass
class SanctionsMatch:
    matched_name: str
    program: str
    score: float


class SanctionsScreeningService:
    """Fuzzy-matches candidate names against the live OFAC SDN individuals list."""

    def __init__(self) -> None:
        self._entries: list[tuple[str, str, str]] = []  # (canonical_name, raw_name, program)
        self._index: dict[str, list[int]] = {}
        self._loaded_at: float = 0.0
        self._load_error: str | None = None

    def _ensure_loaded(self) -> None:
        if self._entries and (time.time() - self._loaded_at) < SDN_REFRESH_SECONDS:
            return
        try:
            resp = requests.get(SDN_CSV_URL, timeout=15)
            resp.raise_for_status()
            reader = csv.reader(io.StringIO(resp.content.decode("latin-1")))
            entries: list[tuple[str, str, str]] = []
            index: dict[str, list[int]] = {}
            for row in reader:
                if len(row) < 4:
                    continue
                sdn_type = row[2].strip().lower()
                if sdn_type != "individual":
                    continue  # candidate names are people, not vessels/entities
                raw_name = row[1].strip().strip('"')
                if not raw_name:
                    continue
                program = row[3].strip()
                canonical = _canonical(raw_name)
                idx = len(entries)
                entries.append((canonical, raw_name, program))
                for tok in _tokens(raw_name):
                    index.setdefault(tok, []).append(idx)
            self._entries = entries
            self._index = index
            self._loaded_at = time.time()
            self._load_error = None
            logger.info("OFAC SDN list loaded: %d individual entries", len(entries))
        except Exception as exc:  # noqa: BLE001 - network/parsing failure is a soft-fail, not fatal
            self._load_error = str(exc)
            logger.warning("OFAC SDN list refresh failed, using stale/empty data: %s", exc)

    def screen_name(self, full_name: str) -> tuple[list[SanctionsMatch], str]:
        """Returns (matches, source) where source is 'live' or 'unavailable'."""
        self._ensure_loaded()
        if not self._entries:
            return [], "unavailable"

        query_canonical = _canonical(full_name)
        if not query_canonical:
            return [], "live"

        candidate_idxs: set[int] = set()
        for tok in _tokens(full_name):
            candidate_idxs.update(self._index.get(tok, []))

        matches: list[SanctionsMatch] = []
        for idx in candidate_idxs:
            canonical, raw_name, program = self._entries[idx]
            score = SequenceMatcher(None, query_canonical, canonical).ratio()
            if score >= SDN_MATCH_THRESHOLD:
                matches.append(SanctionsMatch(matched_name=raw_name, program=program, score=score))

        matches.sort(key=lambda m: m.score, reverse=True)
        return matches[:3], "live"


@dataclass
class EmployerVerification:
    query: str
    exists: bool
    matched_name: str | None
    domain: str | None
    source: str  # "live" or "unavailable"


class EmployerVerificationService:
    """Checks whether a claimed employer resolves to a real registered company."""

    def __init__(self) -> None:
        self._cache: dict[str, EmployerVerification] = {}

    def verify(self, company_name: str) -> EmployerVerification:
        key = company_name.strip().lower()
        if not key:
            return EmployerVerification(company_name, False, None, None, "unavailable")
        if key in self._cache:
            return self._cache[key]

        result = self._lookup(company_name)
        self._cache[key] = result
        return result

    def _lookup(self, company_name: str) -> EmployerVerification:
        try:
            resp = requests.get(
                CLEARBIT_AUTOCOMPLETE_URL,
                params={"query": company_name},
                timeout=5,
            )
            resp.raise_for_status()
            suggestions = resp.json()
        except Exception as exc:  # noqa: BLE001 - third-party outage shouldn't break screening
            logger.warning("Employer lookup failed for %r: %s", company_name, exc)
            return EmployerVerification(company_name, False, None, None, "unavailable")

        query_norm = _normalize(company_name)
        for suggestion in suggestions:
            name = suggestion.get("name") or ""
            if _normalize(name) == query_norm:
                return EmployerVerification(
                    company_name, True, name, suggestion.get("domain"), "live"
                )
        return EmployerVerification(company_name, False, None, None, "live")


sanctions_service = SanctionsScreeningService()
employer_service = EmployerVerificationService()
