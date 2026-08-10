import realCandidates from "./candidates-dataset.json";

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
};

/** Real candidate pool imported from resume_screening_synthetic_dataset.xlsx. */
function build(): Candidate[] {
  return realCandidates as Candidate[];
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

export const ALL_SKILLS = Array.from(new Set(CANDIDATES.flatMap((c) => c.skills))).sort();

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
