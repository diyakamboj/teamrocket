export type OpsStatus = "healthy" | "degraded" | "critical" | "unknown";

export function getOpsStatusClass(status: OpsStatus): string {
  switch (status) {
    case "healthy":
      return "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30";
    case "degraded":
      return "bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/30";
    case "critical":
      return "bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/30";
    case "unknown":
    default:
      return "bg-secondary text-secondary-foreground border-border";
  }
}

export function getOpsStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}
