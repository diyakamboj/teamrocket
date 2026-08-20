import { cn } from "@/lib/utils";

/** Product name, always bold — use this anywhere ResumeIQ appears in the UI. */
export function ProductName({ className }: { className?: string }) {
  return <strong className={cn("font-bold tracking-tight", className)}>ResumeIQ</strong>;
}
