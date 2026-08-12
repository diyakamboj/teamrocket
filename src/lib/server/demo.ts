/**
 * Demo seed — a self-contained, zero-Azure way to see the whole product.
 *
 * The fixtures here are *not* mock records: they are plain resume texts and one
 * job description pushed through the exact same producers the real upload flow
 * uses (`parseResume` → `analyzeJobDescription` → `screen`). The demo therefore
 * shows genuine pipeline output — heuristic parses, keyword evidence, verdicts
 * and a ranked pool — without needing a PDF, an upload, or Azure credentials.
 *
 * `loadDemoData` resets the store and persists the batch in a completed run, so
 * every route (dashboard, ranking, comparison, copilot) renders as if a real
 * screening had just finished. Repeated loads are safe: `store.resetAll()` gives
 * each one a clean slate.
 */
import { analyzeJobDescription } from "./jd-analyzer";
import { parseResume } from "./resume-parser";
import { screen } from "./matching";
import { store } from "./store";
import type { JobRecord, MatchRecord, ResumeRecord } from "@/lib/types";

/**
 * Backend-engineer JD weighted so the demo pool separates into a believable
 * ranking: musts (5+ years, Python/Kubernetes, Terraform/Kafka, distributed+
 * PostgreSQL) gate the top; nices (gRPC/GraphQL, mentoring, CS degree, AWS cert)
 * break ties. The offline analyzer derives these as 4 must / 4 nice across all
 * four requirement categories.
 */
export const DEMO_JOB_DESCRIPTION = `Senior Backend Engineer — Data Platform

We are the engineering team behind a real-time recruiting analytics platform used by thousands of recruiters. We design and operate high-scale services so hiring teams can screen candidates faster.

Requirements:
- Must have 5+ years of experience building backend systems.
- Strong Python and Kubernetes skills are required.
- Experience with Terraform and Kafka is required.
- Solid understanding of distributed systems and PostgreSQL is essential.
- Experience with gRPC or GraphQL is preferred.
- Experience leading and mentoring engineers is preferred.
- A degree in Computer Science is preferred.
- AWS Certified Solutions Architect certification is a plus.`;

/**
 * Eight hand-written resumes with deliberately different tenure, stack, degree
 * and certification profiles, so the seeded ranking and its gaps read as a real
 * applicant pool rather than an echo of one template.
 */
export const DEMO_RESUME_TEXTS: string[] = [
  `Ada Lovelace
Senior Backend Engineer

ada@example.com | Seattle, WA

SUMMARY
Backend engineer with 10+ years building and operating distributed systems.

SKILLS
Python, Kubernetes, Docker, Distributed Systems, PostgreSQL, Terraform, Kafka, GraphQL, AWS, CI/CD

EXPERIENCE
Senior Backend Engineer | Stratos Cloud — 2019 – present
- Building and operating Kubernetes clusters serving 4M daily requests
- Mentoring junior engineers and leading platform design reviews
- Migrating monoliths to event-driven services with Python and Kafka
Backend Engineer | Nimbus Systems — 2016 – 2019
- Owned the payments API handling $2B in yearly volume
- Introduced PostgreSQL sharding and Terraform-managed AWS infrastructure

EDUCATION
Bachelor of Science degree in Computer Science — University of Washington, 2015

CERTIFICATIONS
AWS Certified Solutions Architect Certification — AWS, 2021

PROJECTS
k8s-operator — automated Kubernetes rolling deployments`,

  `Grace Hopper
Backend Engineer

grace@example.com | Chicago, IL

SUMMARY
Software engineer with 6 years shipping Go services on Kubernetes.

SKILLS
Go, Rust, Kubernetes, Docker, Redis, gRPC, Linux, Distributed Systems

EXPERIENCE
Backend Engineer | Compiler Works — 2023 – present
- Building and operating Go services on Kubernetes
- Designing distributed systems for high-throughput messaging
- Implementing gRPC APIs for internal tooling
Software Engineer | Punch Card Inc — 2020 – 2023
- Writing Rust tooling for a legacy platform migration
- Operating Redis-backed caches in production

EDUCATION
Bachelor of Science degree in Computer Engineering — Purdue University, 2015

PROJECTS
grpc-gateway — transparent gRPC to REST translation`,

  `Alan Turing
Staff Engineer

alan@example.com | Manchester, UK

SUMMARY
Distributed systems engineer with 13+ years working on Java-based platforms.

SKILLS
Java, Spring, SQL, Distributed Systems, Docker, Linux

EXPERIENCE
Staff Engineer | Bletchley Computing — 2013 – present
- Building and operating backend systems on the JVM
- Leading a team of 8 engineers working on messaging infrastructure
- Mentoring junior engineers on system design

EDUCATION
Master of Science degree in Mathematics — King's College, 2003

PROJECTS
enigma-cli — simulation of early messaging cryptanalysis`,

  `Katherine Johnson
Backend Engineer

katherine@example.com | Hampton, VA

SUMMARY
Python engineer with 6 years building data pipelines and backend systems.

SKILLS
Python, SQL, PostgreSQL, Distributed Systems, Pandas, FastAPI

EXPERIENCE
Backend Engineer | Orbital Data Labs — 2023 – present
- Building and operating backend systems for analytics pipelines
- Designing distributed systems for large-scale batch processing
Data Engineer | Guidance Computing — 2020 – 2023
- Writing Python services that process millions of records a day

EDUCATION
Bachelor of Science degree in Mathematics — West Virginia State, 2018

PROJECTS
spaceplot — visualising rocket telemetry`,

  `Margaret Hamilton
Principal Engineer

margaret@example.com | Cambridge, MA

SUMMARY
Systems engineer with 17 years building mission-critical software.

SKILLS
C++, Assembly, Systems Engineering, Debugging, Linux

EXPERIENCE
Principal Engineer | Apollo Computing — 2009 – present
- Building and operating real-time control systems for flight software
- Leading verification teams and mentoring engineers on rigorous testing
Senior Engineer | Instrumentation Labs — 2004 – 2009
- Writing C++ for embedded control systems

PROJECTS
static-checker — compile-time verification for C++`,

  `Edsger Dijkstra
Software Engineer

edsger@example.com | Eindhoven, NL

SUMMARY
Junior engineer with 2 years writing Rust and C++ tools.

SKILLS
Rust, C++, Linux, Git

EXPERIENCE
Software Engineer | ALGOL Systems — 2024 – present
- Building backend tooling in Rust with a small team
- Writing C++ libraries for text and graph processing

EDUCATION
Bachelor of Science degree in Physics — TU Eindhoven, 2023

PROJECTS
shortest-path — graph algorithms in Rust`,

  `Linus Torvalds
Platform Engineer

linus@example.com | Helsinki, FI

SUMMARY
Systems programmer with 12 years building platform and operations tooling.

SKILLS
Go, C, Kubernetes, Docker, Linux, Prometheus, Distributed Systems, Git

EXPERIENCE
Principal Engineer | Merger OS Foundation — 2020 – present
- Building and operating Kubernetes platforms for open-core products
- Mentoring and leading junior platform engineers
Engineer | Helsinki Systems — 2014 – 2020
- Writing Go and C for distributed systems and monitoring

EDUCATION
Bachelor of Science degree in Computer Science — University of Helsinki, 2010

PROJECTS
sched — process scheduling simulator in Go`,

  `Radia Perlman
Cloud Engineer

radia@example.com | Boston, MA

SUMMARY
Engineer with 7 years designing networks and cloud infrastructure.

SKILLS
Terraform, AWS, Azure, Networking, Linux, Docker, Python, Distributed Systems

EXPERIENCE
Cloud Engineer | Spanning Networks — 2019 – present
- Building and operating infrastructure as code with Terraform on AWS
- Designing distributed systems for wide-area network monitoring

EDUCATION
Bachelor of Science degree in Computer Science — MIT, 2012

CERTIFICATIONS
AWS Certified Solutions Architect Certification — AWS, 2020

PROJECTS
net-topo — network topology visualiser`,
];

function fileNameFrom(name: string | undefined, index: number): string {
  const base = name
    ?.toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return `${base || `demo-${index + 1}`}.pdf`;
}

/**
 * Builds the demo batch in memory: parse every fixture resume, analyze the JD,
 * then run the offline screening. Nothing here is persisted and nothing touches
 * Azure — the producer layer's own fallback paths do the work.
 */
export async function demoData(): Promise<{
  resumes: ResumeRecord[];
  job: JobRecord;
  matches: MatchRecord[];
}> {
  const resumes: ResumeRecord[] = [];
  for (const [index, text] of DEMO_RESUME_TEXTS.entries()) {
    const { parsed, engine } = await parseResume(text);
    const now = new Date().toISOString();
    resumes.push({
      id: store.nextId("res"),
      fileName: fileNameFrom(parsed.name, index),
      fileSize: text.length,
      stage: "complete",
      progress: 100,
      uploadedAt: now,
      processedAt: now,
      parseEngine: engine,
      textSource: "plain-text",
      textChars: text.length,
      parsed,
    });
  }

  const job = await analyzeJobDescription(
    DEMO_JOB_DESCRIPTION,
    store.nextId("job"),
  );
  const matches = await screen(job, resumes);
  return { resumes, job, matches };
}

/**
 * Persists the demo batch as a completed screening run. Returns headline counts
 * so the UI can toast what actually landed instead of assuming anything.
 */
export async function loadDemoData(): Promise<{
  jobTitle: string;
  resumes: number;
  screened: number;
}> {
  store.resetAll();
  const { resumes, job, matches } = await demoData();

  for (const resume of resumes) store.addResume(resume);
  store.saveJob(job);
  for (const match of matches) store.saveMatch(match);

  const now = new Date().toISOString();
  store.saveRun({
    jobId: job.id,
    startedAt: now,
    finishedAt: now,
    total: matches.length,
    scored: matches.length,
    aiAnalyzed: matches.filter((m) => m.aiAnalyzed).length,
    running: false,
  });

  return {
    jobTitle: job.title,
    resumes: resumes.length,
    screened: matches.length,
  };
}
