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

/**
 * Browser-local *preferences* only.
 *
 * Identity (name, email, department) deliberately does not live here any
 * more. It was merged over the session, so a value saved once won
 * permanently — including after signing in as somebody else, which is how
 * one account ended up displaying another recruiter's name and address on
 * outgoing candidate emails. Identity is account data and is read from, and
 * written to, the account itself.
 */
export type RecruiterSettings = {
  emailSignature: string;
  defaultWeights: Weights;
};

function storageKey(): string {
  // Scoped to the account. A shared key meant one recruiter's saved
  // preferences showed up for the next person to sign in on that machine.
  const session = getSession();
  return session?.email ? `resumeiq_settings:${session.email}` : "resumeiq_settings";
}

/** Signature is seeded from the session so the field is never blank. */
function defaults(): RecruiterSettings {
  const session = getSession();
  return {
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
      const raw = localStorage.getItem(storageKey());
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
    localStorage.setItem(storageKey(), JSON.stringify(settings));
  }
}
