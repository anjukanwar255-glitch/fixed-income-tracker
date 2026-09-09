import type {
  CompoundingFrequency,
  DayCountBasis,
  InvestmentDraft,
  PayoutFrequency,
  PayoutProjection,
} from "@/core/models/financial";

const BASIS_POINTS = 10_000n;
const MONTHS_IN_YEAR = 12n;

export function divideRoundHalfUp(numerator: bigint, denominator: bigint) {
  if (denominator <= 0n) throw new Error("Denominator must be positive");
  return (numerator + denominator / 2n) / denominator;
}

export function calculateInterest(
  principalPaise: bigint,
  annualRateBps: number,
  periodMonths = 12,
) {
  if (principalPaise < 0n) throw new Error("Principal cannot be negative");
  if (annualRateBps < 0) throw new Error("Interest rate cannot be negative");
  return divideRoundHalfUp(
    principalPaise * BigInt(annualRateBps) * BigInt(periodMonths),
    BASIS_POINTS * MONTHS_IN_YEAR,
  );
}

/**
 * Calculates simple interest for an exact date range. The start date is
 * inclusive and the end date is exclusive, matching normal accrual practice.
 */
export function calculateInterestForDates(
  principalPaise: bigint,
  annualRateBps: number,
  startIso: string,
  endIso: string,
  basis: DayCountBasis = "actual-365",
) {
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(endIso);
  if (end.getTime() < start.getTime()) throw new Error("Accrual end cannot precede start");
  if (end.getTime() === start.getTime()) return 0n;

  if (basis === "30-360") {
    const days = days360(start, end);
    return divideRoundHalfUp(
      principalPaise * BigInt(annualRateBps) * BigInt(days),
      BASIS_POINTS * 360n,
    );
  }

  if (basis === "actual-actual") {
    let cursor = start;
    let interest = 0n;
    while (cursor.getTime() < end.getTime()) {
      const yearEnd = new Date(Date.UTC(cursor.getUTCFullYear() + 1, 0, 1));
      const segmentEnd = yearEnd.getTime() < end.getTime() ? yearEnd : end;
      const days = daysBetween(cursor, segmentEnd);
      const denominator = isLeapYear(cursor.getUTCFullYear()) ? 366n : 365n;
      interest += divideRoundHalfUp(
        principalPaise * BigInt(annualRateBps) * BigInt(days),
        BASIS_POINTS * denominator,
      );
      cursor = segmentEnd;
    }
    return interest;
  }

  return divideRoundHalfUp(
    principalPaise * BigInt(annualRateBps) * BigInt(daysBetween(start, end)),
    BASIS_POINTS * 365n,
  );
}

export function calculateTDS(grossInterestPaise: bigint, tdsRateBps: number) {
  if (grossInterestPaise < 0n) throw new Error("Gross interest cannot be negative");
  if (tdsRateBps < 0 || tdsRateBps > 10_000) {
    throw new Error("TDS rate must be between 0% and 100%");
  }
  return divideRoundHalfUp(
    grossInterestPaise * BigInt(tdsRateBps),
    BASIS_POINTS,
  );
}

export function calculateNetPayout(grossInterestPaise: bigint, tdsPaise: bigint) {
  return grossInterestPaise - tdsPaise;
}

export function calculateTDSDifference(expectedPaise: bigint, verifiedPaise: bigint) {
  return expectedPaise - verifiedPaise;
}

export function calculatePayoutDifference(expectedPaise: bigint, actualPaise: bigint) {
  return actualPaise - expectedPaise;
}

export function calculateFinancialYear(isoDate: string, startMonth = 4) {
  const date = parseIsoDate(isoDate);
  const calendarMonth = date.getUTCMonth() + 1;
  const startYear = calendarMonth >= startMonth
    ? date.getUTCFullYear()
    : date.getUTCFullYear() - 1;
  return `FY ${startYear}-${String(startYear + 1).slice(-2)}`;
}

export function generatePayoutSchedule(draft: InvestmentDraft): PayoutProjection[] {
  if (draft.payoutFrequency === "custom") return [];
  const months = frequencyMonths(draft.payoutFrequency);
  const maturity = parseIsoDate(draft.maturityDate);
  const first = draft.payoutFrequency === "on-maturity"
    ? maturity
    : parseIsoDate(draft.firstPayoutDate);
  const dates: Date[] = [];

  if (draft.payoutFrequency === "on-maturity") {
    dates.push(maturity);
  } else {
    let cursor = first;
    while (cursor.getTime() <= maturity.getTime() && dates.length < 600) {
      dates.push(cursor);
      cursor = addMonthsPreservingEnd(cursor, months);
    }
    const last = dates.at(-1);
    if (!last || last.getTime() !== maturity.getTime()) dates.push(maturity);
  }

  // Interest is earned on face value from the date it starts accruing, which
  // for a deposit is simply the amount paid from the day it was placed. They
  // diverge for a secondary-market bond: the price carries the seller's
  // accrued interest, and the coupon still runs from the previous coupon date
  // on the face amount.
  const interestBase = draft.faceValuePaise ?? draft.principalPaise;
  const interestStart = draft.interestStartDate ?? draft.investmentDate;

  let accrualStart = parseIsoDate(interestStart);
  const compoundedMaturity = draft.interestType === "simple"
    ? null
    : calculateCompoundMaturity(
        interestBase,
        draft.annualRateBps,
        interestStart,
        draft.maturityDate,
        draft.compoundingFrequency ?? "quarterly",
        draft.dayCountBasis ?? "actual-365",
      );

  return dates.map((date, index) => {
    const dueDate = toIsoDate(date);
    let gross: bigint;
    if (draft.payoutFrequency === "on-maturity" && draft.expectedMaturityPaise !== undefined) {
      gross = draft.expectedMaturityPaise > interestBase
        ? draft.expectedMaturityPaise - interestBase
        : 0n;
    } else if (draft.payoutFrequency === "on-maturity" && compoundedMaturity !== null) {
      gross = compoundedMaturity - interestBase;
    } else {
      gross = calculateInterestForDates(
        interestBase,
        draft.annualRateBps,
        toIsoDate(accrualStart),
        dueDate,
        draft.dayCountBasis ?? "actual-365",
      );
    }
    accrualStart = date;
    const expectedTds = draft.tdsApplicable
      ? calculateTDS(gross, draft.expectedTdsRateBps)
      : 0n;

    return {
      id: `projection-${index + 1}`,
      dueDate,
      financialYear: calculateFinancialYear(dueDate),
      grossInterestPaise: gross,
      expectedTdsPaise: expectedTds,
      expectedNetPaise: calculateNetPayout(gross, expectedTds),
      status: "upcoming",
    };
  });
}

export function calculateCompoundMaturity(
  principalPaise: bigint,
  annualRateBps: number,
  startIso: string,
  endIso: string,
  frequency: CompoundingFrequency = "quarterly",
  stubBasis: DayCountBasis = "actual-365",
) {
  if (principalPaise < 0n) throw new Error("Principal cannot be negative");
  if (annualRateBps < 0) throw new Error("Interest rate cannot be negative");
  const maturity = parseIsoDate(endIso);
  let cursor = parseIsoDate(startIso);
  if (maturity.getTime() < cursor.getTime()) throw new Error("Maturity cannot precede investment");

  const periodsPerYear = compoundsPerYear(frequency);
  const periodMonths = 12 / periodsPerYear;
  let amount = principalPaise;
  let periods = 0;
  while (periods < 1_200) {
    const next = addMonthsPreservingEnd(cursor, periodMonths);
    if (next.getTime() > maturity.getTime()) break;
    amount += divideRoundHalfUp(
      amount * BigInt(annualRateBps),
      BASIS_POINTS * BigInt(periodsPerYear),
    );
    cursor = next;
    periods += 1;
  }

  if (cursor.getTime() < maturity.getTime()) {
    amount += calculateInterestForDates(
      amount,
      annualRateBps,
      toIsoDate(cursor),
      endIso,
      stubBasis,
    );
  }
  return amount;
}

export function calculateMaturity(
  principalPaise: bigint,
  annualRateBps: number,
  tenureMonths: number,
  compoundsPerYear = 1,
) {
  const periods = Math.max(0, Math.round((tenureMonths / 12) * compoundsPerYear));
  const denominator = BASIS_POINTS * BigInt(compoundsPerYear);
  const numerator = denominator + BigInt(annualRateBps);
  let amount = principalPaise;
  for (let index = 0; index < periods; index += 1) {
    amount = divideRoundHalfUp(amount * numerator, denominator);
  }
  return amount;
}

export function parseRupeesToPaise(value: string) {
  const normalized = value.replace(/,/g, "").trim();
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return 0n;
  const [rupees, fraction = ""] = normalized.split(".");
  return BigInt(rupees) * 100n + BigInt((fraction + "00").slice(0, 2));
}

export function formatMoney(paise: bigint, maximumFractionDigits = 0) {
  const isNegative = paise < 0n;
  const absolute = isNegative ? -paise : paise;
  const whole = absolute / 100n;
  const fraction = absolute % 100n;
  const formattedWhole = new Intl.NumberFormat("en-IN").format(Number(whole));
  const decimal = maximumFractionDigits > 0
    ? `.${fraction.toString().padStart(2, "0").slice(0, maximumFractionDigits)}`
    : "";
  return `${isNegative ? "−" : ""}₹${formattedWhole}${decimal}`;
}

function frequencyMonths(frequency: PayoutFrequency) {
  const values: Record<PayoutFrequency, number> = {
    monthly: 1,
    quarterly: 3,
    "half-yearly": 6,
    yearly: 12,
    "on-maturity": 12,
    custom: 0,
  };
  return values[frequency];
}

function compoundsPerYear(frequency: CompoundingFrequency) {
  const values: Record<CompoundingFrequency, number> = {
    monthly: 12,
    quarterly: 4,
    "half-yearly": 2,
    yearly: 1,
  };
  return values[frequency];
}

function parseIsoDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function toIsoDate(value: Date) {
  return value.toISOString().slice(0, 10);
}

function isMonthEnd(value: Date) {
  return value.getUTCDate() === new Date(
    Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + 1, 0),
  ).getUTCDate();
}

function addMonthsPreservingEnd(value: Date, months: number) {
  const sourceDay = value.getUTCDate();
  const targetMonthStart = new Date(Date.UTC(
    value.getUTCFullYear(),
    value.getUTCMonth() + months,
    1,
  ));
  const targetLastDay = new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth() + 1,
    0,
  )).getUTCDate();
  const targetDay = isMonthEnd(value) ? targetLastDay : Math.min(sourceDay, targetLastDay);
  return new Date(Date.UTC(
    targetMonthStart.getUTCFullYear(),
    targetMonthStart.getUTCMonth(),
    targetDay,
  ));
}

function daysBetween(start: Date, end: Date) {
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

function days360(start: Date, end: Date) {
  const startDay = Math.min(start.getUTCDate(), 30);
  const endDay = startDay === 30 ? Math.min(end.getUTCDate(), 30) : end.getUTCDate();
  return (
    (end.getUTCFullYear() - start.getUTCFullYear()) * 360 +
    (end.getUTCMonth() - start.getUTCMonth()) * 30 +
    endDay - startDay
  );
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}
