import type { LucideIcon } from "lucide-react";
import { Link } from "@tanstack/react-router";

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; to: string } | { label: string; onClick: () => void };
  className?: string;
}) {
  return (
    <div
      className={`card-surface flex flex-col items-center justify-center gap-3 px-6 py-12 text-center ${className ?? ""}`}
    >
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-soft text-primary-soft-foreground">
        <Icon className="h-6 w-6" />
      </span>
      <div>
        <p className="text-base font-bold">{title}</p>
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      </div>
      {action && "to" in action ? (
        <Link
          to={action.to}
          className="mt-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {action.label}
        </Link>
      ) : action ? (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          {action.label}
        </button>
      ) : null}
    </div>
  );
}
