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
        "id": "cto",
        "match": re.compile(
            r"\bcto\b|\bchief\s+technology\s+officer\b|\bvp\s+of\s+engineering\b|\bhead\s+of\s+engineering\b|\bengineering\s+director\b",
            re.I,
        ),
        "title": "Chief Technology Officer / VP of Engineering",
        "must": ["Technology Strategy & Roadmap", "Engineering Leadership", "System Architecture", "Strategic Planning"],
        "nice": ["Executive Presence", "Budget & Resource Allocation", "Cross-functional Collaboration", "Talent Acquisition & Mentorship", "Stakeholder Management"],
        "years": 8,
        "education": "Master's or Bachelor's in CS / Engineering or equivalent executive experience",
        "summary": "Executive technology role focusing on technical vision, leadership, and organization scaling.",
    },
    {
        "id": "software",
        "match": re.compile(
            r"\bsoftware\s+engineer\b|\bbackend\b|\bfull[\s-]?stack\b|\bdeveloper\b|\bprogrammer\b",
            re.I,
        ),
        "title": "Software Engineer",
        "must": ["Python or Java or TypeScript", "APIs / REST", "SQL / databases", "Git / code review"],
        "nice": ["Docker", "Cloud (AWS/Azure/GCP)", "Kubernetes", "Problem Solving", "Team Collaboration"],
        "years": 3,
        "education": "Bachelor's in Computer Science or equivalent experience",
        "summary": "Software engineering role emphasizing coding, APIs, and production delivery.",
    },
]

SKILL_ALIASES: list[tuple[re.Pattern[str], str]] = [
    (re.compile(r"\bpython\b", re.I), "Python"),
    (re.compile(r"\bjava\b(?!script)", re.I), "Java"),
    (re.compile(r"\bjavascript\b|\bjs\b", re.I), "JavaScript"),
    (re.compile(r"\btypescript\b|\bts\b", re.I), "TypeScript"),
    (re.compile(r"\breact\b|\breactjs\b", re.I), "React"),
    (re.compile(r"\bnext\.?js\b", re.I), "Next.js"),
    (re.compile(r"\bvue\b|\bvuejs\b", re.I), "Vue.js"),
    (re.compile(r"\bangular\b", re.I), "Angular"),
    (re.compile(r"\bnode\.?js\b|\bnode\b", re.I), "Node.js"),
    (re.compile(r"\bfastapi\b", re.I), "FastAPI"),
    (re.compile(r"\bdjango\b", re.I), "Django"),
    (re.compile(r"\bflask\b", re.I), "Flask"),
    (re.compile(r"\bspring\s*boot\b|\bspring\b", re.I), "Spring Boot"),
    (re.compile(r"\bexpress\.?js\b|\bexpress\b", re.I), "Express.js"),
    (re.compile(r"\bgraphql\b", re.I), "GraphQL"),
    (re.compile(r"\brest\b|\brestful\b|\bapis?\b", re.I), "REST APIs"),
    (re.compile(r"\bsql\b|\bpostgresql\b|\bpostgres\b", re.I), "PostgreSQL / SQL"),
    (re.compile(r"\bmysql\b", re.I), "MySQL"),
    (re.compile(r"\bmongodb\b|\bmongo\b", re.I), "MongoDB"),
    (re.compile(r"\bredis\b", re.I), "Redis"),
    (re.compile(r"\bkafka\b", re.I), "Apache Kafka"),
    (re.compile(r"\bdocker\b", re.I), "Docker"),
    (re.compile(r"\bkubernetes\b|\bk8s\b", re.I), "Kubernetes"),
    (re.compile(r"\bterraform\b", re.I), "Terraform"),
    (re.compile(r"\bci/cd\b|\bjenkins\b|\bgithub\s*actions\b", re.I), "CI/CD"),
    (re.compile(r"\baws\b|\bamazon\s*web\s*services\b", re.I), "AWS"),
    (re.compile(r"\bazure\b", re.I), "Azure"),
    (re.compile(r"\bgcp\b|\bgoogle\s*cloud\b", re.I), "GCP"),
    (re.compile(r"\blinux\b", re.I), "Linux"),
    (re.compile(r"\bgit\b", re.I), "Git"),
    (re.compile(r"\bmicroservices\b", re.I), "Microservices"),
    (re.compile(r"\bsystem\s*design\b|\barchitecture\b", re.I), "System Architecture"),
    (re.compile(r"\bmachine\s*learning\b|\bml\b", re.I), "Machine Learning"),
    (re.compile(r"\bpytorch\b", re.I), "PyTorch"),
    (re.compile(r"\btensorflow\b", re.I), "TensorFlow"),
    (re.compile(r"\bpandas\b", re.I), "Pandas"),
    (re.compile(r"\bspark\b", re.I), "Apache Spark"),
    (re.compile(r"\bairflow\b", re.I), "Apache Airflow"),
    (re.compile(r"\bdbt\b", re.I), "dbt"),
    (re.compile(r"\bc\+\+\b", re.I), "C++"),
    (re.compile(r"\bc#\b|\b\.net\b", re.I), ".NET / C#"),
    (re.compile(r"\bgo\b|\bgolang\b", re.I), "Go"),
    (re.compile(r"\brust\b", re.I), "Rust"),
    (re.compile(r"\bruby\b|\brails\b", re.I), "Ruby on Rails"),
    (re.compile(r"\bphp\b", re.I), "PHP"),
    (re.compile(r"\bswift\b", re.I), "Swift"),
    (re.compile(r"\bkotlin\b", re.I), "Kotlin"),

    # Soft Skills & Leadership Qualities
    (re.compile(r"\bleadership\b|\blead\s+teams?\b", re.I), "Leadership"),
    (re.compile(r"\bteam\s+management\b|\bmanage\s+engineers?\b|\bpeople\s+management\b", re.I), "Team Management"),
    (re.compile(r"\bstrategic\s+planning\b|\bstrategy\b|\broadmap\b", re.I), "Strategic Planning"),
    (re.compile(r"\bexecutive\s+presence\b|\bexecutive\b|\bboard\b", re.I), "Executive Presence"),
    (re.compile(r"\bcommunication\b|\bwritten\s+and\s+verbal\b", re.I), "Communication"),
    (re.compile(r"\bmentorship\b|\bmentor\b|\bcoaching\b", re.I), "Mentorship"),
    (re.compile(r"\bcross[\s-]?functional\b|\bcollaboration\b", re.I), "Cross-functional Collaboration"),
    (re.compile(r"\bstakeholder\b", re.I), "Stakeholder Management"),
    (re.compile(r"\bproduct\s+strategy\b|\bvision\b", re.I), "Product Strategy"),
    (re.compile(r"\bagile\b|\bscrum\b", re.I), "Agile / Scrum"),
    (re.compile(r"\bproblem\s*solving\b|\banalytical\b", re.I), "Problem Solving"),
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

    # Extract all mentioned skills from text or fallback to role defaults
    combined = list(dict.fromkeys([*mentioned, *role["must"]]))
    required = combined[:8]
    nice = [s for s in [*role["nice"], *combined[8:]] if s.lower() not in {x.lower() for x in required}]

    return {
        "title": role["title"],
        "required_skills": required,
        "nice_to_have_skills": nice[:6],
        "required_experience_years": years if years is not None else role["years"],
        "education_requirements": role["education"],
        "summary": f"Extracted {len(required)} mandatory skills and {len(nice[:6])} preferred skills tailored to '{title or role['title']}'.",
    }

