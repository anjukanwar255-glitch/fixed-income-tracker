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
  investmentDate?: string;
  amountPaidRupees?: number;
  faceValueRupees?: number;
  interestRatePercent?: number;
  interestStartDate?: string;
  firstPayoutDate?: string;
  maturityDate?: string;
  payoutFrequency?: string;
  dayCountBasis?: string;
  interestType?: string;
  notes?: string;
};

const responseSchema = {
  type: Type.OBJECT,
  properties: {
    investmentName: { type: Type.STRING, description: "Product name as printed, e.g. 'Muthoot Fincorp May 2029'." },
    issuerName: { type: Type.STRING, description: "The bank or company that issued it, not the broker or platform." },
    investmentNumber: { type: Type.STRING, description: "ISIN, FD receipt number, folio or certificate number." },
    investmentDate: { type: Type.STRING, description: "Purchase or deposit date as YYYY-MM-DD." },
    amountPaidRupees: { type: Type.NUMBER, description: "Total rupees actually paid, including any premium or accrued interest." },
    faceValueRupees: { type: Type.NUMBER, description: "Face or principal value the issuer pays interest on and repays at maturity. Often units multiplied by the per-unit face value. Omit if it is the same as the amount paid." },
    interestRatePercent: { type: Type.NUMBER, description: "The coupon or contracted interest rate per year. Never the YTM, XIRR or 'returns' figure a broker displays." },
    interestStartDate: { type: Type.STRING, description: "Date interest begins accruing as YYYY-MM-DD, if the document shows it starting before the purchase date. Omit otherwise." },
    firstPayoutDate: { type: Type.STRING, description: "First interest payment date as YYYY-MM-DD." },
    maturityDate: { type: Type.STRING, description: "Maturity or redemption date as YYYY-MM-DD." },
    payoutFrequency: { type: Type.STRING, description: "One of: monthly, quarterly, half-yearly, yearly, on-maturity." },
    dayCountBasis: { type: Type.STRING, description: "One of: actual-365, actual-actual, 30-360. Use actual-actual when payouts in a leap year are smaller than the equivalent period in other years." },
    interestType: { type: Type.STRING, description: "One of: simple, compound, cumulative." },
    notes: { type: Type.STRING, description: "Anything material that does not fit the fields above, or a note about what could not be read." },
  },
} as const;

const INSTRUCTIONS = `You are reading an Indian fixed-income document: a fixed deposit receipt, bond or NCD certificate, or a broker's holding statement.

Extract only what the document actually states. Omit any field you cannot read with confidence — a missing field is corrected in seconds, a wrong one silently distorts years of projected payouts. Never infer, average or calculate a value that is not printed.

Points that are commonly got wrong:

- The face value and the amount paid are different numbers when a bond is bought from another investor. The face value is what the issuer repays at maturity and computes interest on; the amount paid is the market price, which may include a premium and the previous holder's accrued interest. If the document shows a redemption or principal repayment row, that amount is the face value.
- The interest rate is the coupon printed in the terms. A broker's "YTM", "XIRR" or "returns" percentage is a different figure and must not be used as the rate.
- If the first interest payment covers a longer period than the gap between the purchase date and that payment, interest began accruing before the purchase. Report that earlier date as interestStartDate.
- Infer dayCountBasis from a payment schedule if one is present: if payments track the number of days in each month, it is an actual basis; if a February in a leap year pays proportionally less than the same period elsewhere, it is actual-actual. If every period pays an identical amount regardless of month length, it is 30-360.

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

export async function scanInvestmentDocument(bytes: ArrayBuffer, mimeType: string): Promise<ScannedInvestment> {
  const response = await getClient().models.generateContent({
    model: env.DOCUMENT_SCAN_MODEL ?? DEFAULT_MODEL,
    contents: [
      {
        role: "user",
        parts: [
          { inlineData: { mimeType, data: Buffer.from(bytes).toString("base64") } },
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
  result.investmentDate = isoDate(raw.investmentDate);
  result.amountPaidRupees = positive(raw.amountPaidRupees);
  result.faceValueRupees = positive(raw.faceValueRupees);
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
