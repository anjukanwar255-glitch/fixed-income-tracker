import { addMonthsPreservingEnd, parseIsoDate, toIsoDate } from "@/core/finance/calculations";
import type { PortfolioInvestment } from "@/core/models/financial";

/**
 * What the portfolio pays out, month by month, and what it is actually earning.
 *
 * The payout list answers "what is due next"; this answers the two questions it
 * cannot — how the money lands across the months ahead, and what rate the whole
 * thing is really returning once the dates are taken into account.
 */

export type CashflowMonth = {
  /** First day of the month, as YYYY-MM-01. */
  month: string;
  label: string;
  expectedPaise: bigint;
  receivedPaise: bigint;
  count: number;
};

/**
 * The first month of a financial year, from the label the app uses for it.
 *
 * The label carries its own "FY " prefix, so it cannot be sliced into: taking
 * the first four characters yields "FY 2", and a date built from that is not
 * wrong so much as meaningless.
 */
export function financialYearStart(financialYear: string) {
  const year = financialYear.match(/(\d{4})/)?.[1];
  return year ? `${year}-04-01` : null;
}

/** The months from `startMonth`, whether or not anything falls in them. */
export function monthlyCashflow(investments: PortfolioInvestment[], startMonth: string, months: number): CashflowMonth[] {
  const start = parseIsoDate(startMonth.slice(0, 7) + "-01");
  const buckets = new Map<string, CashflowMonth>();

  for (let index = 0; index < months; index += 1) {
    const date = addMonthsPreservingEnd(start, index);
    const month = toIsoDate(date).slice(0, 7) + "-01";
    buckets.set(month, {
      month,
      label: new Intl.DateTimeFormat("en-IN", { month: "short", timeZone: "UTC" }).format(date),
      expectedPaise: 0n,
      receivedPaise: 0n,
      count: 0,
    });
  }

  for (const investment of investments) {
    for (const payout of investment.schedule) {
      const month = payout.dueDate.slice(0, 7) + "-01";
      const bucket = buckets.get(month);
      if (!bucket) continue;
      bucket.expectedPaise += payout.expectedNetPaise;
      bucket.receivedPaise += payout.receivedAmountPaise ?? 0n;
      bucket.count += 1;
    }
  }

  return [...buckets.values()];
}

/**
 * The annualised return the portfolio is actually making.
 *
 * A plain average of the coupon rates would be wrong twice over: it ignores how
 * much is in each holding, and it ignores when the money comes back. A rupee
 * returned next month is worth more than the same rupee in 2028, and that is
 * the whole difference between a coupon and a real return.
 *
 * Solved by bisection rather than Newton's method. Newton is faster but can
 * walk off a badly-shaped curve entirely; bisection cannot, and a wrong rate
 * shown confidently is worse than a slow one.
 */
export function annualisedReturn(flows: { date: string; amountPaise: bigint }[]): number | null {
  if (flows.length < 2) return null;
  const ordered = [...flows].sort((left, right) => left.date.localeCompare(right.date));
  const hasOut = ordered.some((flow) => flow.amountPaise < 0n);
  const hasIn = ordered.some((flow) => flow.amountPaise > 0n);
  // Without money going both ways there is no rate to find, only a direction.
  if (!hasOut || !hasIn) return null;

  const base = parseIsoDate(ordered[0].date).getTime();
  const years = ordered.map((flow) => (parseIsoDate(flow.date).getTime() - base) / 31_557_600_000);
  const amounts = ordered.map((flow) => Number(flow.amountPaise) / 100);

  const presentValue = (rate: number) => amounts.reduce(
    (sum, amount, index) => sum + amount / Math.pow(1 + rate, years[index]),
    0,
  );

  let low = -0.9999;
  let high = 10;
  let atLow = presentValue(low);
  if (!Number.isFinite(atLow) || atLow * presentValue(high) > 0) return null;

  for (let step = 0; step < 200; step += 1) {
    const mid = (low + high) / 2;
    const atMid = presentValue(mid);
    if (!Number.isFinite(atMid)) return null;
    if (Math.abs(atMid) < 0.5 || high - low < 1e-7) return mid;
    if (atLow * atMid < 0) {
      high = mid;
    } else {
      low = mid;
      atLow = atMid;
    }
  }
  return (low + high) / 2;
}

/**
 * The portfolio as a series of cash flows: what went out to buy each holding,
 * and what each payout brings back.
 *
 * A payout already received is dated when it arrived; one still due is dated
 * when it is owed. Closed holdings are left out — their rate is settled and
 * folding it in would misstate what is running now.
 */
export function portfolioFlows(investments: PortfolioInvestment[]) {
  const flows: { date: string; amountPaise: bigint }[] = [];
  for (const investment of investments) {
    if (investment.status === "closed") continue;
    flows.push({ date: investment.investmentDate, amountPaise: -investment.principalPaise });
    for (const payout of investment.schedule) {
      const amount = payout.receivedAmountPaise ?? payout.expectedNetPaise;
      if (amount === 0n) continue;
      flows.push({ date: payout.receivedDate ?? payout.dueDate, amountPaise: amount });
    }
  }
  return flows;
}
