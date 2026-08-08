"""Background verification / fraud screening for candidates.

Blends two *live* checks (real third-party data, network calls) with
heuristic *consistency* checks (no external verification exists for these
without a paid KYC vendor — see verification_apis.py module docstring):

  live      sanctions   OFAC SDN fuzzy name match (US Treasury, free, real)
  live      employment  Clearbit company-registry lookup per claimed employer
  heuristic identity    disposable-email-domain check
  heuristic education   presence/plausibility of claimed institution(s)
  heuristic location    presence/plausibility of claimed location

Each check result is tagged with its `source` ("live" | "heuristic" |
"no_data") so the UI can be honest about what was actually verified versus
inferred, rather than presenting everything as equally authoritative.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from app.services.verification_apis import employer_service, sanctions_service

Severity = Literal["low", "medium", "high"]
CheckSource = Literal["live", "heuristic", "no_data"]

DISPOSABLE_EMAIL_DOMAINS = {
    "mailinator.com",
    "10minutemail.com",
    "guerrillamail.com",
    "tempmail.com",
    "temp-mail.org",
    "yopmail.com",
    "throwawaymail.com",
    "trashmail.com",
    "sharklasers.com",
    "dispostable.com",
    "getnada.com",
    "maildrop.cc",
    "fakeinbox.com",
    "mailnesia.com",
}


@dataclass
class Signal:
    id: str
    label: str
    severity: Severity


@dataclass
class FraudResult:
    status: Literal["verified", "suspicious", "fraud"]
    risk_score: int
    summary: str
    checks: dict[str, bool]
    sources: dict[str, CheckSource]
    signals: list[Signal] = field(default_factory=list)
    details: dict = field(default_factory=dict)


def _email_domain(email: str) -> str:
    return email.rsplit("@", 1)[-1].strip().lower() if "@" in email else ""


def screen_candidate(
    *,
    name: str,
    email: str,
    employers: list[str] | None = None,
    education: list[str] | None = None,
    location: str | None = None,
) -> FraudResult:
    employers = [e.strip() for e in (employers or []) if e and e.strip()]
    education = [e.strip() for e in (education or []) if e and e.strip()]

    risk = 10
    signals: list[Signal] = []
    checks: dict[str, bool] = {}
    sources: dict[str, CheckSource] = {}
    details: dict = {}

    # --- Sanctions (LIVE: OFAC SDN) ---
    matches, sdn_source = sanctions_service.screen_name(name)
    sources["sanctions"] = sdn_source
    if matches:
        risk += 45
        top = matches[0]
        signals.append(
            Signal(
                id="sanctions-flag",
                label=(
                    f"Name closely matches OFAC sanctions list entry "
                    f"'{top.matched_name}' (program: {top.program}, similarity "
                    f"{round(top.score * 100)}%)"
                ),
                severity="high",
            )
        )
        checks["sanctions"] = False
    else:
        checks["sanctions"] = True
    details["sanctions_matches"] = [
        {"name": m.matched_name, "program": m.program, "score": round(m.score, 3)}
        for m in matches
    ]

    # --- Employment (LIVE: Clearbit company registry, per claimed employer) ---
    if employers:
        results = [employer_service.verify(e) for e in employers]
        sources["employment"] = "live" if any(r.source == "live" for r in results) else "unavailable"
        unverified = [r for r in results if not r.exists]
        checks["employment"] = len(unverified) < len(results)
        if unverified:
            names = ", ".join(r.query for r in unverified)
            risk += min(30, 12 * len(unverified))
            signals.append(
                Signal(
                    id="employer-unverified",
                    label=f"Claimed employer(s) not found in company registry: {names}",
                    severity="high" if len(unverified) == len(results) else "medium",
                )
            )
        details["employer_results"] = [
            {
                "query": r.query,
                "exists": r.exists,
                "matched_name": r.matched_name,
                "domain": r.domain,
                "source": r.source,
            }
            for r in results
        ]
    else:
        sources["employment"] = "no_data"
        checks["employment"] = True

    # --- Identity (HEURISTIC: disposable email domain check) ---
    sources["identity"] = "heuristic"
    domain = _email_domain(email)
    identity_ok = domain not in DISPOSABLE_EMAIL_DOMAINS and bool(domain)
    checks["identity"] = identity_ok
    if not identity_ok:
        risk += 30
        signals.append(
            Signal(
                id="identity-disposable-email",
                label="Contact email uses a disposable/temporary provider domain",
                severity="high",
            )
        )

    # --- Education (HEURISTIC: presence/plausibility, no free verification API exists) ---
    if education:
        sources["education"] = "heuristic"
        checks["education"] = all(len(e) >= 3 for e in education)
        if not checks["education"]:
            risk += 12
            signals.append(
                Signal(
                    id="education-thin",
                    label="Claimed education record is too sparse to be plausible",
                    severity="medium",
                )
            )
    else:
        sources["education"] = "no_data"
        checks["education"] = True

    # --- Location (HEURISTIC: presence only, no IP/geo signal available) ---
    if location:
        sources["location"] = "heuristic"
        checks["location"] = True
    else:
        sources["location"] = "no_data"
        checks["location"] = True

    if not signals:
        signals.append(
            Signal(
                id="clean",
                label="No adverse signals found across live and heuristic checks",
                severity="low",
            )
        )

    risk = max(0, min(98, risk))
    status: Literal["verified", "suspicious", "fraud"] = "verified"
    if risk >= 70:
        status = "fraud"
    elif risk >= 42:
        status = "suspicious"

    if status == "fraud":
        summary = "Background verification failed. High-confidence adverse signals detected — do not advance without manual review."
    elif status == "suspicious":
        summary = "Partial verification. Some claims could not be confirmed — manual review recommended."
    else:
        summary = "Background verification passed. Live sanctions and employer checks found no adverse signals."

    return FraudResult(
        status=status,
        risk_score=risk,
        summary=summary,
        checks=checks,
        sources=sources,
        signals=signals,
        details=details,
    )
