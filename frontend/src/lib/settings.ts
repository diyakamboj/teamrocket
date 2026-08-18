/**
 * Recruiter preferences, persisted in localStorage.
 *
 * Only preferences live here. Company context documents themselves are NOT
 * stored in the browser — they are uploaded to the backend, which puts the
 * file in blob storage and runs AI extraction over it. This keeps just the
 * attachment ids so the Settings page can re-hydrate each document's real
 * status and AI-extracted summary from the API on load.
 */

import { DEFAULT_WEIGHTS, type Weights } from "./candidates";

export type CopilotModelConfig = {
  /** Must be an id from GET /api/agent/models — validated against it on load. */
  modelId: string;
  temperature: number;
  reasoningEffort: "low" | "medium" | "high";
  systemPromptAddendum: string;
};

export type CompanyDocCategory = "vision" | "values" | "culture" | "guidelines";

/** Local index entry pointing at a document held in backend blob storage. */
export type CompanyDocRef = {
  attachmentId: string;
  category: CompanyDocCategory;
};

export type RecruiterSettings = {
  recruiterName: string;
  recruiterEmail: string;
  department: string;
  emailSignature: string;
  copilotConfig: CopilotModelConfig;
  companyDocs: CompanyDocRef[];
  defaultWeights: Weights;
};

const STORAGE_KEY = "resumeiq_settings";

const DEFAULT_SETTINGS: RecruiterSettings = {
  recruiterName: "",
  recruiterEmail: "",
  department: "",
  emailSignature: "",
  copilotConfig: {
    modelId: "gpt-4o",
    temperature: 0.2,
    reasoningEffort: "medium",
    systemPromptAddendum: "",
  },
  companyDocs: [],
  defaultWeights: DEFAULT_WEIGHTS,
};

export function getRecruiterSettings(): RecruiterSettings {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<RecruiterSettings>;
        // Merge over defaults so settings saved by an older build (missing
        // newly added keys) don't render undefined into inputs.
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          copilotConfig: { ...DEFAULT_SETTINGS.copilotConfig, ...parsed.copilotConfig },
          defaultWeights: { ...DEFAULT_SETTINGS.defaultWeights, ...parsed.defaultWeights },
          companyDocs: Array.isArray(parsed.companyDocs) ? parsed.companyDocs : [],
        };
      }
    }
  } catch {
    // Corrupt or unavailable storage — fall through to defaults.
  }
  return DEFAULT_SETTINGS;
}

export function saveRecruiterSettings(settings: RecruiterSettings): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  }
}
