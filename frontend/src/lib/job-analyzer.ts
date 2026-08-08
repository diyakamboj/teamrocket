export type RequirementCategory = "Skills" | "Experience" | "Education" | "Certifications";

export type ExtractedRequirement = {
  id: string;
  category: RequirementCategory;
  text: string;
  must: boolean;
};

export type JobAnalysisResult = {
  title: string;
  summary: string;
  requirements: ExtractedRequirement[];
  requiredSkills: string[];
  niceToHaveSkills: string[];
  requiredExperienceYears: number | null;
  education: string | null;
};

type RolePack = {
  id: string;
  match: RegExp;
  title: string;
  mustSkills: string[];
  niceSkills: string[];
  experience: string[];
  education: string[];
  certifications: string[];
  summary: string;
};

const ROLE_PACKS: RolePack[] = [
  {
    id: "plumber",
    match: /\bplumb(er|ing)\b|\bpipe\s*fitter\b|\bdrain\b|\bhvac\b.*plumb/i,
    title: "Plumber",
    mustSkills: [
      "Pipe installation & repair",
      "Drain cleaning & clog removal",
      "Fixture installation (sinks, toilets, water heaters)",
      "Blueprint / building-code reading",
      "Soldering & copper/PVC joining",
    ],
    niceSkills: ["Gas line work", "Backflow prevention", "Smart water systems"],
    experience: [
      "2+ years residential or commercial plumbing",
      "Diagnosing leaks and water-pressure issues on-site",
    ],
    education: ["High school diploma or trade-school plumbing program"],
    certifications: ["Journeyman / Master Plumber license", "EPA Section 608 (if applicable)"],
    summary:
      "This role focuses on hands-on plumbing trade skills, licensing, and on-site diagnostic experience — not software engineering.",
  },
  {
    id: "electrician",
    match: /\belectrician\b|\belectrical\s+(tech|work|wiring)\b|\bwiring\b.*circuit/i,
    title: "Electrician",
    mustSkills: [
      "Electrical wiring & circuit installation",
      "Panel / breaker troubleshooting",
      "Reading electrical schematics",
      "National Electrical Code (NEC) compliance",
      "Safe lockout/tagout procedures",
    ],
    niceSkills: ["PLC basics", "Solar / EV charger installs", "Low-voltage systems"],
    experience: ["2+ years residential or industrial electrical work"],
    education: ["Electrical apprenticeship or trade certification"],
    certifications: ["Journeyman Electrician license", "OSHA safety certification"],
    summary:
      "This role prioritizes licensed electrical trade skills, code compliance, and field troubleshooting experience.",
  },
  {
    id: "nurse",
    match: /\bnurse\b|\brn\b|\blvn\b|\bnursing\b|\bpatient\s+care\b/i,
    title: "Nurse",
    mustSkills: [
      "Patient assessment & vital monitoring",
      "Medication administration",
      "Electronic health records (EHR)",
      "Infection control protocols",
      "Care plan documentation",
    ],
    niceSkills: ["Telemetry", "IV therapy specialty", "Bilingual patient communication"],
    experience: ["1–3+ years clinical nursing experience"],
    education: ["ASN / BSN in Nursing"],
    certifications: ["Active RN or LVN license", "BLS / ACLS"],
    summary:
      "This clinical role emphasizes licensed patient care, medication safety, and EHR documentation — not engineering tools.",
  },
  {
    id: "teacher",
    match: /\bteacher\b|\binstructor\b|\beducator\b|\bclassroom\b|\bcurriculum\b/i,
    title: "Teacher",
    mustSkills: [
      "Lesson planning & curriculum delivery",
      "Classroom management",
      "Student assessment & grading",
      "Differentiated instruction",
      "Parent / guardian communication",
    ],
    niceSkills: ["EdTech tools (Google Classroom, Canvas)", "Special education inclusion"],
    experience: ["1+ years classroom teaching experience"],
    education: ["Bachelor's in Education or subject specialty"],
    certifications: ["State teaching credential / license"],
    summary:
      "This education role focuses on instruction, classroom leadership, and credentialed teaching practice.",
  },
  {
    id: "accountant",
    match: /\baccountant\b|\baccounting\b|\bbookkeep|\bcpa\b|\baudit(or|ing)\b/i,
    title: "Accountant",
    mustSkills: [
      "GAAP / financial reporting",
      "General ledger & reconciliations",
      "Accounts payable / receivable",
      "Excel / financial modeling",
      "Month-end close support",
    ],
    niceSkills: ["ERP systems (NetSuite, SAP)", "Tax preparation", "SOX controls"],
    experience: ["2+ years accounting experience"],
    education: ["Bachelor's in Accounting or Finance"],
    certifications: ["CPA (preferred)", "QuickBooks certification"],
    summary:
      "This finance role emphasizes accounting standards, ledgers, and close processes rather than software engineering stacks.",
  },
  {
    id: "chef",
    match: /\bchef\b|\bcook\b|\bculinary\b|\bkitchen\b|\bfood\s+prep/i,
    title: "Chef / Cook",
    mustSkills: [
      "Food preparation & plating",
      "Kitchen safety & sanitation (HACCP)",
      "Menu execution under volume",
      "Inventory / stock control",
      "Knife skills & station management",
    ],
    niceSkills: ["Menu development", "Allergy-aware cooking", "Catering operations"],
    experience: ["2+ years professional kitchen experience"],
    education: ["Culinary school or equivalent kitchen training"],
    certifications: ["Food Handler / ServSafe certification"],
    summary:
      "This culinary role centers on kitchen execution, food safety, and high-volume prep — not IT skills.",
  },
  {
    id: "driver",
    match: /\btruck\s*driver\b|\bcdl\b|\bdelivery\s+driver\b|\bchauffeur\b/i,
    title: "Driver",
    mustSkills: [
      "Safe commercial / delivery driving",
      "Route planning & navigation",
      "Vehicle inspection (pre/post trip)",
      "Cargo handling & documentation",
      "Customer delivery communication",
    ],
    niceSkills: ["ELD / fleet apps", "Hazmat endorsement", "Lift-gate operation"],
    experience: ["1+ years professional driving experience"],
    education: ["High school diploma or equivalent"],
    certifications: ["Valid driver's license / CDL", "Clean driving record"],
    summary:
      "This logistics role focuses on licensed driving, safety checks, and on-time delivery operations.",
  },
  {
    id: "data",
    match:
      /\bdata\s+engineer\b|\bdata\s+scientist\b|\banalytics\s+engineer\b|\bmachine\s+learning\b|\bml\s+engineer\b/i,
    title: "Data / ML Engineer",
    mustSkills: [
      "Python",
      "SQL",
      "ETL / data pipelines",
      "Cloud data platforms",
      "Statistics / modeling basics",
    ],
    niceSkills: ["Spark", "dbt", "Airflow", "PyTorch / TensorFlow"],
    experience: ["3+ years data engineering or applied ML experience"],
    education: ["Bachelor's in Computer Science, Statistics, or related field"],
    certifications: ["Cloud data certification (AWS/GCP/Azure) — nice to have"],
    summary:
      "This role emphasizes data pipelines, SQL, and analytical engineering rather than general plumbing or trade work.",
  },
  {
    id: "devops",
    match:
      /\bdevops\b|\bsre\b|\bsite\s+reliability\b|\bplatform\s+engineer\b|\binfrastructure\s+engineer\b/i,
    title: "DevOps / Platform Engineer",
    mustSkills: [
      "CI/CD",
      "Docker",
      "Kubernetes",
      "Cloud (AWS/Azure/GCP)",
      "Infrastructure as Code",
    ],
    niceSkills: ["Terraform", "Observability (Prometheus/Grafana)", "Linux administration"],
    experience: ["3+ years DevOps or platform engineering"],
    education: ["Bachelor's in Computer Science or equivalent experience"],
    certifications: ["CKA / cloud architect cert — nice to have"],
    summary:
      "This platform role centers on cloud infrastructure, containers, and reliability automation.",
  },
  {
    id: "frontend",
    match:
      /\bfrontend\b|\bfront-end\b|\breact\s+developer\b|\bui\s+engineer\b|\bweb\s+developer\b/i,
    title: "Frontend Engineer",
    mustSkills: [
      "JavaScript / TypeScript",
      "React",
      "HTML/CSS",
      "Responsive UI",
      "REST / GraphQL APIs",
    ],
    niceSkills: ["Next.js", "Design systems", "Accessibility (WCAG)", "Playwright / Cypress"],
    experience: ["2+ years frontend engineering"],
    education: ["Bachelor's in Computer Science or equivalent experience"],
    certifications: [],
    summary:
      "This role focuses on modern web UI engineering with JavaScript/TypeScript and component frameworks.",
  },
  {
    id: "software",
    match:
      /\bsoftware\s+engineer\b|\bbackend\b|\bfull[\s-]?stack\b|\bdeveloper\b|\bprogrammer\b|\b swe\b/i,
    title: "Software Engineer",
    mustSkills: [
      "Python or Java or TypeScript",
      "APIs / REST",
      "SQL / databases",
      "Git / code review",
      "Unit testing",
    ],
    niceSkills: ["Docker", "Cloud (AWS/Azure/GCP)", "Kubernetes", "System design"],
    experience: ["3+ years professional software engineering"],
    education: ["Bachelor's in Computer Science or equivalent experience"],
    certifications: ["Cloud fundamentals certification — nice to have"],
    summary:
      "This software engineering role emphasizes coding, APIs, databases, and shipping production systems.",
  },
];

const SKILL_ALIASES: Array<{ pattern: RegExp; skill: string }> = [
  { pattern: /\bpython\b/i, skill: "Python" },
  { pattern: /\bjava\b(?!script)/i, skill: "Java" },
  { pattern: /\btypescript\b|\bts\b/i, skill: "TypeScript" },
  { pattern: /\bjavascript\b|\bjs\b/i, skill: "JavaScript" },
  { pattern: /\breact\b/i, skill: "React" },
  { pattern: /\bnode\.?js\b/i, skill: "Node.js" },
  { pattern: /\bsql\b|\bpostgres\b|\bmysql\b/i, skill: "SQL" },
  { pattern: /\bdocker\b/i, skill: "Docker" },
  { pattern: /\bkubernetes\b|\bk8s\b/i, skill: "Kubernetes" },
  { pattern: /\baws\b|amazon web services/i, skill: "AWS" },
  { pattern: /\bazure\b/i, skill: "Azure" },
  { pattern: /\bgcp\b|google cloud/i, skill: "GCP" },
  { pattern: /\bterraform\b/i, skill: "Terraform" },
  { pattern: /\bfastapi\b/i, skill: "FastAPI" },
  { pattern: /\bpvc\b|\bcopper\s*pipe\b|\bpipe\s*fitting\b/i, skill: "Pipe fitting (PVC/copper)" },
  { pattern: /\bwater\s*heater\b/i, skill: "Water heater installation" },
  { pattern: /\bdrain\b/i, skill: "Drain cleaning" },
  { pattern: /\bsoldering\b/i, skill: "Soldering" },
  { pattern: /\bbackflow\b/i, skill: "Backflow prevention" },
  { pattern: /\bcdl\b/i, skill: "CDL" },
  { pattern: /\bservsafe\b|\bfood\s*handler\b/i, skill: "Food safety certification" },
  { pattern: /\behr\b|\bepic\b|\bcerner\b/i, skill: "EHR systems" },
  { pattern: /\bgaps\b|\breconciliation\b/i, skill: "Financial reconciliations" },
];

function detectRole(text: string): RolePack {
  for (const pack of ROLE_PACKS) {
    if (pack.match.test(text)) return pack;
  }
  return ROLE_PACKS.find((p) => p.id === "software")!;
}

function extractYears(text: string): number | null {
  const patterns = [
    /(\d+)\s*\+?\s*years?/i,
    /minimum\s+of\s+(\d+)\s+years?/i,
    /(\d+)\s*-\s*(\d+)\s*years?/i,
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m?.[1]) return Number(m[1]);
  }
  return null;
}

function extractMentionedSkills(text: string): string[] {
  const found: string[] = [];
  for (const alias of SKILL_ALIASES) {
    if (alias.pattern.test(text) && !found.includes(alias.skill)) {
      found.push(alias.skill);
    }
  }
  return found;
}

function uid(prefix: string, i: number) {
  return `${prefix}-${i}-${Math.random().toString(36).slice(2, 7)}`;
}

export function analyzeJobDescription(raw: string): JobAnalysisResult {
  const text = raw.trim();
  const role = detectRole(text);
  const years = extractYears(text);
  const mentioned = extractMentionedSkills(text);

  // Prefer skills explicitly present in the JD; fill from role pack otherwise
  const mustSkills =
    mentioned.length >= 2
      ? [...mentioned.slice(0, 6)]
      : unique([...mentioned, ...role.mustSkills]).slice(0, 6);

  const niceSkills = role.niceSkills.filter(
    (s) => !mustSkills.some((m) => m.toLowerCase() === s.toLowerCase()),
  );

  const experienceLines =
    years != null
      ? [
          `${years}+ years relevant ${role.title.toLowerCase()} experience`,
          ...role.experience.slice(1),
        ]
      : role.experience;

  const requirements: ExtractedRequirement[] = [];
  let i = 0;
  for (const skill of mustSkills) {
    requirements.push({
      id: uid("sk", i++),
      category: "Skills",
      text: skill,
      must: true,
    });
  }
  for (const skill of niceSkills.slice(0, 3)) {
    requirements.push({
      id: uid("sk", i++),
      category: "Skills",
      text: skill,
      must: false,
    });
  }
  experienceLines.forEach((line, idx) => {
    requirements.push({
      id: uid("ex", i++),
      category: "Experience",
      text: line,
      must: idx === 0,
    });
  });
  role.education.forEach((line, idx) => {
    requirements.push({
      id: uid("ed", i++),
      category: "Education",
      text: line,
      must: idx === 0,
    });
  });
  role.certifications.forEach((line) => {
    requirements.push({
      id: uid("ce", i++),
      category: "Certifications",
      text: line,
      must: /license|licensed|active rn|cdl|journeyman|master/i.test(line),
    });
  });

  return {
    title: role.title,
    summary: role.summary,
    requirements,
    requiredSkills: mustSkills,
    niceToHaveSkills: niceSkills,
    requiredExperienceYears: years,
    education: role.education[0] ?? null,
  };
}

function unique(items: string[]) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}
