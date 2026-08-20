import { Building2, Globe } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Whether a person is an employee or an outside applicant.
 *
 * The two are handled completely differently — internal people can be
 * benched and matched to internal moves, external ones go through the
 * applicant funnel — so which one you are looking at should never be a
 * guess.
 */
export function SourceBadge({
  source,
  currentAssignment,
  onBench,
  className,
}: {
  source?: string | null;
  /** Their role in the company right now. Internal people only. */
  currentAssignment?: string | null;
  onBench?: boolean;
  className?: string;
}) {
  const internal = source === "internal";
  const detail = internal
    ? onBench
      ? "On the bench — available now"
      : currentAssignment
        ? `Currently on ${currentAssignment}`
        : "Currently assigned"
    : "External applicant";

  return (
    <span
      title={detail}
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold",
        internal
          ? "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
          : "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
        className,
      )}
    >
      {internal ? <Building2 className="h-2.5 w-2.5" /> : <Globe className="h-2.5 w-2.5" />}
      {internal ? "Internal" : "External"}
    </span>
  );
}

/**
 * An internal person's current role in the company, as a button.
 *
 * Reads as an action because it is one: clicking it is how you get to their
 * assignment, and for a bench person it is the thing a recruiter is actually
 * looking for.
 */
export function CurrentRoleButton({
  currentAssignment,
  onBench,
  onClick,
  className,
}: {
  currentAssignment?: string | null;
  onBench?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  const label = onBench ? "On the bench" : currentAssignment || "Assigned — role not recorded";
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        onBench
          ? "Between assignments and available now"
          : `Their current role in the company: ${label}`
      }
      className={cn(
        "inline-flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-medium transition-colors",
        onBench
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-300"
          : "hover:border-primary hover:bg-primary/5",
        className,
      )}
    >
      <Building2 className="h-3 w-3" />
      {label}
    </button>
  );
}
