import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Candidate ids now come from the backend store and are real UUIDs. This
 * guard stays as a defence for ids arriving from anywhere else (URL params,
 * restored sessions): endpoints expecting a backend candidate id 422/404 on
 * anything that is not a UUID. Use it before making such calls.
 */
export function isBackendUuid(id: string | null | undefined): id is string {
  return !!id && UUID_RE.test(id);
}
