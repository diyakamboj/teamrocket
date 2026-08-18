import { cn } from "@/lib/utils";

export function OriginBadge({ origin }: { origin: "internal" | "external" }) {
  return (
    <span
      className={cn(
        "inline-flex rounded-full px-2 py-0.5 text-[10px] font-semibold",
        origin === "internal"
          ? "bg-primary-soft text-primary-soft-foreground"
          : "bg-secondary text-muted-foreground",
      )}
    >
      {origin === "internal" ? "Internal" : "External"}
    </span>
  );
}
