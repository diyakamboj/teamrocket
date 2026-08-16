/** Notice period as stated on the resume. "Not stated" = no signal found. */
export type Availability = "Immediate" | "15 days" | "30 days" | "60 days" | "Not stated";

export type CandidateCertification = {
  name: string;
  issuer: string;
  /** Public credential record. Without one the claim can't be badged. */
  credentialUrl?: string;
};

/** A public profile the candidate linked, used to corroborate skill claims. */
export type ExternalProfile = {
  label: string;
  url: string;
  /** Skills evidenced by that profile (repos, endorsements, public work). */
  skills: string[];
};

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
  availability: Availability;
  /** Resume line the availability was read from — the badge cites it. */
  availabilityNote: string;
  certifications: CandidateCertification[];
  externalProfile?: ExternalProfile;
};

const FIRST = [
  "Amara","Priya","Diego","Lena","Noah","Yusuf","Mei","Tomas","Ines","Kofi","Sofia","Elias",
  "Nadia","Ravi","Clara","Marek","Aisha","Jonas","Leila","Hugo","Zara","Otto","Maya","Idris",
];
const LAST = [
  "Okonkwo","Sharma","Ferreira","Bergman","Whitfield","Demir","Tanaka","Novak","Rivera","Mensah",
  "Castellano","Vogel","Haddad","Iyer","Lindqvist","Kowalski","Diallo","Weber","Barakat","Almeida",
];
const TITLES = [
  "Backend Engineer","Data Engineer","ML Engineer","Cloud Architect","Full-Stack Engineer",
  "DevOps Engineer","Platform Engineer","Analytics Engineer","Site Reliability Engineer",
];
const CITIES = ["Berlin","Lisbon","Toronto","Austin","Bengaluru","Nairobi","Amsterdam","Warsaw","Dublin"];
const SKILLS = [
  "Python","TypeScript","AWS","Azure","Kubernetes","SQL","React","Terraform","Docker","Spark",
  "Go","PyTorch","GraphQL","Airflow","Postgres","CI/CD","Rust","Kafka",
];
const DEGREES = [
  "BSc Computer Science","MSc Software Engineering","BEng Information Systems",
  "MSc Data Science","BSc Mathematics","PhD Machine Learning",
];
const SOURCES = ["SWE Internship","Platform Team @ Northwind","Freelance Project","Open-source contribution","Capstone Thesis","Lead role @ Larkspur"];
const CERTIFICATIONS: { name: string; issuer: string; skill: string }[] = [
  { name: "AWS Solutions Architect – Associate", issuer: "Amazon Web Services", skill: "AWS" },
  { name: "Certified Kubernetes Administrator", issuer: "CNCF", skill: "Kubernetes" },
  { name: "Azure Administrator (AZ-104)", issuer: "Microsoft", skill: "Azure" },
  { name: "Terraform Associate", issuer: "HashiCorp", skill: "Terraform" },
  { name: "Professional Data Engineer", issuer: "Google Cloud", skill: "Spark" },
];
const AVAILABILITY: { value: Availability; note: string }[] = [
  { value: "Immediate", note: "Availability: immediate — currently between roles" },
  { value: "15 days", note: "Notice period: 15 days" },
  { value: "30 days", note: "Notice period: 30 days" },
  { value: "60 days", note: "Notice period: 60 days" },
  { value: "Not stated", note: "No availability stated on the resume" },
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
  const pick = <T,>(arr: T[]) => arr[Math.floor(rnd() * arr.length)]!;
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
    const skills = Array.from(
      new Set(Array.from({ length: between(4, 8) }, () => pick(SKILLS))),
    );
    const availability = pick(AVAILABILITY);
    // Certification claims only count when they carry a public credential
    // record — half of them deliberately don't, so badges stay earned.
    const certifications = Array.from({ length: between(0, 2) }, () => pick(CERTIFICATIONS)).map(
      (c, n) => ({
        name: c.name,
        issuer: c.issuer,
        ...(rnd() > 0.45
          ? { credentialUrl: `https://credentials.example.org/${i + 1}-${n + 1}` }
          : {}),
      }),
    );
    // Don't claim a missing credential trail for someone who has a badged one.
    const gapKind = certifications.some((c) => c.credentialUrl)
      ? pick(["formal leadership", "regulated-industry"])
      : pick(["certification", "formal leadership", "regulated-industry"]);
    const hasProfile = rnd() > 0.4;
    // Roughly one in nine resumes parses badly enough to be unusable.
    const incomplete = i % 9 === 0;
    list.push({
      id: `c-${i + 1}`,
      rank: 0,
      name,
      initials: `${first[0]}${last[0]}`,
      email: `${first.toLowerCase()}.${last.toLowerCase()}@mail.com`,
      phone: incomplete
        ? ""
        : `+1 (555) ${String(between(100, 999))}-${String(between(1000, 9999))}`,
      title: pick(TITLES),
      location: pick(CITIES),
      years,
      level,
      education: incomplete ? "" : pick(DEGREES),
      score: 0,
      categories,
      skills,
      availability: availability.value,
      availabilityNote: availability.note,
      certifications,
      ...(hasProfile
        ? {
            externalProfile: {
              label: "GitHub profile",
              url: `https://github.com/${first.toLowerCase()}-${last.toLowerCase()}`,
              skills: skills.slice(0, between(1, 3)),
            },
          }
        : {}),
      strengths: [
        `${between(3, years)} years shipping ${skills[0]} services in production`,
        `Owned ${pick(["migration","observability","cost reduction","API redesign"])} initiative end-to-end`,
      ],
      gaps: [`Limited exposure to ${pick(SKILLS)}`, `No ${gapKind} evidence found`],
      transferable: [
        `${pick(SKILLS)} experience maps closely to the required stack`,
        `Mentoring history suggests readiness for ${level === "Lead" ? "staff" : "senior"} scope`,
      ],
      evidence: incomplete
        ? []
        : skills.slice(0, 4).map((s) => ({
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
    });
  }
  return list;
}

/**
 * Hand-authored demo candidates for presentations, tuned to trip real Fraud
 * Detection signals (live OFAC sanctions match, live employer-registry
 * lookups, disposable-email heuristic) so the queue isn't 100% "verified".
 * See backend/app/services/fraud_service.py for the scoring these rely on.
 */
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
      { skill: "React", detail: "Led service migration", source: "Platform Team @ Vantablack Dynamics Group" },
      { skill: "Node.js", detail: "Built automation scripts", source: "Freelance Project" },
      { skill: "TypeScript", detail: "Authored internal library", source: "Open-source contribution" },
      { skill: "AWS", detail: "Reduced p95 latency by 40%", source: "Capstone Thesis" },
    ],
    availability: "Immediate",
    availabilityNote: "Availability: immediate — currently between roles",
    certifications: [
      {
        name: "AWS Solutions Architect – Associate",
        issuer: "Amazon Web Services",
        credentialUrl: "https://credentials.example.org/demo-1",
      },
    ],
    externalProfile: {
      label: "GitHub profile",
      url: "https://github.com/victor-stone",
      skills: ["React", "TypeScript"],
    },
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
      { skill: "Python", detail: "Designed data pipeline", source: "Platform Team @ Vantablack Dynamics Group" },
      { skill: "Spark", detail: "Led service migration", source: "Lead role @ Zephyrion Nexus Holdings" },
      { skill: "Airflow", detail: "Built automation scripts", source: "Freelance Project" },
      { skill: "SQL", detail: "Reduced p95 latency by 40%", source: "Open-source contribution" },
    ],
    availability: "30 days",
    availabilityNote: "Notice period: 30 days",
    // Claims the cert but supplied no credential record — stays unbadged.
    certifications: [{ name: "Professional Data Engineer", issuer: "Google Cloud" }],
    externalProfile: {
      label: "GitHub profile",
      url: "https://github.com/elena-marsh",
      skills: ["Python", "Spark"],
    },
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
      { skill: "Azure", detail: "Led service migration", source: "Platform Team @ Vantablack Dynamics Group" },
      { skill: "Kubernetes", detail: "Designed data pipeline", source: "Lead role @ Zephyrion Nexus Holdings" },
      { skill: "Terraform", detail: "Built automation scripts", source: "Senior role @ Quantum Fable Systems" },
      { skill: "Docker", detail: "Reduced p95 latency by 40%", source: "Capstone Thesis" },
    ],
    availability: "15 days",
    availabilityNote: "Notice period: 15 days",
    certifications: [
      {
        name: "Certified Kubernetes Administrator",
        issuer: "CNCF",
        credentialUrl: "https://credentials.example.org/demo-3",
      },
      {
        name: "Terraform Associate",
        issuer: "HashiCorp",
        credentialUrl: "https://credentials.example.org/demo-3b",
      },
    ],
    externalProfile: {
      label: "GitHub profile",
      url: "https://github.com/derek-voss",
      skills: ["Kubernetes", "Terraform", "Docker"],
    },
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
      { skill: "Python", detail: "Built automation scripts", source: "Platform Team @ Umbra Cascade Technologies" },
      { skill: "Go", detail: "Led service migration", source: "Freelance Project" },
      { skill: "Postgres", detail: "Designed data pipeline", source: "Open-source contribution" },
      { skill: "Docker", detail: "Authored internal library", source: "Capstone Thesis" },
    ],
    availability: "Not stated",
    availabilityNote: "No availability stated on the resume",
    certifications: [],
  },
];

export const CANDIDATES: Candidate[] = [...build(), ...DEMO_FRAUD_CANDIDATES];

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
