import { parseIsoDate, toIsoDate } from "@/core/finance/calculations";

/**
 * Turning what was read off a document into what the form should hold.
 *
 * Kept out of the form itself so it can be tested against real paperwork. Both
 * rules here were got wrong by reasoning that only holds for a plain bullet
 * bond, and neither failure was visible until a real statement disagreed.
 */

export type ScheduleRow = { dueDate: string; interestPaise: number; principalPaise: number };

/**
 * What actually arrives on the maturity date.
 *
 * A bond that repays everything at the end pays back its face value, which is
 * why that was the fallback. A bond that amortises does not: it has already
 * returned most of the principal by then, and only the last instalment is
 * left. Assuming face value overstated such a maturity several times over.
 *
 * The document's own schedule settles it whenever there is one — the final row
 * is the answer, whatever shape the bond is.
 */
export function maturityAmountFromScan(input: {
  scheduleRows?: ScheduleRow[];
  expectedMaturityPaise?: number;
  faceValuePaise?: number;
  amountPaidPaise?: number;
  payoutFrequency?: string | null;
  interestType?: string | null;
}): number | null {
  if (typeof input.expectedMaturityPaise === "number") return input.expectedMaturityPaise;

  const rows = input.scheduleRows ?? [];
  if (rows.length) {
    const last = [...rows].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).at(-1)!;
    return last.principalPaise + last.interestPaise;
  }

  // No schedule to read. Only a bond that pays its interest out along the way
  // and repays in one go can have its maturity inferred at all.
  const repaysAtEnd = input.payoutFrequency && input.payoutFrequency !== "on-maturity" && input.interestType !== "cumulative";
  if (!repaysAtEnd) return null;
  return input.faceValuePaise ?? input.amountPaidPaise ?? null;
}

/**
 * The date interest began accruing, worked back from what was paid for it.
 *
 * Stepping one period back from the first payout assumes every period is a
 * full one. A bond issued mid-month but paying on the 1st opens with a stub —
 * on a real statement, 37 days rather than 30 — and stepping back landed a
 * week late, which then mis-stated the whole first coupon.
 *
 * The accrued interest on the deal sheet says exactly how long the seller held
 * it: divide by the daily coupon and count back from settlement. That is two
 * printed numbers and a division, not a guess.
 */
export function interestStartFromAccrued(input: {
  accruedInterestPaise: number;
  interestBasePaise: number;
  annualRateBps: number;
  settlementDate: string;
}): string | null {
  const { accruedInterestPaise, interestBasePaise, annualRateBps, settlementDate } = input;
  if (accruedInterestPaise <= 0 || interestBasePaise <= 0 || annualRateBps <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) return null;

  const dailyPaise = (interestBasePaise * annualRateBps) / 10_000 / 365;
  if (dailyPaise <= 0) return null;
  const days = Math.round(accruedInterestPaise / dailyPaise);

  // A coupon period is at most a year; anything longer means the numbers do
  // not belong together and a wrong date is worse than none.
  if (days < 1 || days > 366) return null;

  const settlement = parseIsoDate(settlementDate);
  return toIsoDate(new Date(settlement.getTime() - days * 86_400_000));
}
