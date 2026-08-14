import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Some pages still source rows from the pre-existing mock dataset
 * (lib/mock-data.ts), whose ids aren't real backend UUIDs. Only a real UUID
 * can be sent to endpoints that expect a backend candidate id (the backend
 * 422s/404s otherwise). Use this guard before making such calls.
 */
export function isBackendUuid(id: string | null | undefined): id is string {
  return !!id && UUID_RE.test(id);
}
