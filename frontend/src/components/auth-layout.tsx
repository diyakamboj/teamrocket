import { Link } from "@tanstack/react-router";
import { BadgeCheck, FileSearch, ShieldCheck, Sparkles } from "lucide-react";
import { ProductName } from "@/components/product-name";
import { cn } from "@/lib/utils";

const POINTS = [
  { icon: FileSearch, text: "Every score traces back to a line in the résumé" },
  { icon: BadgeCheck, text: "Standard status flags across your whole pool" },
  { icon: ShieldCheck, text: "Your data stays in your own Azure storage" },
];

/**
 * Shared frame for sign-in and registration: the form on the left, a quiet
 * summary of what the product does on the right. The right panel is hidden
 * below `lg` so the form gets the full screen on a phone.
 */
export function AuthLayout({
  title,
  subtitle,
  children,
  footer,
  leaving = false,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  footer: React.ReactNode;
  /** True once the credentials are accepted: the panels launch toward the
   *  app so signing in reads as movement rather than a blink. */
  leaving?: boolean;
}) {
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10">
        <div className="animate-aurora absolute -left-32 -top-32 h-[30rem] w-[30rem] rounded-full bg-primary/20 blur-3xl" />
        <div
          className="animate-aurora absolute -bottom-40 right-0 h-[26rem] w-[26rem] rounded-full bg-primary/15 blur-3xl"
          style={{ animationDelay: "-8s" }}
        />
      </div>

      <div className="mx-auto grid min-h-screen max-w-6xl items-center gap-10 px-6 py-10 lg:grid-cols-2">
        <div className={cn("mx-auto w-full max-w-md", leaving ? "auth-launch" : "animate-rise")}>
          <Link to="/welcome" className="mb-8 inline-flex items-center gap-2.5">
            <span className="grid h-9 w-9 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
              <Sparkles className="h-4.5 w-4.5" />
            </span>
            <span className="text-sm tracking-tight">
              <ProductName />
            </span>
          </Link>

          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm text-muted-foreground">{subtitle}</p>

          <div className="mt-8">{children}</div>

          <div className="mt-6 text-center text-xs text-muted-foreground">{footer}</div>
        </div>

        <div
          className={cn("hidden lg:block", leaving ? "auth-launch" : "animate-fade")}
          style={leaving ? { animationDelay: "0.05s" } : { animationDelay: "0.15s" }}
        >
          <div className="lift rounded-3xl border bg-card/70 p-8 backdrop-blur">
            <p className="text-xs font-bold uppercase tracking-wider text-primary">
              AI-powered hiring
            </p>
            <p className="mt-3 text-lg font-semibold leading-snug">
              One person can review many candidates. AI validates, scores, and guides the questions.
            </p>
            <ul className="stagger mt-7 space-y-4">
              {POINTS.map(({ icon: Icon, text }) => (
                <li key={text} className="flex items-start gap-3">
                  <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-3.5 w-3.5" />
                  </span>
                  <span className="text-sm text-muted-foreground">{text}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
