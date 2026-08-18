"""Role-aware job-description heuristics used when LLM extraction is mocked/unavailable."""

from __future__ import annotations

import re
from typing import Any


ROLE_PACKS: list[dict[str, Any]] = [
    {
        "id": "plumber",
        "match": re.compile(r"\bplumb(er|ing)\b|\bpipe\s*fitter\b", re.I),
        "title": "Plumber",
        "must": [
            "Pipe installation & repair",
            "Drain cleaning & clog removal",
            "Fixture installation (sinks, toilets, water heaters)",
            "Blueprint / building-code reading",
            "Soldering & copper/PVC joining",
        ],
        "nice": ["Gas line work", "Backflow prevention"],
        "years": 2,
        "education": "Trade-school plumbing program or apprenticeship",
        "summary": "Plumbing trade role focused on installation, diagnostics, and licensing.",
    },
    {
        "id": "electrician",
        "match": re.compile(r"\belectrician\b|\belectrical\s+(tech|wiring)\b", re.I),
        "title": "Electrician",
        "must": [
            "Electrical wiring & circuit installation",
            "Panel / breaker troubleshooting",
            "Reading electrical schematics",
            "NEC code compliance",
        ],
        "nice": ["Solar / EV charger installs", "PLC basics"],
        "years": 2,
        "education": "Electrical apprenticeship or trade certification",
        "summary": "Licensed electrical trade role focused on wiring, code, and field troubleshooting.",
    },
    {
        "id": "nurse",
        "match": re.compile(r"\bnurse\b|\brn\b|\bnursing\b", re.I),
        "title": "Nurse",
        "must": [
            "Patient assessment & vital monitoring",
            "Medication administration",
            "Electronic health records (EHR)",
            "Infection control protocols",
        ],
        "nice": ["Telemetry", "IV therapy specialty"],
        "years": 1,
        "education": "ASN / BSN in Nursing",
        "summary": "Clinical nursing role emphasizing licensed patient care and documentation.",
    },
    {
        "id": "accountant",
        "match": re.compile(r"\baccountant\b|\baccounting\b|\bcpa\b", re.I),
        "title": "Accountant",
        "must": [
            "GAAP / financial reporting",
            "General ledger & reconciliations",
            "Excel / financial modeling",
            "Month-end close support",
        ],
        "nice": ["ERP systems", "Tax preparation"],
        "years": 2,
        "education": "Bachelor's in Accounting or Finance",
        "summary": "Accounting role focused on ledgers, reporting, and close processes.",
    },
    {
        "id": "chef",
        "match": re.compile(r"\bchef\b|\bcook\b|\bculinary\b", re.I),
        "title": "Chef / Cook",
        "must": [
            "Food preparation & plating",
            "Kitchen safety & sanitation",
            "Menu execution under volume",
            "Inventory / stock control",
        ],
        "nice": ["Menu development", "Catering operations"],
        "years": 2,
        "education": "Culinary school or equivalent kitchen training",
        "summary": "Culinary role centered on kitchen execution and food safety.",
    },
    {
        "id": "driver",
        "match": re.compile(r"\btruck\s*driver\b|\bcdl\b|\bdelivery\s+driver\b", re.I),
        "title": "Driver",
        "must": [
            "Safe commercial / delivery driving",
            "Route planning & navigation",
            "Vehicle inspection",
            "Cargo handling & documentation",
        ],
        "nice": ["ELD / fleet apps", "Hazmat endorsement"],
        "years": 1,
        "education": "High school diploma or equivalent",
        "summary": "Driving/logistics role focused on licensed operation and on-time delivery.",
    },
    {
        "id": "data",
        "match": re.compile(
            r"\bdata\s+engineer\b|\bdata\s+scientist\b|\bmachine\s+learning\b|\bml\s+engineer\b",
            re.I,
        ),
        "title": "Data / ML Engineer",
        "must": ["Python", "SQL", "ETL / data pipelines", "Cloud data platforms"],
        "nice": ["Spark", "Airflow", "dbt"],
        "years": 3,
        "education": "Bachelor's in Computer Science, Statistics, or related field",
        "summary": "Data role emphasizing pipelines, SQL, and analytical engineering.",
    },
    {
        "id": "software",
        "match": re.compile(
            r"\bsoftware\s+engineer\b|\bbackend\b|\bfull[\s-]?stack\b|\bdeveloper\b|\bprogrammer\b",
            re.I,
        ),
        "title": "Software Engineer",
        "must": ["Python or Java or TypeScript", "APIs / REST", "SQL / databases", "Git / code review"],
        "nice": ["Docker", "Cloud (AWS/Azure/GCP)", "Kubernetes"],
        "years": 3,
        "education": "Bachelor's in Computer Science or equivalent experience",
        "summary": "Software engineering role emphasizing coding, APIs, and production delivery.",
    },
]

SKILL_ALIASES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bpython\b", re.I), "Python"),
    (re.compile(r"\bjava\b(?!script)", re.I), "Java"),
    (re.compile(r"\btypescript\b", re.I), "TypeScript"),
    (re.compile(r"\breact\b", re.I), "React"),
    (re.compile(r"\bsql\b|\bpostgres\b", re.I), "SQL"),
    (re.compile(r"\bdocker\b", re.I), "Docker"),
    (re.compile(r"\bkubernetes\b|\bk8s\b", re.I), "Kubernetes"),
    (re.compile(r"\baws\b", re.I), "AWS"),
    (re.compile(r"\bazure\b", re.I), "Azure"),
    (re.compile(r"\bfastapi\b", re.I), "FastAPI"),
    (re.compile(r"\bterraform\b", re.I), "Terraform"),
    (re.compile(r"\bpvc\b|\bcopper\s*pipe\b|\bpipe\s*fitting\b", re.I), "Pipe fitting (PVC/copper)"),
    (re.compile(r"\bwater\s*heater\b", re.I), "Water heater installation"),
    (re.compile(r"\bdrain\b", re.I), "Drain cleaning"),
    (re.compile(r"\bsoldering\b", re.I), "Soldering"),
    (re.compile(r"\bcdl\b", re.I), "CDL"),
]


def _detect_role(text: str) -> dict[str, Any]:
    for pack in ROLE_PACKS:
        if pack["match"].search(text):
            return pack
    return next(p for p in ROLE_PACKS if p["id"] == "software")


def _extract_years(text: str) -> int | None:
    m = re.search(r"(\d+)\s*\+?\s*years?", text, re.I)
    if m:
        return int(m.group(1))
    return None


def _mentioned_skills(text: str) -> list[str]:
    found: list[str] = []
    for pattern, skill in SKILL_ALIASES:
        if pattern.search(text) and skill not in found:
            found.append(skill)
    return found


def analyze_job_text(title: str, description: str) -> dict[str, Any]:
    text = f"{title}\n{description}".strip()
    role = _detect_role(text)
    years = _extract_years(text)
    mentioned = _mentioned_skills(text)

    if len(mentioned) >= 2:
        required = mentioned[:6]
    else:
        required = list(dict.fromkeys([*mentioned, *role["must"]]))[:6]

    nice = [s for s in role["nice"] if s.lower() not in {x.lower() for x in required}]

    return {
        "title": role["title"],
        "required_skills": required,
        "nice_to_have_skills": nice,
        "required_experience_years": years if years is not None else role["years"],
        "education_requirements": role["education"],
        "summary": role["summary"],
    }
