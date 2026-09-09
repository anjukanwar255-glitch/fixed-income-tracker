import { z } from "zod";

import { calculateFinancialYear, generatePayoutSchedule } from "@/core/finance/calculations";
import type { InvestmentDraft } from "@/core/models/financial";
import {
  activityLogs,
  type BatchOperation,
  commitAll,
  firstDoc,
  investments,
  listDocs,
  payoutSchedules,
  payoutTransactions,
  readDoc,
  setOp,
  updateOp,
} from "@/db";
import { createUserBackup } from "@/lib/backups";
import { requireEntitlement } from "@/lib/billing";
import { authenticatedRequest, hasRecentAuthentication } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

const updateInput = z.object({
  investmentType: z.string().min(1),
  investmentName: z.string().trim().min(2).max(120),
  issuerName: z.string().trim().min(2).max(120),
  investmentNumber: z.string().trim().max(80).default(""),
  principalPaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  faceValuePaise: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).optional(),
  interestRateBps: z.number().int().min(0).max(100_000),
  interestType: z.enum(["simple", "compound", "cumulative"]),
  compoundingFrequency: z.enum(["monthly", "quarterly", "half-yearly", "yearly"]),
  dayCountBasis: z.enum(["actual-365", "actual-actual", "30-360"]),
  payoutFrequency: z.enum(["monthly", "quarterly", "half-yearly", "yearly", "on-maturity", "custom"]),
  investmentDate: z.string().date(),
  interestStartDate: z.string().date().optional(),
  firstPayoutDate: z.string().date(),
  maturityDate: z.string().date(),
  expectedMaturityPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  tdsApplicable: z.boolean(),
  expectedTdsRateBps: z.number().int().min(0).max(10_000),
  panLinked: z.boolean().default(false),
  declarationApplicable: z.boolean().default(false),
  bankName: z.string().trim().max(100).optional(),
  accountLast4: z.string().regex(/^\d{4}$/).optional().or(z.literal("")),
  paymentMode: z.string().trim().max(50).optional(),
  nominee: z.string().trim().max(100).optional(),
  brokerPlatform: z.string().trim().max(100).optional(),
  dpId: z.string().trim().max(40).optional(),
  clientId: z.string().trim().max(40).optional(),
  orderReference: z.string().trim().max(80).optional(),
  advisorName: z.string().trim().max(100).optional(),
  notes: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (value.maturityDate <= value.investmentDate) context.addIssue({ code: "custom", path: ["maturityDate"], message: "Maturity must be after investment date" });
  if (value.payoutFrequency !== "on-maturity" && (value.firstPayoutDate < value.investmentDate || value.firstPayoutDate > value.maturityDate)) {
    context.addIssue({ code: "custom", path: ["firstPayoutDate"], message: "First payout must fall within the investment term" });
  }
  if (value.interestType !== "simple" && value.payoutFrequency !== "on-maturity") {
    context.addIssue({ code: "custom", path: ["payoutFrequency"], message: "Compound and cumulative investments pay on maturity" });
  }
});

const statusInput = z.object({ action: z.enum(["mature", "close", "archive", "reactivate"]) });

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(identity.uid);
  if (paywall) return paywall;
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const status = statusInput.safeParse(body);
  if (status.success) return updateStatus(identity, id, status.data.action);

  const parsed = updateInput.safeParse(body);
  if (!parsed.success) return Response.json({ error: "Please check the investment details", issues: parsed.error.flatten() }, { status: 400 });
  const input = parsed.data;
  const stored = await readDoc(investments(identity.uid).doc(id));
  const existing = stored && !stored.deletedAt ? stored : null;
  if (!existing) return Response.json({ error: "Investment not found" }, { status: 404 });

  const financialChanged = financialSignature(existing) !== financialSignature({
    principalPaise: input.principalPaise,
    faceValuePaise: input.faceValuePaise ?? null,
    interestRateBps: input.interestRateBps,
    interestType: input.interestType,
    compoundingFrequency: input.compoundingFrequency,
    dayCountBasis: input.dayCountBasis,
    payoutFrequency: input.payoutFrequency,
    investmentDate: input.investmentDate,
    interestStartDate: input.interestStartDate ?? null,
    firstPayoutDate: input.firstPayoutDate,
    maturityDate: input.maturityDate,
    expectedMaturityPaise: input.expectedMaturityPaise ?? null,
    tdsApplicable: input.tdsApplicable,
    expectedTdsRateBps: input.expectedTdsRateBps,
  });
  if (financialChanged) {
    const settled = await firstDoc(payoutTransactions(identity.uid)
      .where("deletedAt", "==", null)
      .where("investmentId", "==", id));
    if (settled) return Response.json({ error: "Financial terms cannot be replaced after a payout is recorded. Archive this investment and create a revised record." }, { status: 409 });
  }

  const draft: InvestmentDraft = {
    type: input.investmentType as InvestmentDraft["type"], name: input.investmentName, issuer: input.issuerName,
    investmentNumber: input.investmentNumber, investmentDate: input.investmentDate, principalPaise: BigInt(input.principalPaise),
    faceValuePaise: input.faceValuePaise === undefined ? undefined : BigInt(input.faceValuePaise),
    interestStartDate: input.interestStartDate,
    annualRateBps: input.interestRateBps, interestType: input.interestType, compoundingFrequency: input.compoundingFrequency,
    dayCountBasis: input.dayCountBasis, payoutFrequency: input.payoutFrequency, firstPayoutDate: input.firstPayoutDate,
    maturityDate: input.maturityDate, expectedMaturityPaise: input.expectedMaturityPaise === undefined ? undefined : BigInt(input.expectedMaturityPaise),
    tdsApplicable: input.tdsApplicable, expectedTdsRateBps: input.expectedTdsRateBps,
  };
  const schedule = generatePayoutSchedule(draft);
  const now = new Date().toISOString();
  const nextRevision = existing.revision + 1;
  const operations: BatchOperation[] = [
    updateOp(investments(identity.uid).doc(id), {
      investmentType: input.investmentType, investmentName: input.investmentName, issuerNameSnapshot: input.issuerName,
      investmentNumber: input.investmentNumber, principalPaise: input.principalPaise, faceValuePaise: input.faceValuePaise ?? null,
      interestRateBps: input.interestRateBps,
      interestType: input.interestType, compoundingFrequency: input.compoundingFrequency, dayCountBasis: input.dayCountBasis,
      payoutFrequency: input.payoutFrequency, investmentDate: input.investmentDate, interestStartDate: input.interestStartDate ?? null,
      firstPayoutDate: input.firstPayoutDate,
      maturityDate: input.maturityDate, expectedMaturityPaise: input.expectedMaturityPaise ?? null, tdsApplicable: input.tdsApplicable,
      expectedTdsRateBps: input.expectedTdsRateBps, panLinked: input.panLinked, declarationApplicable: input.declarationApplicable,
      bankName: input.bankName ?? null, accountLast4: input.accountLast4 || null, paymentMode: input.paymentMode ?? null, nominee: input.nominee ?? null,
      brokerPlatform: input.brokerPlatform ?? null, dpId: input.dpId ?? null, clientId: input.clientId ?? null,
      orderReference: input.orderReference ?? null, advisorName: input.advisorName ?? null, notes: input.notes ?? null,
      financialYear: calculateFinancialYear(input.investmentDate), revision: nextRevision, updatedAt: now,
    }),
  ];
  if (financialChanged) {
    // Firestore has no "update where"; the rows to retire are read first.
    const live = await listDocs(payoutSchedules(identity.uid)
      .where("deletedAt", "==", null)
      .where("investmentId", "==", id));
    for (const row of live) {
      operations.push(updateOp(payoutSchedules(identity.uid).doc(row.id), { deletedAt: now, updatedAt: now }));
    }
    for (const payout of schedule) {
      const payoutId = crypto.randomUUID();
      operations.push(setOp(payoutSchedules(identity.uid).doc(payoutId), {
        id: payoutId, investmentId: id, dueDate: payout.dueDate,
        financialYear: payout.financialYear, grossInterestPaise: Number(payout.grossInterestPaise), expectedTdsRateBps: input.expectedTdsRateBps,
        expectedTdsPaise: Number(payout.expectedTdsPaise), expectedNetPaise: Number(payout.expectedNetPaise), status: payout.status,
        source: "generated", revision: nextRevision, createdAt: now, updatedAt: now, deletedAt: null,
      }));
    }
  }
  const logId = crypto.randomUUID();
  operations.push(setOp(activityLogs(identity.uid).doc(logId), {
    id: logId, investmentId: id, actorType: "user", action: "updated", entityType: "investment", entityId: id,
    summary: financialChanged ? "Investment terms updated and future schedule regenerated" : "Investment references updated",
    previousSnapshot: JSON.stringify({ revision: existing.revision, name: existing.investmentName }),
    nextSnapshot: JSON.stringify({ revision: nextRevision, name: input.investmentName }), createdAt: now,
  }));
  await commitAll(operations);
  const backupWarning = await createUserBackup(identity).then(() => null).catch(() => "Firebase recovery backup is pending configuration");
  return Response.json({ investmentId: id, scheduleCount: schedule.length, warning: backupWarning });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasRecentAuthentication(identity)) return Response.json({ error: "Please sign in again before archiving an investment" }, { status: 403 });
  const paywall = await requireEntitlement(identity.uid);
  if (paywall) return paywall;
  return updateStatus(identity, (await params).id, "archive");
}

async function updateStatus(identity: NonNullable<Awaited<ReturnType<typeof authenticatedRequest>>>, id: string, action: "mature" | "close" | "archive" | "reactivate") {
  const existing = await readDoc(investments(identity.uid).doc(id));
  if (!existing || (existing.deletedAt && action !== "reactivate")) return Response.json({ error: "Investment not found" }, { status: 404 });
  const now = new Date().toISOString();
  const nextStatus = action === "mature" ? "matured" : action === "reactivate" ? "active" : "closed";
  const logId = crypto.randomUUID();
  await commitAll([
    updateOp(investments(identity.uid).doc(id), { status: nextStatus, deletedAt: action === "archive" ? now : action === "reactivate" ? null : existing.deletedAt ?? null, revision: existing.revision + 1, updatedAt: now }),
    setOp(activityLogs(identity.uid).doc(logId), { id: logId, investmentId: id, actorType: "user", action, entityType: "investment", entityId: id, summary: `Investment ${action === "archive" ? "archived" : `marked ${nextStatus}`}`, previousSnapshot: JSON.stringify({ status: existing.status }), nextSnapshot: JSON.stringify({ status: nextStatus }), createdAt: now }),
  ]);
  await createUserBackup(identity).catch(() => undefined);
  return Response.json({ investmentId: id, status: nextStatus, archived: action === "archive" });
}

/**
 * The terms that decide whether the payout schedule has to be regenerated.
 * Named explicitly rather than taken as a loose record, so adding a financial
 * field to the investment fails here until it is considered.
 */
type FinancialTerms = {
  principalPaise: number;
  faceValuePaise?: number | null;
  interestRateBps: number;
  interestType: string;
  compoundingFrequency: string;
  dayCountBasis: string;
  payoutFrequency: string;
  investmentDate: string;
  interestStartDate?: string | null;
  firstPayoutDate?: string | null;
  maturityDate: string;
  expectedMaturityPaise?: number | null;
  tdsApplicable: boolean;
  expectedTdsRateBps: number;
};

function financialSignature(value: FinancialTerms) {
  return JSON.stringify([
    value.principalPaise, value.faceValuePaise ?? null, value.interestRateBps, value.interestType, value.compoundingFrequency,
    value.dayCountBasis, value.payoutFrequency, value.investmentDate, value.interestStartDate ?? null,
    value.firstPayoutDate, value.maturityDate, value.expectedMaturityPaise,
    value.tdsApplicable, value.expectedTdsRateBps,
  ]);
}
