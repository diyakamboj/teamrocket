/** One ATS score, with a plain-language tier and pass/fail-style verdict. */

export type AtsTier = "poor" | "average" | "good" | "excellent";
export type AtsVerdict = "fail" | "review" | "pass";

export function atsTier(score: number): AtsTier {
  if (score >= 80) return "excellent";
  if (score >= 65) return "good";
  if (score >= 50) return "average";
  return "poor";
}

export function atsVerdict(score: number): AtsVerdict {
  const tier = atsTier(score);
  if (tier === "excellent" || tier === "good") return "pass";
  if (tier === "average") return "review";
  return "fail";
}

export function atsTierLabel(score: number): string {
  return { poor: "Poor", average: "Average", good: "Good", excellent: "Excellent" }[atsTier(score)];
}

export function atsVerdictLabel(score: number): string {
  return { fail: "Fail", review: "Review", pass: "Pass" }[atsVerdict(score)];
}

export function atsToneClass(score: number): string {
  const tier = atsTier(score);
  if (tier === "excellent") return "border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (tier === "good") return "border-sky-500/30 bg-sky-500/15 text-sky-700 dark:text-sky-300";
  if (tier === "average") return "border-amber-500/40 bg-amber-500/15 text-amber-800 dark:text-amber-200";
  return "border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300";
}
