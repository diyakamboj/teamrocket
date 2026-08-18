export type Candidate = {
  id: string;
  rank: number;
  name: string;
  initials: string;
  email: string;
  phone: string;
  title: string;
  location: string;
  years: number;
  level: "Junior" | "Mid" | "Senior" | "Lead";
  education: string;
  score: number;
  categories: {
    skills: number;
    experience: number;
    education: number;
    certifications: number;
    projects: number;
  };
  skills: string[];
  strengths: string[];
  gaps: string[];
  transferable: string[];
  evidence: { skill: string; detail: string; source: string }[];
  /** Frontend-only synthetic classification — no backend field backs this. */
  origin: "internal" | "external";
};

const FIRST = [
  "Amara",
  "Priya",
  "Diego",
  "Lena",
  "Noah",
  "Yusuf",
  "Mei",
  "Tomas",
  "Ines",
  "Kofi",
  "Sofia",
  "Elias",
  "Nadia",
  "Ravi",
  "Clara",
  "Marek",
  "Aisha",
  "Jonas",
  "Leila",
  "Hugo",
  "Zara",
  "Otto",
  "Maya",
  "Idris",
];
const LAST = [
  "Okonkwo",
  "Sharma",
  "Ferreira",
  "Bergman",
  "Whitfield",
  "Demir",
  "Tanaka",
  "Novak",
  "Rivera",
  "Mensah",
  "Castellano",
  "Vogel",
  "Haddad",
  "Iyer",
  "Lindqvist",
  "Kowalski",
  "Diallo",
  "Weber",
  "Barakat",
  "Almeida",
];
const TITLES = [
  "Backend Engineer",
  "Data Engineer",
  "ML Engineer",
  "Cloud Architect",
  "Full-Stack Engineer",
  "DevOps Engineer",
  "Platform Engineer",
  "Analytics Engineer",
  "Site Reliability Engineer",
];
const CITIES = [
  "Berlin",
  "Lisbon",
  "Toronto",
  "Austin",
  "Bengaluru",
  "Nairobi",
  "Amsterdam",
  "Warsaw",
  "Dublin",
];
const SKILLS = [
  "Python",
  "TypeScript",
  "AWS",
  "Azure",
  "Kubernetes",
  "SQL",
  "React",
  "Terraform",
  "Docker",
  "Spark",
  "Go",
  "PyTorch",
  "GraphQL",
  "Airflow",
  "Postgres",
  "CI/CD",
  "Rust",
  "Kafka",
];
const DEGREES = [
  "BSc Computer Science",
  "MSc Software Engineering",
  "BEng Information Systems",
  "MSc Data Science",
  "BSc Mathematics",
  "PhD Machine Learning",
];
const SOURCES = [
  "SWE Internship",
  "Platform Team @ Northwind",
  "Freelance Project",
  "Open-source contribution",
  "Capstone Thesis",
  "Lead role @ Larkspur",
];

function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function build(): Candidate[] {
  const rnd = mulberry(20260801);
  const pick = <T>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;
  const between = (a: number, b: number) => Math.round(a + rnd() * (b - a));

  const list: Candidate[] = [];
  for (let i = 0; i < 248; i++) {
    const first = pick(FIRST);
    const last = pick(LAST);
    const name = `${first} ${last}`;
    const years = between(1, 16);
    const level = years < 3 ? "Junior" : years < 7 ? "Mid" : years < 12 ? "Senior" : "Lead";
    const categories = {
      skills: between(38, 99),
      experience: between(35, 98),
      education: between(40, 99),
      certifications: between(20, 97),
      projects: between(30, 99),
    };
    const skills = Array.from(new Set(Array.from({ length: between(4, 8) }, () => pick(SKILLS))));
    list.push({
      id: `c-${i + 1}`,
      rank: 0,
      name,
      initials: `${first[0]}${last[0]}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@mail.com`,
      phone: `+1 (555) ${String(between(100, 999))}-${String(between(1000, 9999))}`,
      title: pick(TITLES),
      location: pick(CITIES),
      years,
      level,
      education: pick(DEGREES),
      score: 0,
      categories,
      skills,
      strengths: [
        `${between(3, years)} years shipping ${skills[0]} services in production`,
        `Owned ${pick(["migration", "observability", "cost reduction", "API redesign"])} initiative end-to-end`,
      ],
      gaps: [
        `Limited exposure to ${pick(SKILLS)}`,
        `No ${pick(["certification", "formal leadership", "regulated-industry"])} evidence found`,
      ],
      transferable: [
        `${pick(SKILLS)} experience maps closely to the required stack`,
        `Mentoring history suggests readiness for ${level === "Lead" ? "staff" : "senior"} scope`,
      ],
      evidence: skills.slice(0, 4).map((s) => ({
        skill: s,
        detail: pick([
          "Built automation scripts",
          "Led service migration",
          "Designed data pipeline",
          "Reduced p95 latency by 40%",
          "Authored internal library",
        ]),
        source: pick(SOURCES),
      })),
      // Deterministic (seeded by the same rnd() as the rest of this record) —
      // roughly a fifth of the pool are internal transfers/referrals.
      origin: rnd() < 0.24 ? "internal" : "external",
    });
  }
  return list;
}

/**
 * Controlled Backend Engineer shortlist for the product demo.
 * Ranked high → low: Alice (hire), Priya (internal interview), Bob (reject).
 */
const DEMO_WORKFLOW_CANDIDATES: Candidate[] = [
  {
    id: "demo-alice",
    rank: 0,
    name: "Alice Johnson",
    initials: "AJ",
    email: "alice.johnson@example.com",
    phone: "+1 (555) 010-1001",
    title: "Senior Backend Engineer",
    location: "Berlin",
    years: 6,
    level: "Senior",
    education: "BSc Computer Science, TU Berlin",
    score: 0,
    categories: { skills: 96, experience: 92, education: 88, certifications: 84, projects: 90 },
    skills: ["Python", "FastAPI", "SQL", "Azure", "Docker", "Kubernetes"],
    strengths: [
      "6 years shipping Python/FastAPI services on Azure",
      "Production ownership of APIs, SQL, and container deploys",
    ],
    gaps: ["Limited public speaking / conference evidence"],
    transferable: ["Kubernetes work transfers directly to the nice-to-have cloud bar"],
    evidence: [
      {
        skill: "Python",
        detail: "Owned FastAPI payments API serving 2M requests/day",
        source: "Platform Team @ Northwind Cloud",
      },
      {
        skill: "Azure",
        detail: "Designed Azure SQL + Functions ingestion pipeline",
        source: "Lead role @ Northwind Cloud",
      },
      {
        skill: "Docker",
        detail: "Containerized services and CI/CD to AKS",
        source: "Platform Team @ Northwind Cloud",
      },
    ],
    origin: "external",
  },
  {
    id: "demo-priya",
    rank: 0,
    name: "Priya Sharma",
    initials: "PS",
    email: "priya.sharma@example.com",
    phone: "+1 (555) 010-1002",
    title: "Cloud Platform Engineer",
    location: "Berlin",
    years: 5,
    level: "Senior",
    education: "MSc Software Engineering",
    score: 0,
    categories: { skills: 84, experience: 80, education: 86, certifications: 90, projects: 78 },
    skills: ["Python", "Azure", "Kubernetes", "Terraform", "Docker", "SQL"],
    strengths: [
      "Internal Azure/Kubernetes platform owner",
      "Strong certifications and infrastructure-as-code evidence",
    ],
    gaps: ["Limited FastAPI / product-API ownership compared with Alice"],
    transferable: ["Internal knowledge of our Azure landing zone"],
    evidence: [
      {
        skill: "Azure",
        detail: "Ran the shared AKS landing zone for 14 teams",
        source: "Infrastructure @ ResumeIQ (internal)",
      },
      {
        skill: "Kubernetes",
        detail: "Reduced cluster cost 22% with Terraform + HPA",
        source: "Platform Team @ ResumeIQ",
      },
      {
        skill: "Python",
        detail: "Wrote internal tooling services, not customer APIs",
        source: "Internal tools @ ResumeIQ",
      },
    ],
    origin: "internal",
  },
  {
    id: "demo-bob",
    rank: 0,
    name: "Bob Martinez",
    initials: "BM",
    email: "bob.martinez@example.com",
    phone: "+1 (555) 010-1003",
    title: "Reporting Analyst",
    location: "Austin",
    years: 2,
    level: "Junior",
    education: "BA Business",
    score: 0,
    categories: { skills: 48, experience: 42, education: 55, certifications: 20, projects: 40 },
    skills: ["Java", "SQL", "Excel"],
    strengths: ["Solid SQL reporting and stakeholder dashboards"],
    gaps: [
      "No Python, FastAPI, Azure, or Docker evidence",
      "Experience is analytics, not backend services",
    ],
    transferable: ["SQL can help with data-access stories, not the core stack"],
    evidence: [
      {
        skill: "SQL",
        detail: "Built weekly revenue dashboards in Java/SQL",
        source: "Analytics @ Globex",
      },
      { skill: "Java", detail: "Maintained batch reporting jobs", source: "Analytics @ Globex" },
    ],
    origin: "external",
  },
];
const DEMO_FRAUD_CANDIDATES: Candidate[] = [
  {
    id: "demo-1",
    rank: 0,
    name: "Victor Stone",
    initials: "VS",
    email: "victor.stone@mailinator.com",
    phone: "+1 (555) 402-7731",
    title: "Full-Stack Engineer",
    location: "Toronto",
    years: 6,
    level: "Senior",
    education: "BSc Computer Science",
    score: 0,
    categories: { skills: 82, experience: 74, education: 70, certifications: 55, projects: 68 },
    skills: ["React", "Node.js", "TypeScript", "AWS", "SQL"],
    strengths: [
      "6 years shipping React/Node services in production",
      "Owned API redesign initiative end-to-end",
    ],
    gaps: ["Limited exposure to Kubernetes", "No formal leadership evidence found"],
    transferable: [
      "TypeScript experience maps closely to the required stack",
      "Mentoring history suggests readiness for senior scope",
    ],
    evidence: [
      {
        skill: "React",
        detail: "Led service migration",
        source: "Platform Team @ Vantablack Dynamics Group",
      },
      { skill: "Node.js", detail: "Built automation scripts", source: "Freelance Project" },
      {
        skill: "TypeScript",
        detail: "Authored internal library",
        source: "Open-source contribution",
      },
      { skill: "AWS", detail: "Reduced p95 latency by 40%", source: "Capstone Thesis" },
    ],
    origin: "external",
  },
  {
    id: "demo-2",
    rank: 0,
    name: "Elena Marsh",
    initials: "EM",
    email: "elena.marsh@mailinator.com",
    phone: "+1 (555) 218-9064",
    title: "Data Engineer",
    location: "Austin",
    years: 8,
    level: "Senior",
    education: "MSc Data Science",
    score: 0,
    categories: { skills: 88, experience: 81, education: 75, certifications: 40, projects: 72 },
    skills: ["Python", "Spark", "Airflow", "SQL", "Kafka"],
    strengths: [
      "8 years shipping Python data-pipeline services in production",
      "Owned cost reduction initiative end-to-end",
    ],
    gaps: ["No certification evidence found", "Limited exposure to Terraform"],
    transferable: [
      "Spark experience maps closely to the required stack",
      "Mentoring history suggests readiness for staff scope",
    ],
    evidence: [
      {
        skill: "Python",
        detail: "Designed data pipeline",
        source: "Platform Team @ Vantablack Dynamics Group",
      },
      {
        skill: "Spark",
        detail: "Led service migration",
        source: "Lead role @ Zephyrion Nexus Holdings",
      },
      { skill: "Airflow", detail: "Built automation scripts", source: "Freelance Project" },
      { skill: "SQL", detail: "Reduced p95 latency by 40%", source: "Open-source contribution" },
    ],
    origin: "external",
  },
  {
    id: "demo-3",
    rank: 0,
    name: "Derek Voss",
    initials: "DV",
    email: "derek.voss@mailinator.com",
    phone: "+1 (555) 664-3390",
    title: "Cloud Architect",
    location: "Berlin",
    years: 11,
    level: "Lead",
    education: "MSc Software Engineering",
    score: 0,
    categories: { skills: 91, experience: 86, education: 80, certifications: 60, projects: 78 },
    skills: ["Azure", "Kubernetes", "Terraform", "Docker", "CI/CD"],
    strengths: [
      "11 years shipping cloud-platform services in production",
      "Owned migration initiative end-to-end",
    ],
    gaps: ["No regulated-industry evidence found", "Limited exposure to GraphQL"],
    transferable: [
      "Kubernetes experience maps closely to the required stack",
      "Mentoring history suggests readiness for staff scope",
    ],
    evidence: [
      {
        skill: "Azure",
        detail: "Led service migration",
        source: "Platform Team @ Vantablack Dynamics Group",
      },
      {
        skill: "Kubernetes",
        detail: "Designed data pipeline",
        source: "Lead role @ Zephyrion Nexus Holdings",
      },
      {
        skill: "Terraform",
        detail: "Built automation scripts",
        source: "Senior role @ Quantum Fable Systems",
      },
      { skill: "Docker", detail: "Reduced p95 latency by 40%", source: "Capstone Thesis" },
    ],
    origin: "internal",
  },
  {
    id: "demo-4",
    rank: 0,
    name: "Abu Abbas",
    initials: "AA",
    email: "abu.abbas@mailinator.com",
    phone: "+1 (555) 837-1256",
    title: "Backend Engineer",
    location: "Amsterdam",
    years: 5,
    level: "Mid",
    education: "BEng Information Systems",
    score: 0,
    categories: { skills: 76, experience: 69, education: 64, certifications: 45, projects: 60 },
    skills: ["Python", "Go", "Postgres", "Docker", "GraphQL"],
    strengths: [
      "5 years shipping backend services in production",
      "Owned observability initiative end-to-end",
    ],
    gaps: ["No certification evidence found", "Limited exposure to Rust"],
    transferable: [
      "Go experience maps closely to the required stack",
      "Mentoring history suggests readiness for senior scope",
    ],
    evidence: [
      {
        skill: "Python",
        detail: "Built automation scripts",
        source: "Platform Team @ Umbra Cascade Technologies",
      },
      { skill: "Go", detail: "Led service migration", source: "Freelance Project" },
      { skill: "Postgres", detail: "Designed data pipeline", source: "Open-source contribution" },
      { skill: "Docker", detail: "Authored internal library", source: "Capstone Thesis" },
    ],
    origin: "external",
  },
];

export const CANDIDATES: Candidate[] = [
  ...DEMO_WORKFLOW_CANDIDATES,
  ...build(),
  ...DEMO_FRAUD_CANDIDATES,
];

/** Historical baseline the dashboard adds live upload counts on top of. */
export const BASELINE_RESUMES_PROCESSED = 1256;

export type Weights = {
  skills: number;
  experience: number;
  education: number;
  certifications: number;
  projects: number;
};

export const DEFAULT_WEIGHTS: Weights = {
  skills: 40,
  experience: 25,
  education: 15,
  certifications: 10,
  projects: 10,
};

export function scoreOf(c: Candidate, w: Weights) {
  const total = w.skills + w.experience + w.education + w.certifications + w.projects || 1;
  return Math.round(
    (c.categories.skills * w.skills +
      c.categories.experience * w.experience +
      c.categories.education * w.education +
      c.categories.certifications * w.certifications +
      c.categories.projects * w.projects) /
      total,
  );
}

export function rankCandidates(list: Candidate[], w: Weights): Candidate[] {
  return list
    .map((c) => ({ ...c, score: scoreOf(c, w) }))
    .sort((a, b) => b.score - a.score)
    .map((c, i) => ({ ...c, rank: i + 1 }));
}

export const ALL_SKILLS = SKILLS;

export const SKILL_DISTRIBUTION = ALL_SKILLS.map((s) => ({
  skill: s,
  count: CANDIDATES.filter((c) => c.skills.includes(s)).length,
})).sort((a, b) => b.count - a.count);

export const EXPERIENCE_BREAKDOWN = (["Junior", "Mid", "Senior", "Lead"] as const).map((l) => ({
  level: l,
  count: CANDIDATES.filter((c) => c.level === l).length,
}));

export function scoreBuckets(list: Candidate[]) {
  const buckets = ["0-40", "40-55", "55-70", "70-85", "85-100"];
  return buckets.map((b, i) => {
    const lo = [0, 40, 55, 70, 85][i]!;
    const hi = [40, 55, 70, 85, 101][i]!;
    return { bucket: b, count: list.filter((c) => c.score >= lo && c.score < hi).length };
  });
}
