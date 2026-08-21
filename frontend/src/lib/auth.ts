/**
 * Recruiter session, backed by real credentials.
 *
 * The session used to be a hardcoded "Alex Smith" object returned whether or
 * not anyone had signed in. Now registering or signing in returns a token
 * from the backend, and that token is what proves who the user is — the
 * stored copy of the profile is only a cache so the shell can render without
 * waiting for a round-trip. `verifySession()` re-checks it against
 * `/api/auth/me`, so a stale or tampered localStorage entry cannot keep
 * anyone signed in.
 */

const STORAGE_KEY = "resumeiq_session";

const API_BASE =
  (import.meta.env["VITE_API_BASE_URL"] as string | undefined)?.replace(/\/$/, "") ?? "";

export type UserSession = {
  token: string;
  email: string;
  name: string;
  role: string;
  department: string;
  authProvider: string;
};

type AuthPayload = {
  token: string;
  user: {
    id: string;
    email: string;
    name: string;
    role: string;
    department: string;
    auth_provider: string;
  };
};

function store(payload: AuthPayload): UserSession {
  const session: UserSession = {
    token: payload.token,
    email: payload.user.email,
    name: payload.user.name,
    role: payload.user.role,
    department: payload.user.department,
    authProvider: payload.user.auth_provider,
  };
  if (typeof window !== "undefined") {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  }
  return session;
}

export function getSession(): UserSession | null {
  try {
    if (typeof window === "undefined") return null;
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<UserSession>;
    // A record without a token cannot be verified, so it is not a session.
    if (!parsed.token || !parsed.email) return null;
    return parsed as UserSession;
  } catch {
    return null;
  }
}

export function isSignedIn(): boolean {
  return getSession() !== null;
}

function errorFrom(response: Response, data: Record<string, unknown>): string {
  // Bracket access: these keys come from an index signature, which
  // noPropertyAccessFromIndexSignature requires be read explicitly.
  const fromBody =
    (typeof data["error"] === "string" && data["error"]) ||
    (typeof data["detail"] === "string" && data["detail"]);
  if (fromBody) return fromBody;
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return "Can't reach the API. Start the backend on port 8000 and try again.";
  }
  return "Something went wrong. Try again.";
}

async function post(path: string, body: unknown): Promise<AuthPayload> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new Error("Can't reach the API. Start the backend on port 8000 and try again.");
  }
  const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(errorFrom(response, data));
  }
  return data as unknown as AuthPayload;
}

export async function register(input: {
  email: string;
  password: string;
  name: string;
  role?: string;
  department?: string;
}): Promise<UserSession> {
  return store(await post("/api/auth/register", input));
}

export async function login(email: string, password: string): Promise<UserSession> {
  return store(await post("/api/auth/login", { email, password }));
}

/**
 * Finish "Sign in with Google": exchange the ID token Google Identity
 * Services handed the frontend for a real session. Works for both sign-in
 * and account creation — the backend links or creates the account by email,
 * so the same call serves the login and register pages.
 */
export async function loginWithGoogle(credential: string): Promise<UserSession> {
  return store(await post("/api/auth/google", { credential }));
}

/**
 * Finish a password reset, which signs you in.
 *
 * Goes through the same `store()` path as register and login so the session
 * is persisted identically — a reset that stored its session by hand would
 * be the one place the shape could drift.
 */
export async function completePasswordReset(
  token: string,
  newPassword: string,
): Promise<UserSession> {
  return store(await post("/api/auth/reset-password", { token, new_password: newPassword }));
}

/**
 * Confirm the stored token is still valid, refreshing the cached profile.
 * Returns null when the session is gone — the caller should send the user to
 * sign in. A network failure is *not* treated as signed-out, so a brief API
 * outage does not eject someone mid-task.
 */
export async function verifySession(): Promise<UserSession | null> {
  const session = getSession();
  if (!session) return null;
  try {
    const response = await fetch(`${API_BASE}/api/auth/me`, {
      headers: { Authorization: `Bearer ${session.token}` },
    });
    if (response.status === 401) {
      logoutSession();
      return null;
    }
    if (!response.ok) return session;
    const user = await response.json();
    return store({ token: session.token, user });
  } catch {
    return session;
  }
}

export function logoutSession(): void {
  const session = getSession();
  if (typeof window !== "undefined") {
    localStorage.removeItem(STORAGE_KEY);
  }
  if (session) {
    // Best effort: drop the token server-side too, so it cannot be replayed.
    void fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${session.token}` },
    }).catch(() => undefined);
  }
}

/** Identity header the rest of the API uses to scope a recruiter's data. */
export function recruiterEmail(): string {
  return (
    getSession()?.email ||
    (import.meta.env["VITE_RECRUITER_EMAIL"] as string | undefined) ||
    "recruiter@example.com"
  );
}
