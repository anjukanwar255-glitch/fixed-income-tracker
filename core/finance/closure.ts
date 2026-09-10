import { calculateInterestForDates } from "@/core/finance/calculations";
import type { DayCountBasis, PayoutProjection } from "@/core/models/financial";

/**
 * Closing a holding before it matures, in whole or in part.
 *
 * Leaving part-way through a coupon period is the mirror of buying into one:
 * interest has been earned since the last payout and is owed on the way out.
 * The app already models that on the way in; this is the same arithmetic
 * pointed the other way.
 *
 * Part-closure is the ordinary case, not an edge case, and it is not measured
 * the same way everywhere: a bond is sold in units, a deposit is broken for an
 * amount. So nothing here is expressed in units — it takes the portion being
 * closed and the whole it is part of, in whatever the holding is counted in,
 * and works in the ratio between them.
 */

/**
 * Ratios are taken in integers to keep a part-closure exact. Fund units run to
 * three or four decimal places, so the portions are scaled before dividing
 * rather than trusted to floating point.
 */
const RATIO_SCALE = 10_000;

export type ClosurePosition = {
  /** Where this coupon period began: the last payout due, or the accrual start. */
  accrualFrom: string;
  /** Interest earned since then on the portion being closed. */
  accruedInterestPaise: bigint;
  /** What the portion still held is worth of the original principal. */
  remainingPrincipalPaise: bigint;
  remainingPortion: number;
  /** What the payouts still to come must be multiplied by. Zero on a full exit. */
  remainingRatio: number;
  /** Rows that no longer belong to the holder at all. */
  cancelledPayoutIds: string[];
  /** Rows that survive, reduced to the portion still held. */
  scaledPayoutIds: string[];
  fullExit: boolean;
};

export function closurePosition(input: {
  closureDate: string;
  /** Units sold, or rupees-in-paise withdrawn — whatever the holding counts in. */
  closedPortion: number;
  /** The whole it is part of, counted the same way. */
  heldPortion: number;
  schedule: PayoutProjection[];
  /** What interest is earned on — face value where it differs from the price. */
  interestBasePaise: bigint;
  /** What was put in, which a part-closure reduces proportionally. */
  principalPaise: bigint;
  annualRateBps: number;
  dayCountBasis?: DayCountBasis;
  /** Where interest began, for a closure before the first payout has landed. */
  interestStartDate: string;
}): ClosurePosition {
  const held = input.heldPortion > 0 ? input.heldPortion : 1;
  const closed = Math.min(Math.max(input.closedPortion, 0), held);
  const remainingPortion = held - closed;
  const fullExit = remainingPortion <= 0;

  const heldScaled = BigInt(Math.round(held * RATIO_SCALE));
  const closedScaled = BigInt(Math.round(closed * RATIO_SCALE));
  const remainingScaled = heldScaled - closedScaled;

  /*
   * Interest runs from the last payout that has already fallen due — not from
   * the last one recorded as received. A payout the issuer owes but has not
   * sent still ended its coupon period, and treating that period as unstarted
   * would count the same interest twice.
   */
  const past = input.schedule
    .filter((row) => row.dueDate <= input.closureDate)
    .map((row) => row.dueDate)
    .sort();
  const accrualFrom = past.at(-1) ?? input.interestStartDate;

  const accruedWhole = accrualFrom && accrualFrom < input.closureDate
    ? calculateInterestForDates(
      input.interestBasePaise,
      input.annualRateBps,
      accrualFrom,
      input.closureDate,
      input.dayCountBasis ?? "actual-365",
    )
    : 0n;

  const future = input.schedule.filter((row) => row.dueDate > input.closureDate);

  return {
    accrualFrom,
    accruedInterestPaise: heldScaled > 0n ? (accruedWhole * closedScaled) / heldScaled : 0n,
    remainingPrincipalPaise: heldScaled > 0n ? (input.principalPaise * remainingScaled) / heldScaled : 0n,
    remainingPortion,
    remainingRatio: remainingPortion / held,
    cancelledPayoutIds: fullExit ? future.map((row) => row.id) : [],
    scaledPayoutIds: fullExit || closed === 0 ? [] : future.map((row) => row.id),
    fullExit,
  };
}

/** A payout reduced to the portion still held. */
export function scalePayout(
  row: Pick<PayoutProjection, "grossInterestPaise" | "principalRepaidPaise" | "expectedTdsPaise">,
  remainingPortion: number,
  heldPortion: number,
) {
  const held = BigInt(Math.round((heldPortion > 0 ? heldPortion : 1) * RATIO_SCALE));
  const left = BigInt(Math.round(Math.max(remainingPortion, 0) * RATIO_SCALE));
  const scale = (value: bigint) => (value * left) / held;
  const gross = scale(row.grossInterestPaise);
  const principal = scale(row.principalRepaidPaise);
  const tds = scale(row.expectedTdsPaise);
  return {
    grossInterestPaise: gross,
    principalRepaidPaise: principal,
    expectedTdsPaise: tds,
    expectedNetPaise: gross - tds + principal,
  };
}

/**
 * Whether a holding has reached its maturity date.
 *
 * Derived rather than marked. Maturity is a date arriving, not a decision
 * anyone makes, and a holding whose date has passed should not sit waiting for
 * someone to press a button confirming it.
 */
export function hasMatured(investment: { maturityDate?: string; status: string }, today: string) {
  if (investment.status === "closed") return false;
  return Boolean(investment.maturityDate) && investment.maturityDate! <= today;
}
