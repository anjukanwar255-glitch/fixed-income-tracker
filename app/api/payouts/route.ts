import { z } from "zod";

import {
  activityLogs,
  commitAll,
  FieldValue,
  firstDoc,
  investments,
  payoutSchedules,
  payoutTransactions,
  readDoc,
  setOp,
  tdsRecords,
  updateOp,
} from "@/db";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";

export const dynamic = "force-dynamic";

const payoutConfirmation = z.object({
  scheduleId: z.string().uuid(),
  outcome: z.enum(["received", "not-received"]),
  receivedAmountPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  receivedDate: z.string().date().optional(),
  actualTdsPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  principalRepaidPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  bankAccountNumber: z.string().regex(/^\d{9,18}$/).optional().or(z.literal("")),
  paymentReference: z.string().trim().max(120).optional(),
  followUpDate: z.string().date().optional(),
  remarks: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (value.outcome === "received" && value.receivedAmountPaise === undefined) {
    context.addIssue({ code: "custom", path: ["receivedAmountPaise"], message: "Received amount is required" });
  }
  if (value.outcome === "received" && !value.receivedDate) {
    context.addIssue({ code: "custom", path: ["receivedDate"], message: "Received date is required" });
  }
});

export async function POST(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const ownerId = identity.uid;
  const paywall = await requireEntitlement(ownerId);
  if (paywall) return paywall;

  const parsed = payoutConfirmation.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "Please check the payout details", issues: parsed.error.flatten() }, { status: 400 });
  }

  const input = parsed.data;
  const schedule = await readDoc(payoutSchedules(ownerId).doc(input.scheduleId));
  if (!schedule || schedule.deletedAt) return Response.json({ error: "Payout not found" }, { status: 404 });

  const investment = await readDoc(investments(ownerId).doc(schedule.investmentId));
  if (!investment || investment.deletedAt) return Response.json({ error: "Investment not found" }, { status: 404 });

  const previous = await firstDoc(payoutTransactions(ownerId)
    .where("deletedAt", "==", null)
    .where("payoutScheduleId", "==", schedule.id)
    .orderBy("createdAt", "desc"));

  const createdAt = new Date().toISOString();
  const receivedAmount = input.receivedAmountPaise ?? null;
  const status = input.outcome === "not-received"
    ? "not-received"
    : receivedAmount !== null && receivedAmount < schedule.expectedNetPaise
      ? "partial-received"
      : "received";
  const transactionId = crypto.randomUUID();

  const logId = crypto.randomUUID();
  const operations = [
    setOp(payoutTransactions(ownerId).doc(transactionId), {
      id: transactionId,
      payoutScheduleId: schedule.id,
      investmentId: schedule.investmentId,
      receivedAmountPaise: receivedAmount,
      receivedDate: input.receivedDate ?? null,
      actualTdsPaise: input.actualTdsPaise ?? null,
      principalRepaidPaise: input.principalRepaidPaise ?? null,
      bankAccountNumber: input.bankAccountNumber || null,
      paymentReference: input.paymentReference || null,
      proofObjectKey: null,
      status,
      followUpDate: input.followUpDate ?? null,
      remarks: input.remarks || null,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    }),
    updateOp(payoutSchedules(ownerId).doc(schedule.id), {
      status,
      // Atomic, so a concurrent confirmation cannot lose a revision bump.
      revision: FieldValue.increment(1),
      updatedAt: createdAt,
    }),
    setOp(activityLogs(ownerId).doc(logId), {
      id: logId,
      investmentId: schedule.investmentId,
      actorType: "user",
      action: input.outcome === "received" ? "payout-confirmed" : "payout-not-received",
      entityType: "payout",
      entityId: transactionId,
      summary: input.outcome === "received"
        ? `Payout for ${investment.investmentName} confirmed as ${status}`
        : `Payout for ${investment.investmentName} marked not received`,
      previousSnapshot: previous ? JSON.stringify({
        status: previous.status,
        receivedAmountPaise: previous.receivedAmountPaise,
        receivedDate: previous.receivedDate,
      }) : null,
      nextSnapshot: JSON.stringify({
        status,
        receivedAmountPaise: receivedAmount,
        receivedDate: input.receivedDate ?? null,
        actualTdsPaise: input.actualTdsPaise ?? null,
      }),
      createdAt,
    }),
  ];

  const tdsRecordId = crypto.randomUUID();
  const tdsOperation = input.outcome === "received"
    ? setOp(tdsRecords(ownerId).doc(tdsRecordId), {
      id: tdsRecordId,
      investmentId: schedule.investmentId,
      payoutScheduleId: schedule.id,
      financialYear: schedule.financialYear,
      grossInterestPaise: schedule.grossInterestPaise,
      expectedTdsRateBps: schedule.expectedTdsRateBps,
      expectedTdsPaise: schedule.expectedTdsPaise,
      actualTdsPaise: input.actualTdsPaise ?? null,
      differencePaise: input.actualTdsPaise === undefined ? null : schedule.expectedTdsPaise - input.actualTdsPaise,
      certificateReceived: false,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    })
    : null;

  try {
    await commitAll(tdsOperation ? [...operations, tdsOperation] : operations);
    const backupWarning = await createUserBackup(identity)
      .then(() => null)
      .catch(() => "Payout saved, but the recovery snapshot could not be refreshed");
    return Response.json({ transactionId, status, backupWarning }, { status: 201 });
  } catch {
    return Response.json({ error: "Payout confirmation could not be saved" }, { status: 503 });
  }
}
