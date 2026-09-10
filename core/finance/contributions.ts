import { addMonthsPreservingEnd, calculateFinancialYear, parseIsoDate, toIsoDate } from "@/core/finance/calculations";
import type { ContributionEntry, ContributionFrequency, ContributionTerms } from "@/core/models/financial";

/**
 * Money going in, on a schedule — a SIP instalment or an insurance premium.
 *
 * Kept apart from the payout schedule rather than folded into it with a
 * direction flag. Every total the app already reports — interest received,
 * expected TDS, net payout — reduces over that schedule, and a row of the
 * opposite sign sitting in it would quietly corrupt all of them.
 *
 * The distinction that matters here is not "did the issuer pay" but "did I
 * pay": a missed premium lapses a policy, which is the whole reason these are
 * tracked instalment by instalment rather than as a standing instruction.
 */

/** Long enough for a thirty-year policy paid monthly, and no longer. */
const MAX_CONTRIBUTIONS = 400;

const MONTHS: Record<ContributionFrequency, number> = {
  monthly: 1,
  quarterly: 3,
  "half-yearly": 6,
  yearly: 12,
  single: 0,
};

export function contributionMonths(frequency: ContributionFrequency) {
  return MONTHS[frequency];
}

export function generateContributionSchedule(terms: ContributionTerms): ContributionEntry[] {
  const { contributionPaise, contributionFrequency, contributionStartDate, contributionEndDate } = terms;
  if (!contributionPaise || contributionPaise <= 0n) return [];
  if (!contributionFrequency || !contributionStartDate) return [];

  const start = parseIsoDate(contributionStartDate);
  const months = MONTHS[contributionFrequency];

  // A single premium is one row, so the policy still shows whether it was paid.
  if (!months) return [entry(contributionStartDate, contributionPaise, 1)];

  // Open-ended by nature: a SIP with no end date is still a real instruction,
  // so a horizon is projected rather than refusing to show anything. Ten years
  // is far enough to plan against and short enough to stay honest.
  const end = contributionEndDate
    ? parseIsoDate(contributionEndDate)
    : addMonthsPreservingEnd(start, 120);

  const rows: ContributionEntry[] = [];
  let cursor = start;
  while (cursor.getTime() <= end.getTime() && rows.length < MAX_CONTRIBUTIONS) {
    rows.push(entry(toIsoDate(cursor), contributionPaise, rows.length + 1));
    cursor = addMonthsPreservingEnd(cursor, months);
  }
  return rows;
}

function entry(dueDate: string, amountPaise: bigint, index: number): ContributionEntry {
  return {
    id: `contribution-${index}`,
    dueDate,
    financialYear: calculateFinancialYear(dueDate),
    amountPaise,
    status: "upcoming",
  };
}

/**
 * What has actually gone in so far, and what was promised for the year.
 * Only paid rows count towards invested — a due instalment is not money in.
 */
export function contributionTotals(entries: ContributionEntry[], financialYear?: string) {
  const scoped = financialYear ? entries.filter((row) => row.financialYear === financialYear) : entries;
  return {
    scheduled: scoped.reduce((sum, row) => sum + row.amountPaise, 0n),
    paid: scoped.reduce((sum, row) => sum + (row.paidAmountPaise ?? 0n), 0n),
    paidCount: scoped.filter((row) => row.paidAmountPaise !== undefined).length,
    missed: scoped.filter((row) => row.status === "missed" || row.status === "overdue").length,
  };
}
