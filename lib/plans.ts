export type PlanCode = "monthly" | "half-yearly" | "yearly";

export const subscriptionPlans = [
  { code: "monthly" as const, label: "Monthly", amountPaise: 9_900, monthsCovered: 1, period: "monthly", interval: 1, totalCount: 1_200 },
  { code: "half-yearly" as const, label: "6 months", amountPaise: 54_900, monthsCovered: 6, period: "monthly", interval: 6, totalCount: 200 },
  { code: "yearly" as const, label: "Yearly", amountPaise: 99_900, monthsCovered: 12, period: "yearly", interval: 1, totalCount: 100 },
] as const;

/**
 * What a longer plan saves against paying monthly for the same span, as a
 * whole percentage. Rounded down, so the number on screen is never more than
 * the saving actually is.
 */
export function planSavingPercent(plans: { code: PlanCode; amountPaise: number; monthsCovered: number }[], code: PlanCode) {
  const plan = plans.find((entry) => entry.code === code);
  const monthly = plans.find((entry) => entry.monthsCovered === 1);
  if (!plan || !monthly || plan.monthsCovered <= 1) return 0;
  const payingMonthly = monthly.amountPaise * plan.monthsCovered;
  if (payingMonthly <= plan.amountPaise) return 0;
  return Math.floor(((payingMonthly - plan.amountPaise) / payingMonthly) * 100);
}
