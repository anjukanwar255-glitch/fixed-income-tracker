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
