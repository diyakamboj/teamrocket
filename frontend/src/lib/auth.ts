export type UserSession = {
  email: string;
  name: string;
  role: string;
  department: string;
  isAuthenticated: boolean;
};

const DEFAULT_SESSION: UserSession = {
  email: "alex.recruiter@example.com",
  name: "Alex Smith",
  role: "Senior Technical Recruiter",
  department: "Talent Acquisition",
  isAuthenticated: true,
};

export function getSession(): UserSession {
  try {
    if (typeof window !== "undefined" && window.localStorage) {
      const raw = localStorage.getItem("resumeiq_session");
      if (raw) return JSON.parse(raw);
    }
  } catch (e) {
    // fallback
  }
  return DEFAULT_SESSION;
}

export function setSession(session: UserSession): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.setItem("resumeiq_session", JSON.stringify(session));
  }
}

export function logoutSession(): void {
  if (typeof window !== "undefined" && window.localStorage) {
    localStorage.removeItem("resumeiq_session");
  }
}

