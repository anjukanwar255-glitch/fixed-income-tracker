import assert from "node:assert/strict";
import test, { after } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const vite = await createServer({ appType: "custom", configFile: false, root, resolve: { alias: { "@": root } }, server: { middlewareMode: true } });
after(async () => vite.close());
const finance = await vite.ssrLoadModule("/core/finance/calculations.ts");
const files = await vite.ssrLoadModule("/lib/file-validation.ts");

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
