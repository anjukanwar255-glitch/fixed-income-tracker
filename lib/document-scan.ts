import { GoogleGenAI, Type } from "@google/genai";

import { env } from "@/lib/env";
import { firebaseConfig } from "@/lib/firebase-config";

/**
 * Reads an investment certificate or broker statement and returns the fields
 * the add-investment form asks for.
 *
 * The result is never saved directly. It pre-fills the form so the investor
 * confirms every value against the document in front of them — an extraction
 * mistake in a payout schedule compounds across years, and the person holding
 * the certificate is the only one who can catch it.
 *
 * Runs on Vertex AI inside this project, authenticated by the App Hosting
 * runtime's own identity, so there is no API key to store and the usage lands
 * on the same bill as everything else.
 */

/** 0 disables thinking. This is field extraction, not reasoning: thinking
 *  would multiply the token cost for no accuracy gain on a legible document. */
const THINKING_BUDGET = 0;

/** Overridable so a stronger model can be adopted without a code change. */
const DEFAULT_MODEL = "gemini-2.5-flash";

export type ScannedInvestment = {
  investmentName?: string;
  issuerName?: string;
  investmentNumber?: string;
  brokerName?: string;
  dpId?: string;
  clientId?: string;
  orderReference?: string;
  ifscCode?: string;
  investmentDate?: string;
  settlementDate?: string;
  amountPaidRupees?: number;
  faceValueRupees?: number;
  expectedMaturityRupees?: number;
  accruedInterestPaidRupees?: number;
  interestRatePercent?: number;
  interestStartDate?: string;
  firstPayoutDate?: string;
  maturityDate?: string;
  payoutFrequency?: string;
  dayCountBasis?: string;
  interestType?: string;
  repaymentSchedule?: { dueDate: string; interestRupees: number; principalRupees: number }[];
  notes?: string;
};

/** A schedule longer than this is a misread, not a bond. */
const MAX_SCHEDULE_ROWS = 600;

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    investmentName: { type: Type.STRING, description: "Product name as printed, e.g. 'Muthoot Fincorp May 2029'." },
    issuerName: { type: Type.STRING, description: "The bank or company that issued it, not the broker or platform." },
    investmentNumber: { type: Type.STRING, description: "ISIN, FD receipt number, folio or certificate number." },
    investmentDate: { type: Type.STRING, description: "Purchase or deposit date as YYYY-MM-DD." },
    settlementDate: { type: Type.STRING, description: "Date the trade settled and the securities were delivered, as YYYY-MM-DD. Labelled 'Settlement Date'; usually a day or two after the order date. Accrued interest is calculated up to this date, not to the order date." },
    amountPaidRupees: { type: Type.NUMBER, description: "Total rupees actually paid. Labelled 'Total Consideration' or 'Total Investment Amount' on a deal sheet. Includes any premium and accrued interest." },
    faceValueRupees: { type: Type.NUMBER, description: "The principal the issuer pays interest on and repays at maturity. Labelled 'Total Principal Amount', or the 'Face Value per Unit' multiplied by the 'Number of Units'. Report it whenever the document states it, even if you are unsure whether it differs from the amount paid." },
    expectedMaturityRupees: { type: Type.NUMBER, description: "Total expected on the maturity date. Read it from the final row of a repayment schedule when one is supplied — principal repaid plus any interest paid alongside it. Otherwise it is the printed maturity value on a cumulative deposit, or the face value for a bond that repays principal at maturity." },
    accruedInterestPaidRupees: { type: Type.NUMBER, description: "Interest paid to the seller for the part of the coupon period before the purchase, labelled 'Accrued Interest'. Report the printed number only. Present on a secondary-market purchase, absent on a fresh issue or deposit." },
    interestRatePercent: { type: Type.NUMBER, description: "The coupon or contracted interest rate per year, labelled 'Coupon Rate' or 'Interest Rate'. Never the YTM, XIRR or 'returns' figure, which often appears a line or two away." },
    interestStartDate: { type: Type.STRING, description: "Date interest begins accruing as YYYY-MM-DD, only if a document states it outright. Do not calculate it — reporting accruedInterestPaidRupees is enough." },
    firstPayoutDate: { type: Type.STRING, description: "Date of the first interest payment, as YYYY-MM-DD. When a repayment or payment schedule is supplied, this is the date on its earliest interest row — take it from there. No document has to use the words 'first payout' for that row to be the answer." },
    maturityDate: { type: Type.STRING, description: "Maturity or redemption date as YYYY-MM-DD." },
    brokerName: { type: Type.STRING, description: "The broker, platform or distributor the purchase went through — whoever produced a deal sheet or contract note. This is not the issuer; both usually appear on the same page." },
    dpId: { type: Type.STRING, description: "Depository participant id, labelled 'DP ID'. Usually starts with IN for NSDL." },
    clientId: { type: Type.STRING, description: "Demat client id, labelled 'Client ID' or 'Beneficiary ID'. Not the broker's own client code." },
    orderReference: { type: Type.STRING, description: "The reference for this trade — 'Order ID', 'Settlement Number' or 'Transaction ID'. Prefer the order id when several appear." },
    ifscCode: { type: Type.STRING, description: "IFSC of the bank branch the payouts are credited to, an eleven-character code whose fifth character is always 0, e.g. HDFC0001234. Only if a document prints one." },
    payoutFrequency: { type: Type.STRING, description: "One of: monthly, quarterly, half-yearly, yearly, on-maturity." },
    dayCountBasis: { type: Type.STRING, description: "One of: actual-365, actual-actual, 30-360. Use actual-actual when payouts in a leap year are smaller than the equivalent period in other years." },
    interestType: { type: Type.STRING, description: "One of: simple, compound, cumulative." },
    repaymentSchedule: {
      type: Type.ARRAY,
      description: "Every row of the repayment or payment schedule, in order, when one is supplied. Copy the rows as printed — this is what the investor will check each payment against. Omit the field entirely if no schedule is present; never invent rows to fill a gap.",
      items: {
        type: Type.OBJECT,
        properties: {
          dueDate: { type: Type.STRING, description: "Payment date for this row, as YYYY-MM-DD." },
          interestRupees: { type: Type.NUMBER, description: "Interest paid in this row. Use 0 if the row repays only principal." },
          principalRupees: { type: Type.NUMBER, description: "Principal repaid in this row. Use 0 for an interest-only row. Many bonds return the whole principal in the final row; some return a part of it every period." },
          totalRupees: { type: Type.NUMBER, description: "Total paid in this row, before any tax withheld. Report it as printed even where it equals the interest." },
        },
      },
    },
    notes: { type: Type.STRING, description: "Anything material that does not fit the fields above, or a note about what could not be read." },
  },
} as const;

const INSTRUCTIONS = `You are reading Indian fixed-income paperwork: a fixed deposit receipt, a bond or NCD certificate, a broker's deal sheet or contract note, or a repayment schedule.

You may be given more than one document for the same investment — typically a deal sheet stating the terms and a statement listing the payment schedule. Read all of them together and return one combined answer. Each tends to carry what the other omits: the deal sheet names the issuer and the coupon, the schedule shows how interest actually behaves month to month. Where two documents disagree, prefer the deal sheet, contract note or certificate over a statement or app screenshot.

Extract only what the documents actually state. Omit any field you cannot read with confidence — a missing field is corrected in seconds, a wrong one silently distorts years of projected payouts. Never infer, average or calculate a value that is not printed.

Reading a table is not calculating. A repayment schedule answers several of the fields below directly, and a value sitting in a row still counts as printed even when no heading uses the same words as the field name. In particular: the earliest interest row gives firstPayoutDate, the final row gives the maturity date and the amount expected at maturity, and the spacing between rows gives payoutFrequency. Take them. What you must not do is arrive at a number the documents never show — deriving a rate from amounts, averaging payments, or working a date back from an accrued figure.

Points that are commonly got wrong:

- **The issuer is not the broker.** The issuer is the company that borrowed the money and pays the interest — look for a label like "Issuer", "Issuer Name" or the company named in the security's own name. The platform that sold it (Grip, Wint, Jiraaf, INDmoney, Zerodha and the like), the seller or counterparty on a secondary trade, the clearing corporation and the depository are all intermediaries. A logo or letterhead is not evidence of who issued the security. If no issuer is named anywhere, omit issuerName rather than falling back to whoever produced the document.
- The face value and the amount paid are different numbers when a bond is bought from another investor, and a deal sheet prints both. Face value is what the issuer repays at maturity and computes interest on — "Total Principal Amount", or "Face Value per Unit" times "Number of Units". The amount paid is the "Total Consideration" or "Total Investment Amount", which adds any premium and the accrued interest owed to the seller. Always report the face value when it is stated. Do not skip it because it looks close to the amount paid — a difference of a few hundred rupees changes every payout in the schedule.
- The interest rate is the coupon printed in the terms — "Coupon Rate" or "Interest Rate". A "YTM", "XIRR" or "returns" percentage is a different figure and must never be used as the rate. Both often appear on the same page, a line or two apart.
- Report accrued interest as the printed number in accruedInterestPaidRupees. Do not convert it into a date: its presence is what matters, and the date it implies is worked out afterwards from the coupon schedule.
- Infer dayCountBasis from a payment schedule when one is present: if payments track the number of days in each month, it is an actual basis; if February in a leap year pays proportionally less than the equivalent period in other years, it is actual-actual. If every period pays an identical amount regardless of month length, it is 30-360.

When a repayment or payment schedule is supplied, return all of its rows in repaymentSchedule, in order and as printed. Do not summarise it, sample it, or stop early — the investor checks each payment against its row when the money arrives, so a schedule missing its later years is worse than none. Split each row into interest and principal where the document distinguishes them; where it prints only a total, report the total and leave the parts at 0 rather than dividing it yourself.

Put anything material that has no field of its own into notes — a premium or discount over face value, accrued interest paid to the seller, the number of units, the ISIN, or a figure you were unsure about and left out.

Return dates as YYYY-MM-DD. Return money as plain rupee numbers without symbols or separators.`;

let client: GoogleGenAI | null = null;

function getClient() {
  if (!client) {
    client = new GoogleGenAI({
      enterprise: true,
      project: firebaseConfig.projectId,
      location: env.VERTEX_LOCATION ?? "global",
    });
  }
  return client;
}

export function isDocumentScanConfigured() {
  return env.DOCUMENT_SCAN_ENABLED === "true";
}

export type ScanSource = {
  bytes: ArrayBuffer;
  mimeType: string;
  /** What this document is, so the reader need not infer it. */
  label: string;
};

/**
 * Reads one or more documents describing the same investment.
 *
 * A deal sheet and a repayment schedule answer different halves of the form —
 * the first names the issuer and the coupon, the second reveals how interest
 * behaves across month lengths and leap years — so they are sent together and
 * reconciled in a single pass rather than scanned separately and merged here.
 */
export async function scanInvestmentDocuments(sources: ScanSource[]): Promise<ScannedInvestment> {
  const response = await getClient().models.generateContent({
    model: env.DOCUMENT_SCAN_MODEL ?? DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          // Each file is introduced by what it is, so the reader knows which
          // paper it is looking at rather than guessing from the letterhead.
          ...sources.flatMap(({ bytes, mimeType, label }) => [
            { text: `Document: ${label}` },
            { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
          ]),
          { text: INSTRUCTIONS },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema,
      thinkingConfig: { thinkingBudget: THINKING_BUDGET },
      temperature: 0,
    },
  });

  const text = response.text;
  if (!text) throw new Error("The document could not be read");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("The document could not be read");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("The document could not be read");

  return sanitise(parsed as Record<string, unknown>);
}

/**
 * Keeps only values of the right shape. The schema constrains the model, it
 * does not guarantee it, and everything here goes straight into a form the
 * investor is about to trust.
 */
function sanitise(raw: Record<string, unknown>): ScannedInvestment {
  const result: ScannedInvestment = {};
  const text = (value: unknown, max = 200) =>
    typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
  const isoDate = (value: unknown) =>
    typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()) ? value.trim() : undefined;
  const positive = (value: unknown) =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;

  result.investmentName = text(raw.investmentName, 120);
  result.issuerName = text(raw.issuerName, 120);
  result.investmentNumber = text(raw.investmentNumber, 80);
  result.brokerName = text(raw.brokerName, 100);
  result.dpId = text(raw.dpId, 40);
  result.clientId = text(raw.clientId, 40);
  result.orderReference = text(raw.orderReference, 80);
  // The shape is fixed and checkable, so a misread is rejected here rather
  // than landing in a field the investor is likely to skim past.
  const ifsc = typeof raw.ifscCode === "string" ? raw.ifscCode.trim().toUpperCase() : "";
  if (/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) result.ifscCode = ifsc;
  result.investmentDate = isoDate(raw.investmentDate);
  result.settlementDate = isoDate(raw.settlementDate);
  result.amountPaidRupees = positive(raw.amountPaidRupees);
  result.faceValueRupees = positive(raw.faceValueRupees);
  result.expectedMaturityRupees = positive(raw.expectedMaturityRupees);
  result.accruedInterestPaidRupees = positive(raw.accruedInterestPaidRupees);
  result.interestStartDate = isoDate(raw.interestStartDate);
  result.firstPayoutDate = isoDate(raw.firstPayoutDate);
  result.maturityDate = isoDate(raw.maturityDate);
  result.notes = text(raw.notes, 1000);

  // A rate outside this range is a misread — most likely a YTM, an amount, or
  // a year picked up from elsewhere on the page.
  const rate = positive(raw.interestRatePercent);
  if (rate !== undefined && rate <= 100) result.interestRatePercent = rate;

  // Enumerated fields feed <Select>s; an unrecognised value would leave the
  // control blank with no explanation, so only known ones are passed through.
  const oneOf = (value: unknown, allowed: readonly string[]) => {
    const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
    return allowed.includes(candidate) ? candidate : undefined;
  };
  /*
   * A row is kept only if it has a usable date and at least one amount. Where
   * the document prints a total but no split, the parts are worked out here:
   * subtracting two printed numbers is arithmetic worth doing, and it is the
   * split the investor is trying to check.
   */
  if (Array.isArray(raw.repaymentSchedule)) {
    const rows = raw.repaymentSchedule
      .slice(0, MAX_SCHEDULE_ROWS)
      .map((entry) => {
        if (!entry || typeof entry !== "object") return null;
        const row = entry as Record<string, unknown>;
        const dueDate = isoDate(row.dueDate);
        if (!dueDate) return null;
        const amount = (value: unknown) =>
          typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
        const total = amount(row.totalRupees);
        let interest = amount(row.interestRupees);
        let principal = amount(row.principalRupees);
        if (total !== null && interest !== null && principal === null) principal = total - interest;
        if (total !== null && principal !== null && interest === null) interest = total - principal;
        if (interest === null && principal === null && total !== null) { interest = total; principal = 0; }
        if (interest === null && principal === null) return null;
        interest = Math.max(interest ?? 0, 0);
        principal = Math.max(principal ?? 0, 0);
        if (interest === 0 && principal === 0) return null;
        return { dueDate, interestRupees: interest, principalRupees: principal };
      })
      .filter((row) => row !== null);
    if (rows.length) result.repaymentSchedule = rows;
  }

  result.payoutFrequency = oneOf(raw.payoutFrequency, ["monthly", "quarterly", "half-yearly", "yearly", "on-maturity"]);
  result.dayCountBasis = oneOf(raw.dayCountBasis, ["actual-365", "actual-actual", "30-360"]);
  result.interestType = oneOf(raw.interestType, ["simple", "compound", "cumulative"]);

  // The face value only means something when it differs from what was paid.
  if (result.faceValueRupees !== undefined && result.faceValueRupees === result.amountPaidRupees) {
    result.faceValueRupees = undefined;
  }
  // Same for an accrual date that matches the purchase date.
  if (result.interestStartDate !== undefined && result.interestStartDate === result.investmentDate) {
    result.interestStartDate = undefined;
  }

  return result;
}
