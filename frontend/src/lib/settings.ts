/**
 * Recruiter preferences, persisted in localStorage.
 *
 * Only preferences that actually take effect live here. Company context
 * documents are NOT stored in the browser — they belong to the backend,
 * scoped to the recruiter who uploaded them, and the Settings page reads them
 * from `/api/company-documents`. Keeping ids here previously meant a cleared
 * localStorage silently "lost" documents that were still in storage.
 *
 * Copilot model/temperature/reasoning settings used to live here too. Nothing
 * read them — the deployment decides the model and `AZURE_OPENAI_REASONING_EFFORT`
 * decides the effort — so they were controls that appeared to do something and
 * did not.
 */

import { DEFAULT_WEIGHTS, type Weights } from "./candidates";
import { getSession } from "./auth";

export type CompanyDocCategory = "vision" | "values" | "culture" | "guidelines";

export type RecruiterSettings = {
  recruiterName: string;
  recruiterEmail: string;
  department: string;
  emailSignature: string;
  defaultWeights: Weights;
};

const STORAGE_KEY = "resumeiq_settings";

/** Identity comes from the signed-in session, so the form is never blank. */
function defaults(): RecruiterSettings {
  const session = getSession();
  return {
    recruiterName: session?.name ?? "",
    recruiterEmail: session?.email ?? "",
    department: session?.department ?? "",
    emailSignature: session
      ? `${session.name}\n${session.role}\n${session.department}`
      : "",
    defaultWeights: DEFAULT_WEIGHTS,
  };
}

export function getRecruiterSettings(): RecruiterSettings {
  const base = defaults();
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<RecruiterSettings>;
        // Merge over the session-derived defaults, so a value the recruiter
        // cleared stays cleared but anything never set is prefilled.
        return {
          ...base,
          ...parsed,
          defaultWeights: { ...base.defaultWeights, ...parsed.defaultWeights },
        };
      }
    }
  } catch {
    // Corrupt or unavailable storage — fall through to defaults.
  }
  return base;
}

export function saveRecruiterSettings(settings: RecruiterSettings): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}
