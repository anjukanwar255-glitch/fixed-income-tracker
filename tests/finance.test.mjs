import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());
const finance = await vite.ssrLoadModule("/core/finance/calculations.ts");
const files = await vite.ssrLoadModule("/lib/file-validation.ts");
const tax = await vite.ssrLoadModule("/core/tax/declarations.ts");
const identity = await vite.ssrLoadModule("/core/identity/user-reference.ts");
const contributions = await vite.ssrLoadModule("/core/finance/contributions.ts");
const scan = await vite.ssrLoadModule("/core/finance/scan-mapping.ts");
const billing = await vite.ssrLoadModule("/lib/plans.ts");
const closure = await vite.ssrLoadModule("/core/finance/closure.ts");
const cashflow = await vite.ssrLoadModule("/core/finance/cashflow.ts");
const mark = await vite.ssrLoadModule("/core/data/issuer-mark.ts");

test("uses exact date accrual for a complete non-leap year", () => {
  assert.equal(finance.calculateInterestForDates(10_000_000n, 750, "2025-01-01", "2026-01-01", "actual-365"), 750_000n);
});

test("actual/actual uses 366 days in a leap year", () => {
  assert.equal(finance.calculateInterestForDates(10_000_000n, 750, "2024-01-01", "2025-01-01", "actual-actual"), 750_000n);
});

test("quarterly compounding rounds paise deterministically", () => {
  assert.equal(finance.calculateCompoundMaturity(10_000_000n, 800, "2025-01-01", "2026-01-01", "quarterly"), 10_824_322n);
});

test("monthly month-end schedules preserve month-end and maturity", () => {
  const schedule = finance.generatePayoutSchedule({
    type: "fixed-deposit", name: "Test", issuer: "Bank", investmentNumber: "1",
    investmentDate: "2024-01-01", principalPaise: 10_000_000n, annualRateBps: 700,
    interestType: "simple", compoundingFrequency: "quarterly", dayCountBasis: "actual-365",
    payoutFrequency: "monthly", firstPayoutDate: "2024-01-31", maturityDate: "2024-04-30",
    tdsApplicable: false, expectedTdsRateBps: 0,
  });
  assert.deepEqual(schedule.map((item) => item.dueDate), ["2024-01-31", "2024-02-29", "2024-03-31", "2024-04-30"]);
});

test("adds a final stub payout when maturity is off-cycle", () => {
  const schedule = finance.generatePayoutSchedule({
    type: "corporate-bond", name: "Test", issuer: "Issuer", investmentNumber: "1",
    investmentDate: "2025-01-15", principalPaise: 10_000_000n, annualRateBps: 800,
    interestType: "simple", compoundingFrequency: "quarterly", dayCountBasis: "30-360",
    payoutFrequency: "quarterly", firstPayoutDate: "2025-04-15", maturityDate: "2025-12-31",
    tdsApplicable: true, expectedTdsRateBps: 1000,
  });
  assert.deepEqual(schedule.map((item) => item.dueDate), ["2025-04-15", "2025-07-15", "2025-10-15", "2025-12-31"]);
  assert.equal(schedule.at(-1).financialYear, "FY 2025-26");
});

test("document validation uses content signatures and blocks active PDFs", async () => {
  const valid = new File(["%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"], "certificate.pdf", { type: "application/pdf" });
  const result = await files.validateDocumentFile(valid);
  assert.equal(result.mimeType, "application/pdf");
  assert.match(result.sha256, /^[a-f0-9]{64}$/);

  const scripted = new File(["%PDF-1.4\n/OpenAction /JavaScript\n%%EOF"], "unsafe.pdf", { type: "application/pdf" });
  await assert.rejects(() => files.validateDocumentFile(scripted), /scripted PDF/i);

  const mismatched = new File(["%PDF-1.4\n%%EOF"], "certificate.jpg", { type: "application/pdf" });
  await assert.rejects(() => files.validateDocumentFile(mismatched), /extension and content/i);
});

/*
 * A real secondary-market bond, checked against the issuer's own statement
 * (Muthoot Fincorp May '29, ISIN INE549K07IF6).
 *
 * Bought 04/09/2026 for ₹1,00,462.43 — 100 units of ₹1,000 face, plus the
 * accrued interest owed to the seller. The issuer pays 8.65% on the ₹1,00,000
 * face from the previous coupon date, so the first payout covers the whole of
 * September rather than the 27 days since settlement.
 *
 * Three inputs have to be right, and all three were wrong on the first
 * attempt, which produced ₹657 where the statement says ₹711:
 *   - the face value, not the ₹1,00,462.43 paid
 *   - the 8.65% coupon, not the 8.85% YTM the broker displays
 *   - actual/actual, not actual/365 — under 365 the leap-year coupons come
 *     out ₹2 high, which is what exposed the difference
 */
const muthootDraft = {
  type: "corporate-bond", name: "Muthoot Fincorp May 29", issuer: "Muthoot Fincorp", investmentNumber: "INE549K07IF6",
  investmentDate: "2026-09-04",
  principalPaise: 10_046_243n,
  faceValuePaise: 10_000_000n,
  interestStartDate: "2026-09-01",
  annualRateBps: 865,
  interestType: "simple", compoundingFrequency: "quarterly", dayCountBasis: "actual-actual",
  payoutFrequency: "monthly", firstPayoutDate: "2026-10-01", maturityDate: "2029-05-12",
  tdsApplicable: false, expectedTdsRateBps: 0,
};

/**
 * The statement rounds each coupon to whole rupees; this works in paise, so
 * the two agree to within a rupee rather than exactly. Every published figure
 * is reproduced by 8.65% on face value rounded to the nearest rupee, which is
 * what confirms the rate: 710.96 -> 711, 734.66 -> 735, 663.56 -> 664,
 * 685.45 -> 685 in the leap year.
 */
function assertMatchesStatement(actualPaise, statementRupees) {
  const difference = actualPaise - BigInt(statementRupees) * 100n;
  assert.ok(
    difference < 100n && difference > -100n,
    `${actualPaise} paise is not within a rupee of the statement's ${statementRupees}`,
  );
}

test("a secondary-market bond accrues on face value from the previous coupon date", () => {
  const schedule = finance.generatePayoutSchedule(muthootDraft);
  const paidOn = (date) => schedule.find((item) => item.dueDate === date)?.grossInterestPaise;

  // Statement: 711.00 on 01/10/2026 — a full 30-day September, not the 27
  // days since settlement, which is what produced the wrong 657.
  assertMatchesStatement(paidOn("2026-10-01"), 711);
  // 31-day months pay more than 30-day ones under actual/365.
  assertMatchesStatement(paidOn("2026-11-01"), 735);
  assertMatchesStatement(paidOn("2026-12-01"), 711);
  // February 2027 is the shortest period in the schedule.
  assertMatchesStatement(paidOn("2027-03-01"), 664);
  // 2028 is a leap year, so the daily rate is annual/366 and each coupon dips.
  assertMatchesStatement(paidOn("2028-03-01"), 685);
  assertMatchesStatement(paidOn("2028-05-01"), 709);
});

test("the schedule runs to the statement's maturity date", () => {
  const schedule = finance.generatePayoutSchedule(muthootDraft);
  assert.equal(schedule.at(-1).dueDate, "2029-05-12");
});

test("without a face value or interest start date, nothing changes for a deposit", () => {
  // The same draft as a plain deposit: interest on what was paid, from the day
  // it was placed. This is the path every existing investment takes.
  const { faceValuePaise, interestStartDate, ...deposit } = muthootDraft;
  void faceValuePaise;
  void interestStartDate;
  const schedule = finance.generatePayoutSchedule(deposit);

  // 27 days from 04/09 on ₹1,00,462.43, which is what the app produced before.
  assert.equal(schedule[0].dueDate, "2026-10-01");
  assert.notEqual(schedule[0].grossInterestPaise, 71_100n);
});

/*
 * The scan endpoint receives bytes straight from the file picker with no
 * filename, so it validates through validateDocumentBytes. That must keep
 * every check that protects the reader and drop only the filename one, which
 * exists because uploads are served back as named attachments.
 */
const pdfBytes = (body) => new TextEncoder().encode(body).buffer;

test("byte validation keeps the content-signature and active-PDF checks", async () => {
  const valid = await files.validateDocumentBytes(
    pdfBytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"),
    "application/pdf",
  );
  assert.equal(valid.mimeType, "application/pdf");

  // A PDF carrying JavaScript is refused here exactly as it is on upload.
  await assert.rejects(
    () => files.validateDocumentBytes(pdfBytes("%PDF-1.4\n/JavaScript (app.alert)\n%%EOF"), "application/pdf"),
    /scripted PDF/i,
  );
  // Content decides the type; a lie in the declared type is caught.
  await assert.rejects(
    () => files.validateDocumentBytes(pdfBytes("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"), "image/png"),
    /declared type/i,
  );
  // Something that is not a supported document at all.
  await assert.rejects(
    () => files.validateDocumentBytes(pdfBytes("plain text, not a document"), "application/pdf"),
    /not a valid PDF/i,
  );
});

test("uploads still require the filename extension to match the content", async () => {
  // The check dropped for scanning must remain in force for stored uploads.
  const mislabelled = new File(["%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF"], "statement.png", { type: "application/pdf" });
  await assert.rejects(() => files.validateDocumentFile(mislabelled), /extension and content/i);
});

/*
 * Where a mid-period purchase starts accruing.
 *
 * The scan reports the accrued interest a deal sheet prints and nothing more;
 * this is what turns that into a date. Deriving it by stepping back one coupon
 * period is exact, where dividing an accrued amount by a daily rate is
 * arithmetic a model can quietly get wrong.
 */
test("the previous coupon date is one period before the first payout", () => {
  // Muthoot: monthly, first payout 01/10/2026, so accrual starts 01/09/2026 -
  // confirmed independently by the deal sheet's Rs 142.20 accrued interest,
  // which is six days at Rs 23.70 back from the 07/09 settlement.
  assert.equal(finance.previousCouponDate("2026-10-01", "monthly"), "2026-09-01");

  assert.equal(finance.previousCouponDate("2026-10-01", "quarterly"), "2026-07-01");
  assert.equal(finance.previousCouponDate("2026-10-01", "half-yearly"), "2026-04-01");
  assert.equal(finance.previousCouponDate("2026-10-01", "yearly"), "2025-10-01");
});

test("stepping back a period keeps month-ends and crosses years", () => {
  // A 31st steps back to the last day of a shorter month rather than spilling.
  assert.equal(finance.previousCouponDate("2026-03-31", "monthly"), "2026-02-28");
  assert.equal(finance.previousCouponDate("2028-03-31", "monthly"), "2028-02-29");
  assert.equal(finance.previousCouponDate("2026-01-15", "monthly"), "2025-12-15");
});

test("a custom schedule has no period to step back through", () => {
  assert.equal(finance.previousCouponDate("2026-10-01", "custom"), null);
});

test("a document schedule is used as printed, principal and all", () => {
  const schedule = finance.scheduleFromDocument([
    { dueDate: "2025-11-01", interestPaise: 72_083n, principalPaise: 0n },
    { dueDate: "2025-10-01", interestPaise: 72_083n, principalPaise: 250_000n },
  ], { tdsApplicable: false, expectedTdsRateBps: 0 });

  // Rows are ordered by date regardless of the order they were read in.
  assert.deepEqual(schedule.map((row) => row.dueDate), ["2025-10-01", "2025-11-01"]);
  assert.equal(schedule[0].principalRepaidPaise, 250_000n);
  // The expected credit is the interest plus the principal coming back.
  assert.equal(schedule[0].expectedNetPaise, 322_083n);
  assert.equal(schedule[1].principalRepaidPaise, 0n);
  assert.equal(schedule[1].expectedNetPaise, 72_083n);
});

test("TDS applies to the interest in a document row, never to the principal", () => {
  const [row] = finance.scheduleFromDocument(
    [{ dueDate: "2026-01-01", interestPaise: 100_000n, principalPaise: 500_000n }],
    { tdsApplicable: true, expectedTdsRateBps: 1000 },
  );
  assert.equal(row.expectedTdsPaise, 10_000n);
  assert.equal(row.expectedNetPaise, 590_000n);
  assert.equal(row.financialYear, finance.calculateFinancialYear("2026-01-01"));
});

test("a generated schedule repays no principal along the way", () => {
  const schedule = finance.generatePayoutSchedule(muthootDraft);
  assert.ok(schedule.every((row) => row.principalRepaidPaise === 0n));
});

test("a declaration is pending until one is filed for that year", () => {
  const investment = { declarationApplicable: true, status: "active", forms: [] };
  assert.equal(tax.declarationPending(investment, "2026-27"), true);

  const filed = { ...investment, forms: [{ financialYear: "2026-27", status: "submitted" }] };
  assert.equal(tax.declarationPending(filed, "2026-27"), false);
});

test("last year's declaration does not cover this year", () => {
  const investment = {
    declarationApplicable: true,
    status: "active",
    forms: [{ financialYear: "2025-26", status: "accepted" }],
  };
  assert.equal(tax.declarationPending(investment, "2026-27"), true);
});

test("a rejected declaration leaves the year uncovered", () => {
  const investment = {
    declarationApplicable: true,
    status: "active",
    forms: [{ financialYear: "2026-27", status: "rejected" }],
  };
  assert.equal(tax.declarationPending(investment, "2026-27"), true);
});

test("nothing is pending where no declaration applies or the holding has closed", () => {
  assert.equal(tax.declarationPending({ declarationApplicable: false, status: "active", forms: [] }, "2026-27"), false);
  assert.equal(tax.declarationPending({ declarationApplicable: true, status: "matured", forms: [] }, "2026-27"), false);
});

test("an account reference carries the opening year and the last four of the uid", () => {
  assert.equal(
    identity.formatUserReference("k3Jd8fFhZ2aQxYbN1mLp0Rta3f9", "2026-09-10T06:12:00.000Z"),
    "PORT-2026-A3F9",
  );
});

test("a reference is refused rather than built from an unusable uid or date", () => {
  assert.equal(identity.formatUserReference("abc", "2026-09-10T00:00:00.000Z"), null);
  assert.equal(identity.formatUserReference("k3Jd8fFhZ2aQ", ""), null);
});

test("a SIP runs from its start date on the chosen interval", () => {
  const rows = contributions.generateContributionSchedule({
    contributionPaise: 500_000n,
    contributionFrequency: "monthly",
    contributionStartDate: "2026-04-10",
    contributionEndDate: "2026-08-10",
  });
  assert.deepEqual(rows.map((row) => row.dueDate), [
    "2026-04-10", "2026-05-10", "2026-06-10", "2026-07-10", "2026-08-10",
  ]);
  assert.ok(rows.every((row) => row.amountPaise === 500_000n));
  assert.equal(rows[0].financialYear, finance.calculateFinancialYear("2026-04-10"));
});

test("a yearly premium keeps a month-end date across a leap year", () => {
  const rows = contributions.generateContributionSchedule({
    contributionPaise: 2_500_000n,
    contributionFrequency: "yearly",
    contributionStartDate: "2027-02-28",
    contributionEndDate: "2029-03-01",
  });
  assert.deepEqual(rows.map((row) => row.dueDate), ["2027-02-28", "2028-02-29", "2029-02-28"]);
});

test("a single premium is still one row, so it can be marked paid", () => {
  const rows = contributions.generateContributionSchedule({
    contributionPaise: 10_000_000n,
    contributionFrequency: "single",
    contributionStartDate: "2026-06-01",
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].dueDate, "2026-06-01");
});

test("an open-ended SIP is projected rather than left empty", () => {
  const rows = contributions.generateContributionSchedule({
    contributionPaise: 100_000n,
    contributionFrequency: "monthly",
    contributionStartDate: "2026-04-01",
  });
  assert.equal(rows.length, 121);
  assert.equal(rows.at(-1).dueDate, "2036-04-01");
});

test("nothing is scheduled without an amount, a frequency or a start", () => {
  assert.deepEqual(contributions.generateContributionSchedule({}), []);
  assert.deepEqual(contributions.generateContributionSchedule({ contributionPaise: 0n, contributionFrequency: "monthly", contributionStartDate: "2026-04-01" }), []);
  assert.deepEqual(contributions.generateContributionSchedule({ contributionPaise: 100n, contributionStartDate: "2026-04-01" }), []);
});

test("only paid instalments count as money in", () => {
  const totals = contributions.contributionTotals([
    { financialYear: "2026-27", amountPaise: 100n, status: "paid", paidAmountPaise: 100n },
    { financialYear: "2026-27", amountPaise: 100n, status: "overdue" },
    { financialYear: "2025-26", amountPaise: 100n, status: "paid", paidAmountPaise: 100n },
  ], "2026-27");
  assert.equal(totals.scheduled, 200n);
  assert.equal(totals.paid, 100n);
  assert.equal(totals.paidCount, 1);
  assert.equal(totals.missed, 1);
});

/*
 * Orange Retail Finance INE786X07BM8, from a real Grip deal sheet and
 * statement. It amortises: from April 2028 it returns 16,666.70 of principal
 * every month, so by maturity only the last instalment is left. It also opens
 * with a stub — interest runs from 25/08/2026 but coupons fall on the 1st, so
 * the first period is 37 days, not 30.
 */
const orangeSchedule = [
  { dueDate: "2026-10-01", interestPaise: 116_580, principalPaise: 0 },
  { dueDate: "2027-02-01", interestPaise: 97_670, principalPaise: 0 },
  { dueDate: "2028-04-01", interestPaise: 97_400, principalPaise: 1_666_670 },
  { dueDate: "2028-08-25", interestPaise: 12_570, principalPaise: 1_666_670 },
];

test("an amortising bond matures at its last instalment, not its face value", () => {
  assert.equal(
    scan.maturityAmountFromScan({
      scheduleRows: orangeSchedule,
      faceValuePaise: 10_000_020,
      amountPaidPaise: 9_776_028,
      payoutFrequency: "monthly",
      interestType: "simple",
    }),
    1_679_240,
  );
});

test("a printed maturity amount always wins", () => {
  assert.equal(
    scan.maturityAmountFromScan({ expectedMaturityPaise: 5_000_000, scheduleRows: orangeSchedule, faceValuePaise: 10_000_020 }),
    5_000_000,
  );
});

test("without a schedule, a bullet bond still matures at face value", () => {
  assert.equal(
    scan.maturityAmountFromScan({ faceValuePaise: 10_000_000, payoutFrequency: "monthly", interestType: "simple" }),
    10_000_000,
  );
  // A cumulative deposit rolls its interest into the final payment, so the
  // figure has to come off the paperwork rather than be assumed.
  assert.equal(
    scan.maturityAmountFromScan({ faceValuePaise: 10_000_000, payoutFrequency: "on-maturity", interestType: "cumulative" }),
    null,
  );
});

test("the accrual date comes back from the accrued interest, stub period and all", () => {
  // ₹409.61 accrued at 11.50% on ₹1,00,000.20 is exactly 13 days, and
  // settlement was 07/09/2026 — so interest runs from 25/08/2026. Stepping one
  // month back from the first payout would have said 01/09 and been wrong.
  assert.equal(
    scan.interestStartFromAccrued({
      accruedInterestPaise: 40_961,
      interestBasePaise: 10_000_020,
      annualRateBps: 1150,
      settlementDate: "2026-09-07",
    }),
    "2026-08-25",
  );
  assert.notEqual(finance.previousCouponDate("2026-10-01", "monthly"), "2026-08-25");
});

test("no accrued interest, no derived accrual date", () => {
  const base = { interestBasePaise: 10_000_020, annualRateBps: 1150, settlementDate: "2026-09-07" };
  assert.equal(scan.interestStartFromAccrued({ ...base, accruedInterestPaise: 0 }), null);
  assert.equal(scan.interestStartFromAccrued({ ...base, accruedInterestPaise: -5 }), null);
  // More than a year of accrual means the numbers do not belong together.
  assert.equal(scan.interestStartFromAccrued({ ...base, accruedInterestPaise: 90_000_000 }), null);
  assert.equal(scan.interestStartFromAccrued({ ...base, accruedInterestPaise: 40_961, annualRateBps: 0 }), null);
});

test("the Orange statement's own rows survive the document schedule intact", () => {
  const rows = finance.scheduleFromDocument(
    orangeSchedule.map((row) => ({
      dueDate: row.dueDate,
      interestPaise: BigInt(row.interestPaise),
      principalPaise: BigInt(row.principalPaise),
    })),
    { tdsApplicable: false, expectedTdsRateBps: 0 },
  );
  assert.equal(rows.length, 4);
  // The 37-day opening coupon is larger than a full month, and stays that way.
  assert.equal(rows[0].grossInterestPaise, 116_580n);
  assert.equal(rows[0].principalRepaidPaise, 0n);
  // The final row is principal plus its last interest.
  assert.equal(rows[3].expectedNetPaise, 1_679_240n);
});

test("a longer plan's saving is measured against paying monthly for the same span", () => {
  const plans = [
    { code: "monthly", amountPaise: 9_900, monthsCovered: 1 },
    { code: "half-yearly", amountPaise: 54_900, monthsCovered: 6 },
    { code: "yearly", amountPaise: 99_900, monthsCovered: 12 },
  ];
  assert.equal(billing.planSavingPercent(plans, "monthly"), 0);
  assert.equal(billing.planSavingPercent(plans, "half-yearly"), 7);
  assert.equal(billing.planSavingPercent(plans, "yearly"), 15);
});

test("no saving is claimed where a longer plan costs the same or more", () => {
  const plans = [
    { code: "monthly", amountPaise: 9_900, monthsCovered: 1 },
    { code: "yearly", amountPaise: 200_000, monthsCovered: 12 },
  ];
  assert.equal(billing.planSavingPercent(plans, "yearly"), 0);
  assert.equal(billing.planSavingPercent(plans, "half-yearly"), 0);
});

test("paise are shown when there are any, and dropped when there are none", () => {
  assert.equal(finance.formatMoney(97_671n), "₹976.71");
  assert.equal(finance.formatMoney(97_670n), "₹976.70");
  assert.equal(finance.formatMoney(100_000_020n), "₹10,00,000.20");
  // A whole-rupee amount keeps no dead ".00".
  assert.equal(finance.formatMoney(10_000_000n), "₹1,00,000");
  assert.equal(finance.formatMoney(0n), "₹0");
  assert.equal(finance.formatMoney(-97_671n), "−₹976.71");
  assert.equal(finance.formatMoney(-10_000_000n), "−₹1,00,000");
});

const orangeRows = [
  { id: "p1", dueDate: "2026-10-01", grossInterestPaise: 116_580n, principalRepaidPaise: 0n, expectedTdsPaise: 0n },
  { id: "p2", dueDate: "2026-11-01", grossInterestPaise: 97_670n, principalRepaidPaise: 0n, expectedTdsPaise: 0n },
  { id: "p3", dueDate: "2026-12-01", grossInterestPaise: 94_520n, principalRepaidPaise: 0n, expectedTdsPaise: 0n },
];

test("selling a bond part-way through a period earns the interest since the last payout", () => {
  // Two of ten units sold on 16/11/2026: the period began at the 01/11 payout,
  // so 15 days of interest on a fifth of the holding.
  const position = closure.closurePosition({
    closureDate: "2026-11-16",
    closedPortion: 2,
    heldPortion: 10,
    schedule: orangeRows,
    interestBasePaise: 10_000_020n,
    principalPaise: 9_776_028n,
    annualRateBps: 1150,
    interestStartDate: "2026-08-25",
  });
  assert.equal(position.accrualFrom, "2026-11-01");
  const whole = finance.calculateInterestForDates(10_000_020n, 1150, "2026-11-01", "2026-11-16", "actual-365");
  assert.equal(position.accruedInterestPaise, (whole * 2n) / 10n);
  assert.equal(position.fullExit, false);
  assert.equal(position.remainingPortion, 8);
  // Only the payouts still ahead are touched.
  assert.deepEqual(position.scaledPayoutIds, ["p3"]);
  assert.deepEqual(position.cancelledPayoutIds, []);
});

test("a full exit cancels what is left rather than scaling it", () => {
  const position = closure.closurePosition({
    closureDate: "2026-11-16",
    closedPortion: 10,
    heldPortion: 10,
    schedule: orangeRows,
    interestBasePaise: 10_000_020n,
    principalPaise: 9_776_028n,
    annualRateBps: 1150,
    interestStartDate: "2026-08-25",
  });
  assert.equal(position.fullExit, true);
  assert.equal(position.remainingPrincipalPaise, 0n);
  assert.deepEqual(position.cancelledPayoutIds, ["p3"]);
  assert.deepEqual(position.scaledPayoutIds, []);
});

test("a deposit breaks by amount, not units, and keeps the rest running", () => {
  // ₹2,00,000 taken out of a ₹5,00,000 deposit leaves ₹3,00,000 earning.
  const position = closure.closurePosition({
    closureDate: "2026-11-16",
    closedPortion: 20_000_000,
    heldPortion: 50_000_000,
    schedule: [],
    interestBasePaise: 50_000_000n,
    principalPaise: 50_000_000n,
    annualRateBps: 750,
    interestStartDate: "2026-04-01",
  });
  assert.equal(position.remainingPrincipalPaise, 30_000_000n);
  assert.equal(position.fullExit, false);
  // No payout has fallen due, so interest runs from where it started accruing.
  assert.equal(position.accrualFrom, "2026-04-01");
  const whole = finance.calculateInterestForDates(50_000_000n, 750, "2026-04-01", "2026-11-16", "actual-365");
  assert.equal(position.accruedInterestPaise, (whole * 2n) / 5n);
});

test("a surviving payout is reduced to the portion still held", () => {
  const scaled = closure.scalePayout(
    { grossInterestPaise: 100_000n, principalRepaidPaise: 500_000n, expectedTdsPaise: 10_000n },
    8,
    10,
  );
  assert.equal(scaled.grossInterestPaise, 80_000n);
  assert.equal(scaled.principalRepaidPaise, 400_000n);
  assert.equal(scaled.expectedTdsPaise, 8_000n);
  assert.equal(scaled.expectedNetPaise, 472_000n);
});

test("fractional units keep their precision through a part-closure", () => {
  const position = closure.closurePosition({
    closureDate: "2026-11-16",
    closedPortion: 120.5,
    heldPortion: 241,
    schedule: [],
    interestBasePaise: 10_000_000n,
    principalPaise: 10_000_000n,
    annualRateBps: 1000,
    interestStartDate: "2026-11-01",
  });
  assert.equal(position.remainingPrincipalPaise, 5_000_000n);
  assert.equal(position.remainingPortion, 120.5);
});

test("maturity is the date arriving, not a button being pressed", () => {
  assert.equal(closure.hasMatured({ maturityDate: "2026-08-25", status: "active" }, "2026-09-10"), true);
  assert.equal(closure.hasMatured({ maturityDate: "2028-08-25", status: "active" }, "2026-09-10"), false);
  // On the day itself it has matured.
  assert.equal(closure.hasMatured({ maturityDate: "2026-09-10", status: "active" }, "2026-09-10"), true);
  // A holding sold out of does not later "mature".
  assert.equal(closure.hasMatured({ maturityDate: "2026-08-25", status: "closed" }, "2026-09-10"), false);
  // Something open-ended never matures.
  assert.equal(closure.hasMatured({ status: "active" }, "2026-09-10"), false);
});

test("a known rate is recovered from its own cash flows", () => {
  // ₹1,00,000 out, ₹1,10,000 back exactly a year later, is 10%.
  const rate = cashflow.annualisedReturn([
    { date: "2026-04-01", amountPaise: -10_000_000n },
    { date: "2027-04-01", amountPaise: 11_000_000n },
  ]);
  assert.ok(Math.abs(rate - 0.10) < 0.001, `expected ~0.10, got ${rate}`);
});

test("money coming back sooner is worth a higher rate", () => {
  const late = cashflow.annualisedReturn([
    { date: "2026-04-01", amountPaise: -10_000_000n },
    { date: "2027-04-01", amountPaise: 11_000_000n },
  ]);
  const early = cashflow.annualisedReturn([
    { date: "2026-04-01", amountPaise: -10_000_000n },
    { date: "2026-10-01", amountPaise: 11_000_000n },
  ]);
  assert.ok(early > late, `${early} should beat ${late}`);
});

test("a monthly coupon bond returns about its coupon", () => {
  const flows = [{ date: "2026-04-01", amountPaise: -10_000_000n }];
  for (let month = 1; month <= 12; month += 1) {
    const date = `2026-${String(4 + month).padStart(2, "0")}-01`;
    flows.push({
      date: month === 12 ? "2027-04-01" : date.replace(/^2026-(1[3-9]|2[0-9])/, (_, m) => `2027-${String(Number(m) - 12).padStart(2, "0")}`),
      amountPaise: month === 12 ? 10_000_000n + 83_333n : 83_333n,
    });
  }
  const rate = cashflow.annualisedReturn(flows);
  // Paid monthly rather than at the end, so slightly above the 10% coupon.
  assert.ok(rate > 0.10 && rate < 0.11, `expected 10-11%, got ${rate}`);
});

test("no rate is claimed where the flows cannot support one", () => {
  assert.equal(cashflow.annualisedReturn([]), null);
  assert.equal(cashflow.annualisedReturn([{ date: "2026-04-01", amountPaise: -100n }]), null);
  // Nothing ever comes back: a loss with no rate, not a rate of -100%.
  assert.equal(cashflow.annualisedReturn([
    { date: "2026-04-01", amountPaise: -100n },
    { date: "2027-04-01", amountPaise: -100n },
  ]), null);
});

test("cash flows land in the months they fall due", () => {
  const investment = {
    status: "active",
    investmentDate: "2026-09-04",
    principalPaise: 9_776_028n,
    schedule: [
      { dueDate: "2026-10-01", expectedNetPaise: 116_580n, receivedAmountPaise: undefined },
      { dueDate: "2026-10-20", expectedNetPaise: 100_000n, receivedAmountPaise: undefined },
      { dueDate: "2026-12-01", expectedNetPaise: 94_520n, receivedAmountPaise: 90_000n },
    ],
  };
  const months = cashflow.monthlyCashflow([investment], "2026-09-01", 4);
  assert.deepEqual(months.map((m) => m.month), ["2026-09-01", "2026-10-01", "2026-11-01", "2026-12-01"]);
  assert.equal(months[0].count, 0);
  // Two payouts in October, added together.
  assert.equal(months[1].count, 2);
  assert.equal(months[1].expectedPaise, 216_580n);
  // A month with nothing still appears, so the shape of the year is honest.
  assert.equal(months[2].expectedPaise, 0n);
  assert.equal(months[3].receivedPaise, 90_000n);
});

test("a closed holding is left out of the portfolio's rate", () => {
  const flows = cashflow.portfolioFlows([
    { status: "closed", investmentDate: "2026-04-01", principalPaise: 500n, schedule: [] },
    { status: "active", investmentDate: "2026-04-01", principalPaise: 100n, schedule: [{ dueDate: "2027-04-01", expectedNetPaise: 110n }] },
  ]);
  assert.deepEqual(flows, [
    { date: "2026-04-01", amountPaise: -100n },
    { date: "2027-04-01", amountPaise: 110n },
  ]);
});

test("an issuer's initials skip what it is registered as", () => {
  assert.equal(mark.issuerInitials("ORANGE RETAIL FINANCE INDIA PRIVATE LIMITED"), "OR");
  assert.equal(mark.issuerInitials("MUTHOOT FINANCE LIMITED"), "MF");
  assert.equal(mark.issuerInitials("Mangal Credit and Fincorp Limited"), "MC");
  assert.equal(mark.issuerInitials("State Bank of India"), "SB");
  assert.equal(mark.issuerInitials("Keertana Finserv"), "KF");
});

test("a one-word or unusable name still gets a mark", () => {
  assert.equal(mark.issuerInitials("Grip"), "GR");
  assert.equal(mark.issuerInitials("Limited"), "?");
  assert.equal(mark.issuerMark("   ").initials, "?");
});

test("an issuer keeps the same colour everywhere it is shown", () => {
  const name = "MUTHOOT FINANCE LIMITED";
  assert.equal(mark.issuerColour(name), mark.issuerColour(name));
  assert.notEqual(mark.issuerColour("A"), undefined);
  // Different issuers are not forced apart, but they do spread across the set.
  const spread = new Set(["Muthoot", "Orange", "Mangal", "Keertana", "UGRO"].map(mark.issuerColour));
  assert.ok(spread.size > 1);
});

test("a financial year's first month is read from its label, not sliced from it", () => {
  // The label carries its own prefix; slicing four characters yields "FY 2".
  assert.equal(cashflow.financialYearStart(finance.calculateFinancialYear("2026-09-10")), "2026-04-01");
  assert.equal(cashflow.financialYearStart("FY 2026-27"), "2026-04-01");
  assert.equal(cashflow.financialYearStart("2027-28"), "2027-04-01");
  assert.equal(cashflow.financialYearStart("not a year"), null);
});

test("a year's months run April to March", () => {
  const months = cashflow.monthlyCashflow([], cashflow.financialYearStart("FY 2026-27"), 12);
  assert.equal(months.length, 12);
  assert.equal(months[0].month, "2026-04-01");
  assert.equal(months.at(-1).month, "2027-03-01");
});
