import { capabilities } from "./config";
import { chatJson } from "./ai";
import { parsedResumeSchema } from "@/lib/validation";
import type { ParseEngine, ParsedResume } from "@/lib/types";

const SYSTEM_PROMPT = `You are a resume parsing engine for a recruiting platform.
Extract structured data from the resume text exactly as written — never invent, infer or embellish facts.
Rules:
- Use "" or omit a field when the resume does not state it. Do not guess.
- totalYearsExperience is the summed duration of professional roles (exclude internships shorter than 6 months and education). Round to one decimal.
- skills must be concrete technologies, tools, languages, methodologies or domain skills. No soft-skill filler like "team player".
- For every skill, evidence should quote or tightly paraphrase where in the resume it is demonstrated, when such a mention exists.
- highlights are the candidate's own bullet points, condensed to one line each.
- Keep dates in the format written on the resume.
Return JSON only.`;

const RESUME_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string" },
    email: { type: "string" },
    phone: { type: "string" },
    location: { type: "string" },
    title: { type: "string" },
    summary: { type: "string" },
    totalYearsExperience: { type: "number" },
    links: { type: "array", items: { type: "string" } },
    skills: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          evidence: { type: "string" },
          years: { type: "number" },
        },
        required: ["name"],
      },
    },
    experience: {
      type: "array",
      items: {
        type: "object",
        properties: {
          company: { type: "string" },
          title: { type: "string" },
          startDate: { type: "string" },
          endDate: { type: "string" },
          current: { type: "boolean" },
          location: { type: "string" },
          highlights: { type: "array", items: { type: "string" } },
          technologies: { type: "array", items: { type: "string" } },
        },
        required: ["company", "title"],
      },
    },
    education: {
      type: "array",
      items: {
        type: "object",
        properties: {
          institution: { type: "string" },
          degree: { type: "string" },
          field: { type: "string" },
          graduationYear: { type: "string" },
          grade: { type: "string" },
        },
        required: ["institution", "degree"],
      },
    },
    certifications: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          issuer: { type: "string" },
          issueDate: { type: "string" },
          expiryDate: { type: "string" },
        },
        required: ["name"],
      },
    },
    projects: {
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          description: { type: "string" },
          technologies: { type: "array", items: { type: "string" } },
          url: { type: "string" },
        },
        required: ["name"],
      },
    },
  },
  required: ["skills", "experience", "education", "certifications", "projects"],
} as const;

export async function parseResume(
  text: string,
): Promise<{ parsed: ParsedResume; engine: ParseEngine }> {
  if (capabilities().chat) {
    const raw = await chatJson({
      system: SYSTEM_PROMPT,
      user: `Resume text:\n"""\n${text.slice(0, 40_000)}\n"""`,
      schema: {
        name: "parsed_resume",
        schema: RESUME_SCHEMA as unknown as Record<string, unknown>,
      },
      maxTokens: 4000,
    });
    const parsed = coerceParsedResume(raw);
    // A model that returned nothing usable is worse than the regex pass.
    if (parsed.skills.length || parsed.experience.length) {
      return { parsed: backfill(parsed, text), engine: "azure-openai" };
    }
  }
  return { parsed: heuristicParse(text), engine: "heuristic" };
}

/* ------------------------------- coercion -------------------------------- */

/**
 * Model output before validation. Keys are declared rather than using an index
 * signature so they can be read with dot access under
 * `noPropertyAccessFromIndexSignature`.
 */
type Loose = {
  [
    K in
      | "name"
      | "email"
      | "phone"
      | "location"
      | "title"
      | "summary"
      | "totalYearsExperience"
      | "links"
      | "skills"
      | "experience"
      | "education"
      | "certifications"
      | "projects"
      | "evidence"
      | "years"
      | "company"
      | "startDate"
      | "endDate"
      | "current"
      | "highlights"
      | "technologies"
      | "institution"
      | "degree"
      | "field"
      | "graduationYear"
      | "grade"
      | "issuer"
      | "issueDate"
      | "expiryDate"
      | "description"
      | "url"
  ]?: unknown;
};

const str = (v: unknown): string | undefined => {
  const s =
    typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s : undefined;
};
const strArray = (v: unknown): string[] =>
  Array.isArray(v) ? v.map(str).filter((s): s is string => Boolean(s)) : [];
const objArray = (v: unknown): Loose[] =>
  Array.isArray(v)
    ? v.filter((x): x is Loose => typeof x === "object" && x !== null)
    : [];
const numOr = (v: unknown): number | undefined => {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

function coerceShape(raw: unknown): ParsedResume {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Loose;
  return {
    name: str(o.name),
    email: str(o.email),
    phone: str(o.phone),
    location: str(o.location),
    title: str(o.title),
    summary: str(o.summary),
    totalYearsExperience: numOr(o.totalYearsExperience),
    links: strArray(o.links),
    skills: objArray(o.skills)
      .map((s) => ({
        name: str(s.name) ?? "",
        evidence: str(s.evidence),
        years: numOr(s.years),
      }))
      .filter((s) => s.name),
    experience: objArray(o.experience)
      .map((e) => ({
        company: str(e.company) ?? "",
        title: str(e.title) ?? "",
        startDate: str(e.startDate),
        endDate: str(e.endDate),
        current: e.current === true,
        location: str(e.location),
        highlights: strArray(e.highlights),
        technologies: strArray(e.technologies),
      }))
      .filter((e) => e.company || e.title),
    education: objArray(o.education)
      .map((e) => ({
        institution: str(e.institution) ?? "",
        degree: str(e.degree) ?? "",
        field: str(e.field),
        graduationYear: str(e.graduationYear),
        grade: str(e.grade),
      }))
      .filter((e) => e.institution || e.degree),
    certifications: objArray(o.certifications)
      .map((c) => ({
        name: str(c.name) ?? "",
        issuer: str(c.issuer),
        issueDate: str(c.issueDate),
        expiryDate: str(c.expiryDate),
      }))
      .filter((c) => c.name),
    projects: objArray(o.projects)
      .map((p) => ({
        name: str(p.name) ?? "",
        description: str(p.description),
        technologies: strArray(p.technologies),
        url: str(p.url),
      }))
      .filter((p) => p.name),
  };
}

/**
 * Coerces + validates untrusted model output against the frozen contract
 * (validation.ts). `coerceShape` already guarantees the structural shape, so a
 * schema failure here means producer/contract drift — keep the coercion and let
 * the caller's skills/experience emptiness check decide usability rather than
 * dropping the whole resume.
 */
export function coerceParsedResume(raw: unknown): ParsedResume {
  const coerced = coerceShape(raw);
  const result = parsedResumeSchema.safeParse(coerced);
  return result.success ? result.data : coerced;
}

/** Fills contact details and tenure the model may have skipped, straight from the text. */
function backfill(parsed: ParsedResume, text: string): ParsedResume {
  return {
    ...parsed,
    email: parsed.email ?? findEmail(text),
    phone: parsed.phone ?? findPhone(text),
    links: parsed.links.length ? parsed.links : findLinks(text),
    totalYearsExperience:
      parsed.totalYearsExperience ??
      yearsFromExperience(parsed) ??
      yearsFromText(text),
  };
}

/* ------------------------------- heuristics ------------------------------- */

const KNOWN_SKILLS = [
  "python",
  "java",
  "javascript",
  "typescript",
  "c++",
  "c#",
  "go",
  "golang",
  "rust",
  "ruby",
  "php",
  "scala",
  "kotlin",
  "swift",
  "r",
  "matlab",
  "sql",
  "nosql",
  "bash",
  "shell",
  "react",
  "angular",
  "vue",
  "svelte",
  "next.js",
  "node.js",
  "express",
  "django",
  "flask",
  "fastapi",
  "spring",
  "spring boot",
  ".net",
  "rails",
  "graphql",
  "rest api",
  "aws",
  "azure",
  "gcp",
  "google cloud",
  "kubernetes",
  "docker",
  "terraform",
  "ansible",
  "jenkins",
  "github actions",
  "gitlab ci",
  "ci/cd",
  "helm",
  "openshift",
  "serverless",
  "lambda",
  "postgres",
  "postgresql",
  "mysql",
  "mongodb",
  "redis",
  "cassandra",
  "dynamodb",
  "elasticsearch",
  "snowflake",
  "databricks",
  "bigquery",
  "redshift",
  "oracle",
  "spark",
  "hadoop",
  "kafka",
  "airflow",
  "dbt",
  "etl",
  "flink",
  "hive",
  "pytorch",
  "tensorflow",
  "scikit-learn",
  "pandas",
  "numpy",
  "keras",
  "hugging face",
  "llm",
  "nlp",
  "computer vision",
  "machine learning",
  "deep learning",
  "mlops",
  "git",
  "linux",
  "agile",
  "scrum",
  "kanban",
  "jira",
  "microservices",
  "distributed systems",
  "system design",
  "tdd",
  "unit testing",
  "selenium",
  "cypress",
  "playwright",
  "html",
  "css",
  "tailwind",
  "sass",
  "figma",
  "ux",
  "accessibility",
  "terraform",
  "prometheus",
  "grafana",
  "datadog",
  "splunk",
  "observability",
  "sre",
  "security",
  "oauth",
  "saml",
];

const DEGREE_WORDS =
  /\b(ph\.?d|doctorate|m\.?sc|m\.?s\.?|master(?:'s)?|mba|m\.?eng|b\.?sc|b\.?s\.?|b\.?a\.?|bachelor(?:'s)?|b\.?eng|b\.?tech|m\.?tech|associate(?:'s)? degree|diploma)\b/i;

const CERT_WORDS =
  /\b(certified|certificate|certification|aws certified|azure|google cloud certified|pmp|cissp|ckad|cka|scrum master|comptia|itil|six sigma|tensorflow developer)\b/i;

type SectionKey =
  | "summary"
  | "skills"
  | "experience"
  | "education"
  | "certifications"
  | "projects";

const SECTION_ALIASES: Record<SectionKey, string[]> = {
  summary: ["summary", "profile", "objective", "about"],
  skills: [
    "skills",
    "technical skills",
    "core competencies",
    "technologies",
    "tech stack",
    "expertise",
  ],
  experience: [
    "experience",
    "work experience",
    "professional experience",
    "employment",
    "employment history",
    "career history",
  ],
  education: [
    "education",
    "academic background",
    "academics",
    "qualifications",
  ],
  certifications: [
    "certifications",
    "certificates",
    "licenses",
    "licences",
    "courses",
  ],
  projects: ["projects", "personal projects", "selected projects", "portfolio"],
};

/** Regex/keyword parser used when Azure OpenAI is not configured. */
export function heuristicParse(text: string): ParsedResume {
  const sections = splitSections(text);
  const lower = text.toLowerCase();

  // Canonicalised and keyed by lowercase name, so "JavaScript"/"Javascript" and
  // "PostgreSQL"/"Postgres" each collapse to a single entry.
  const skillsByKey = new Map<string, string>();
  const addSkill = (raw: string) => {
    const known = KNOWN_SKILLS.find((s) => s === raw.toLowerCase());
    const name = known ? titleCaseSkill(known) : raw;
    const key = name.toLowerCase();
    if (!skillsByKey.has(key)) skillsByKey.set(key, name);
  };

  for (const skill of KNOWN_SKILLS) {
    const pattern = new RegExp(
      `(?:^|[^a-z0-9+#.])${escapeRegex(skill)}(?:$|[^a-z0-9+#.])`,
      "i",
    );
    if (pattern.test(lower)) addSkill(titleCaseSkill(skill));
  }
  for (const line of (sections.skills ?? "").split(/[\n,;•|·]/)) {
    const value = line.replace(/^[-*\s]+/, "").trim();
    if (
      value &&
      value.length <= 32 &&
      /[a-z]/i.test(value) &&
      !/[.:]$/.test(value)
    ) {
      addSkill(value);
    }
  }
  const skillNames = new Set(skillsByKey.values());

  const experience = parseExperienceBlocks(sections.experience ?? "");
  const education = (sections.education ?? "")
    .split(/\n(?=\s*[A-Z0-9])/)
    .map((block) => block.trim())
    .filter((block) => block && DEGREE_WORDS.test(block))
    .slice(0, 8)
    .map((block) => {
      const lines = block
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      const degreeLine =
        lines.find((l) => DEGREE_WORDS.test(l)) ?? lines[0] ?? "";
      const institution =
        lines.find((l) => l !== degreeLine && /[A-Za-z]{4,}/.test(l)) ?? "";
      return {
        institution: institution || degreeLine,
        degree: degreeLine,
        field: undefined,
        graduationYear: block.match(/\b(19|20)\d{2}\b/g)?.at(-1),
        grade: block.match(
          /\b(?:gpa|cgpa)[:\s]*([0-9.]+(?:\s*\/\s*[0-9.]+)?)/i,
        )?.[1],
      };
    });

  const certifications = (sections.certifications ?? text)
    .split("\n")
    .map((l) => l.replace(/^[-*•\s]+/, "").trim())
    .filter((l) => l.length > 3 && l.length < 120 && CERT_WORDS.test(l))
    .slice(0, 12)
    .map((name) => ({ name }));

  const projects = (sections.projects ?? "")
    .split(/\n(?=\s*[A-Z0-9])/)
    .map((block) => block.trim())
    .filter(Boolean)
    .slice(0, 10)
    .map((block) => {
      const [first, ...rest] = block.split("\n");
      return {
        name: (first ?? "").replace(/^[-*•\s]+/, "").slice(0, 90),
        description: rest.join(" ").trim() || undefined,
        technologies: [...skillNames].filter((s) =>
          block.toLowerCase().includes(s.toLowerCase()),
        ),
        url: block.match(/https?:\/\/\S+/)?.[0],
      };
    });

  const parsed: ParsedResume = {
    name: findName(text),
    email: findEmail(text),
    phone: findPhone(text),
    location: undefined,
    title: experience[0]?.title,
    summary:
      sections.summary?.split("\n").slice(0, 4).join(" ").trim() || undefined,
    totalYearsExperience: undefined,
    links: findLinks(text),
    skills: [...skillNames].slice(0, 60).map((name) => ({ name })),
    experience,
    education,
    certifications,
    projects,
  };

  parsed.totalYearsExperience =
    yearsFromExperience(parsed) ?? yearsFromText(text);
  return parsed;
}

function splitSections(text: string): Partial<Record<SectionKey, string>> {
  const lines = text.split("\n");
  const sections: Partial<Record<SectionKey, string>> = {};
  let current: SectionKey | null = null;
  let buffer: string[] = [];

  const commit = () => {
    if (current && buffer.length) {
      sections[current] =
        `${sections[current] ?? ""}\n${buffer.join("\n")}`.trim();
    }
    buffer = [];
  };

  for (const line of lines) {
    const heading = line
      .trim()
      .replace(/[:•\-–—_]+$/g, "")
      .trim()
      .toLowerCase();
    const match =
      heading.length <= 40
        ? (Object.entries(SECTION_ALIASES) as [SectionKey, string[]][]).find(
            ([, aliases]) => aliases.includes(heading),
          )
        : undefined;

    if (match) {
      commit();
      current = match[0];
      continue;
    }
    if (current) buffer.push(line);
  }
  commit();
  return sections;
}

const MONTH = "(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*";
const DATE_RANGE = new RegExp(
  `((?:${MONTH}\\.?\\s*)?(?:19|20)\\d{2})\\s*(?:-|–|—|to)\\s*((?:${MONTH}\\.?\\s*)?(?:19|20)\\d{2}|present|current|now)`,
  "i",
);

function parseExperienceBlocks(section: string) {
  const blocks = section
    .split(/\n\s*\n|\n(?=\s*[A-Z][^\n]{0,80}(?:\||,|\s—|\s–)\s)/)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.slice(0, 15).map((block) => {
    const lines = block
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const header = lines[0] ?? "";
    const range = block.match(DATE_RANGE);
    const [titlePart, companyPart] = header.split(/\s*(?:\||—|–|,|\bat\b)\s*/i);
    return {
      company: (companyPart ?? "").replace(DATE_RANGE, "").trim(),
      title: (titlePart ?? header).replace(DATE_RANGE, "").trim().slice(0, 90),
      startDate: range?.[1],
      endDate: range?.[3],
      current: /present|current|now/i.test(range?.[3] ?? ""),
      location: undefined,
      highlights: lines
        .slice(1)
        .filter((l) => /^[-*•]/.test(l))
        .map((l) => l.replace(/^[-*•\s]+/, ""))
        .slice(0, 8),
      technologies: [],
    };
  });
}

function findEmail(text: string) {
  return text.match(/[\w.+-]+@[\w-]+\.[\w.-]{2,}/)?.[0];
}

function findPhone(text: string) {
  return text
    .match(
      /(?:\+\d{1,3}[\s-]?)?(?:\(\d{2,4}\)[\s-]?)?\d{3,4}[\s-]?\d{3,4}(?:[\s-]?\d{2,4})?/,
    )?.[0]
    ?.trim()
    .replace(/\s{2,}/g, " ");
}

function findLinks(text: string) {
  const matches =
    text.match(/https?:\/\/\S+|(?:www\.|linkedin\.com|github\.com)\/\S+/gi) ??
    [];
  return [...new Set(matches.map((m) => m.replace(/[),.]+$/, "")))].slice(0, 6);
}

function findName(text: string) {
  const line = text
    .split("\n")
    .map((l) => l.trim())
    .find(
      (l) =>
        l &&
        l.length < 60 &&
        /^[A-Z][A-Za-z'’.-]+(?: [A-Z][A-Za-z'’.-]+){1,3}$/.test(l),
    );
  return line;
}

/** Sums role durations, merging nothing — good enough for a fallback signal. */
function yearsFromExperience(parsed: ParsedResume): number | undefined {
  let months = 0;
  for (const role of parsed.experience) {
    const start = parseLooseDate(role.startDate);
    if (!start) continue;
    const end = role.current
      ? new Date()
      : (parseLooseDate(role.endDate) ?? new Date());
    const diff =
      (end.getFullYear() - start.getFullYear()) * 12 +
      (end.getMonth() - start.getMonth());
    if (diff > 0) months += diff;
  }
  return months > 0 ? Math.round((months / 12) * 10) / 10 : undefined;
}

/** Last resort: the span between the earliest and latest year mentioned. */
function yearsFromText(text: string): number | undefined {
  const explicit = text.match(/(\d{1,2})\+?\s*years?\s+(?:of\s+)?experience/i);
  if (explicit) return Number(explicit[1]);
  const years = [...text.matchAll(/\b(19[89]\d|20[0-4]\d)\b/g)].map((m) =>
    Number(m[1]),
  );
  if (years.length < 2) return undefined;
  const span = Math.max(...years) - Math.min(...years);
  return span > 0 && span < 45 ? span : undefined;
}

function parseLooseDate(value?: string): Date | undefined {
  if (!value) return undefined;
  if (/present|current|now/i.test(value)) return new Date();
  const year = value.match(/(19|20)\d{2}/)?.[0];
  if (!year) return undefined;
  const monthName = value
    .match(new RegExp(MONTH, "i"))?.[0]
    ?.slice(0, 3)
    .toLowerCase();
  const months = [
    "jan",
    "feb",
    "mar",
    "apr",
    "may",
    "jun",
    "jul",
    "aug",
    "sep",
    "oct",
    "nov",
    "dec",
  ];
  const month = monthName ? months.indexOf(monthName) : 0;
  return new Date(Number(year), month < 0 ? 0 : month, 1);
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCaseSkill(skill: string) {
  const overrides: Record<string, string> = {
    "ci/cd": "CI/CD",
    aws: "AWS",
    gcp: "GCP",
    sql: "SQL",
    nosql: "NoSQL",
    html: "HTML",
    css: "CSS",
    nlp: "NLP",
    llm: "LLM",
    etl: "ETL",
    mlops: "MLOps",
    sre: "SRE",
    tdd: "TDD",
    ux: "UX",
    "rest api": "REST API",
    "node.js": "Node.js",
    "next.js": "Next.js",
    ".net": ".NET",
    "c++": "C++",
    "c#": "C#",
    golang: "Go",
    postgresql: "Postgres",
    // Brand names whose canonical casing the generic title-caser would mangle.
    javascript: "JavaScript",
    typescript: "TypeScript",
    graphql: "GraphQL",
  };
  return overrides[skill] ?? skill.replace(/\b[a-z]/g, (c) => c.toUpperCase());
}

export { findEmail, findPhone };
