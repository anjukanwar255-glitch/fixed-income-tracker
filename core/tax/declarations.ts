import type { InvestmentForm } from "@/core/models/financial";

/**
 * The declaration a resident files so that tax is not deducted when their
 * total income falls below the taxable limit.
 *
 * One form now covers every declarant, replacing the separate Form 15G for
 * those under 60 and Form 15H for senior citizens — so nothing here needs the
 * holder's age. Kept as a single constant because the number is the only part
 * likely to change again.
 */
export const DECLARATION_FORM_TYPE = "Form 121";

/**
 * Section 206AA: where no PAN is on record, tax is deducted at the higher
 * rate. These are the rates suggested on a new investment; the issuer's own
 * terms win wherever they differ, so both stay editable.
 */
export const TDS_RATE_WITH_PAN_BPS = 1000;
export const TDS_RATE_WITHOUT_PAN_BPS = 2000;

/** Statuses a filed declaration can be in. "Required" is never stored. */
export const DECLARATION_STATUSES = ["submitted", "accepted", "rejected", "expired"] as const;
export type DeclarationStatus = (typeof DECLARATION_STATUSES)[number];

/** A declaration counts as covering the year only while it stands. */
const COVERING = new Set(["submitted", "accepted"]);

/**
 * Whether a declaration still has to be filed for this financial year.
 *
 * Derived rather than stored. A declaration lapses every 31 March and has to
 * be filed again, and a stored "required" row would need something to create
 * it each April — one that failed silently would leave the investor believing
 * they were covered. Reading it from the records that do exist means the year
 * rolls over on its own.
 */
export function declarationPending(
  investment: { declarationApplicable?: boolean; status: string; forms: InvestmentForm[] },
  financialYear: string,
) {
  if (!investment.declarationApplicable) return false;
  if (investment.status !== "active") return false;
  return !investment.forms.some(
    (form) => form.financialYear === financialYear && COVERING.has(form.status),
  );
}
