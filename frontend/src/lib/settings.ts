export type CopilotModelConfig = {
  modelId: "gpt-4o" | "gpt-4o-mini" | "gpt-4.1";
  temperature: number;
  reasoningEffort: "low" | "medium" | "high";
  systemPromptAddendum: string;
};

export type CompanyDoc = {
  id: string;
  filename: string;
  uploadedAt: string;
  category: "vision" | "values" | "culture" | "guidelines";
  summary: string;
};

export type RecruiterSettings = {
  recruiterName: string;
  recruiterEmail: string;
  department: string;
  emailSignature: string;
  copilotConfig: CopilotModelConfig;
  companyDocs: CompanyDoc[];
  defaultWeights: {
    skills: number;
    experience: number;
    education: number;
    certifications: number;
    projects: number;
  };
};

const DEFAULT_SETTINGS: RecruiterSettings = {
  recruiterName: "Alex Smith",
  recruiterEmail: "alex.recruiter@example.com",
  department: "Talent Acquisition",
  emailSignature: "Best regards,\nAlex Smith | Senior Talent Acquisition Partner\nResumeIQ Recruiting System",
  copilotConfig: {
    modelId: "gpt-4o",
    temperature: 0.2,
    reasoningEffort: "medium",
    systemPromptAddendum: "Prioritize strong technical depth and proven cloud deployment experience. Align candidates against organizational core values.",
  },
  companyDocs: [
    {
      id: "doc_1",
      filename: "Company_Core_Values_2026.pdf",
      uploadedAt: "2026-08-01",
      category: "values",
      summary: "Innovation, Customer Obsession, Ownership, and Technical Rigor.",
    },
    {
      id: "doc_2",
      filename: "Engineering_Culture_Principles.pdf",
      uploadedAt: "2026-08-10",
      category: "culture",
      summary: "Automate routine tasks, foster collaborative code reviews, prioritize scalable cloud architectures.",
    },
  ],
  defaultWeights: {
    skills: 35,
    experience: 25,
    education: 15,
    certifications: 10,
    projects: 15,
  },
};

export function getRecruiterSettings(): RecruiterSettings {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = localStorage.getItem("resumeiq_settings");
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    // fallback
  }
  return DEFAULT_SETTINGS;
}

export function saveRecruiterSettings(settings: RecruiterSettings): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem("resumeiq_settings", JSON.stringify(settings));
  }
}

