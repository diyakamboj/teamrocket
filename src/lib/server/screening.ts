import { screen } from "./matching";
import { store } from "./store";
import {
  levelFromYears,
  type Candidate,
  type JobRecord,
  type MatchRecord,
  type ResumeRecord,
  type ScreeningRun,
} from "@/lib/types";

/** Jobs currently being screened, so a second request doesn't start a duplicate run. */
const inFlight = new Set<string>();

export async function runScreening(job: JobRecord): Promise<ScreeningRun> {
  const existing = store.run(job.id);
  if (existing?.running && inFlight.has(job.id)) return existing;

  const eligible = store
    .resumes()
    .filter((r) => r.stage === "complete" && r.parsed);
  const run: ScreeningRun = {
    jobId: job.id,
    startedAt: new Date().toISOString(),
    total: eligible.length,
    scored: 0,
    aiAnalyzed: 0,
    running: true,
  };
  store.saveRun(run);
  inFlight.add(job.id);

  // Kick off in the background: the UI polls the run for progress.
  void (async () => {
    try {
      const matches = await screen(job, eligible, ({ scored, aiAnalyzed }) => {
        store.saveRun({ ...run, scored, aiAnalyzed, running: true });
      });
      store.clearMatches(job.id);
      for (const match of matches) store.saveMatch(match);
      store.saveRun({
        ...run,
        scored: matches.length,
        aiAnalyzed: matches.filter((m) => m.aiAnalyzed).length,
        running: false,
        finishedAt: new Date().toISOString(),
      });
    } catch (error) {
      store.saveRun({
        ...run,
        running: false,
        finishedAt: new Date().toISOString(),
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      inFlight.delete(job.id);
    }
  })();

  return run;
}

function initialsOf(name: string) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "??";
  const first = parts[0]![0] ?? "";
  const last =
    parts.length > 1 ? (parts.at(-1)![0] ?? "") : (parts[0]![1] ?? "");
  return `${first}${last}`.toUpperCase();
}

function toCandidate(resume: ResumeRecord, match: MatchRecord): Candidate {
  const parsed = resume.parsed!;
  const name = parsed.name?.trim() || resume.fileName.replace(/\.[^.]+$/, "");
  const years = parsed.totalYearsExperience ?? 0;
  const education = parsed.education[0];

  return {
    id: resume.id,
    rank: 0,
    // Contact is always populated here; blind mode hides it client-side. The AI
    // pass never sees it — matching feeds the LLM the PII-stripped projection.
    contact: {
      name,
      email: parsed.email ?? "—",
      phone: parsed.phone ?? "—",
      location: parsed.location ?? "—",
      links: parsed.links,
    },
    initials: initialsOf(name),
    title: parsed.title || parsed.experience[0]?.title || "Not stated",
    years: Math.round(years * 10) / 10,
    level: levelFromYears(years),
    // The heuristic parser can put the same line in degree and institution when
    // it cannot tell them apart, so drop repeats before joining.
    education: education
      ? [
          ...new Set(
            [education.degree, education.field, education.institution]
              .map((part) => part?.trim())
              .filter((part): part is string => Boolean(part)),
          ),
        ].join(", ")
      : "Not stated",
    fileName: resume.fileName,
    score: match.score,
    categories: match.categories,
    signals: match.signals,
    skills: parsed.skills.map((s) => s.name),
    strengths: match.strengths,
    gaps: match.gaps,
    transferable: match.transferable,
    evidence: match.evidence,
    requirements: match.requirements,
    mustHaves: match.mustHaves,
    summary: match.summary,
    aiAnalyzed: match.aiAnalyzed,
  };
}

export function candidatesFor(jobId: string): Candidate[] {
  const matches = store.matches(jobId);
  const list: Candidate[] = [];
  for (const resume of store.resumes()) {
    const match = matches[resume.id];
    if (resume.stage === "complete" && resume.parsed && match) {
      list.push(toCandidate(resume, match));
    }
  }
  return list;
}
