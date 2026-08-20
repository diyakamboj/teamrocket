import { AlertTriangle, Check, ShieldAlert } from "lucide-react";
import type { FraudAssessment, FraudStatus } from "@/lib/fraud-data";
import { cn } from "@/lib/utils";

const STATUS_META: Record<
  FraudStatus,
  {
    label: string;
    badgeClass: string;
    iconClass: string;
    Icon: typeof Check;
  }
> = {
  verified: {
    label: "Verified",
    badgeClass: "bg-success/10 text-success dark:bg-success/15 dark:text-success",
    iconClass: "bg-success text-white",
    Icon: Check,
  },
  fraud: {
    label: "Fraud",
    badgeClass: "bg-destructive/10 text-destructive dark:bg-destructive/15 dark:text-destructive",
    iconClass: "bg-destructive text-white",
    Icon: ShieldAlert,
  },
  suspicious: {
    label: "Suspicious",
    badgeClass: "bg-warning/10 text-warning dark:bg-warning/15 dark:text-warning",
    iconClass: "bg-warning text-white",
    Icon: AlertTriangle,
  },
};

type FraudOrbitProps = {
  nodes: FraudAssessment[];
  className?: string;
};

export function FraudOrbit({ nodes, className }: FraudOrbitProps) {
  const items = nodes.slice(0, 4);

  return (
    <div
      className={cn(
        "fraud-orbit-stage relative mx-auto aspect-square w-full max-w-[560px] overflow-hidden rounded-3xl border",
        className,
      )}
    >
      <div className="fraud-orbit-grid absolute inset-0" aria-hidden />

      {/* Static dashed orbital path */}
      <div
        className="pointer-events-none absolute left-1/2 top-1/2 z-10 h-[66%] w-[66%] -translate-x-1/2 -translate-y-1/2 rounded-full border border-dashed border-neutral-300 dark:border-neutral-600"
        aria-hidden
      />

      {/* Center brand hub */}
      <div className="absolute left-1/2 top-1/2 z-30 grid h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border border-border bg-white shadow-[var(--shadow-soft)] dark:bg-card sm:h-[132px] sm:w-[132px]">
        <div className="text-center">
          <p className="text-xl font-black tracking-tight text-foreground sm:text-2xl">
            resume<span className="text-primary">iq</span>
            <span className="text-primary">.</span>
          </p>
          <p className="mt-0.5 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            verify
          </p>
        </div>
      </div>

      {/* Rotating ring */}
      <div className="fraud-orbit-ring absolute inset-0 z-20">
        {items.map((item, index) => {
          const meta = STATUS_META[item.status];
          const angle = index * 90;
          return (
            <div
              key={item.candidate.id}
              className="absolute left-1/2 top-1/2"
              style={{
                transform: `rotate(${angle}deg) translateY(clamp(-200px, -34%, -150px))`,
              }}
            >
              <div
                className="fraud-orbit-counter flex flex-col items-center gap-2"
                style={{ ["--spoke-offset" as string]: `${-angle}deg` }}
              >
                <div className="relative">
                  <div className="grid h-16 w-16 place-items-center overflow-hidden rounded-full border-[3px] border-white bg-primary-soft text-sm font-bold text-primary-soft-foreground shadow-[var(--shadow-lift)] dark:border-card sm:h-[72px] sm:w-[72px]">
                    {item.candidate.initials}
                  </div>
                  <span
                    className={cn(
                      "absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full shadow-sm ring-2 ring-white dark:ring-card",
                      meta.iconClass,
                    )}
                  >
                    <meta.Icon className="h-3.5 w-3.5" strokeWidth={2.5} />
                  </span>
                </div>
                <span
                  className={cn(
                    "rounded-full px-3 py-1 text-xs font-semibold shadow-sm",
                    meta.badgeClass,
                  )}
                >
                  {meta.label}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
