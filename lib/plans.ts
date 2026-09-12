export type PlanCode = "monthly" | "yearly" | "five-year" | "ten-year";

/**
 * What is on sale.
 *
 * Two shapes, not one. The short plans renew: Razorpay bills them on a
 * schedule and the app's access follows that schedule. The long ones are
 * bought outright — a single payment for a stated number of years, which is a
 * Razorpay order rather than a subscription, and a promise with an end date
 * rather than a bill that keeps arriving.
 *
 * `monthsCovered` is what makes them comparable: a discount only means
 * something against what the same span costs at the shortest plan.
 */
export const subscriptionPlans = [
  { code: "monthly" as const, label: "Monthly", amountPaise: 9_900, monthsCovered: 1, oneTime: false, period: "monthly", interval: 1, totalCount: 1_200 },
  { code: "yearly" as const, label: "Yearly", amountPaise: 99_900, monthsCovered: 12, oneTime: false, period: "yearly", interval: 1, totalCount: 100 },
  { code: "five-year" as const, label: "5 years", amountPaise: 399_900, monthsCovered: 60, oneTime: true, period: "yearly", interval: 1, totalCount: 1 },
  { code: "ten-year" as const, label: "10 years", amountPaise: 699_900, monthsCovered: 120, oneTime: true, period: "yearly", interval: 1, totalCount: 1 },
] as const;

export type Plan = (typeof subscriptionPlans)[number];

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

/** Bought outright rather than billed on a schedule. */
export function isOneTimePlan(code: PlanCode) {
  return subscriptionPlans.find((plan) => plan.code === code)?.oneTime ?? false;
}

/** When access bought outright runs out, from the moment it was paid for. */
export function oneTimeAccessEnd(code: PlanCode, boughtAt: Date) {
  const plan = subscriptionPlans.find((entry) => entry.code === code);
  if (!plan?.oneTime) return null;
  const end = new Date(boughtAt);
  end.setUTCMonth(end.getUTCMonth() + plan.monthsCovered);
  return end.toISOString();
}
