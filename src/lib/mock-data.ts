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
        `Owned ${pick(["migration","observability","cost reduction","API redesign"])} initiative end-to-end`,
      ],
      gaps: [
        `Limited exposure to ${pick(SKILLS)}`,
        `No ${pick(["certification","formal leadership","regulated-industry"])} evidence found`,
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
    });
  }
  return list;
}

export const CANDIDATES: Candidate[] = build();

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
