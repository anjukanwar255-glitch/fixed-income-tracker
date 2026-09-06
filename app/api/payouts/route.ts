import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";
import {
  activityLogs,
  investments,
  payoutSchedules,
  payoutTransactions,
  tdsRecords,
} from "@/db/schema";

export const dynamic = "force-dynamic";

const payoutConfirmation = z.object({
  scheduleId: z.string().uuid(),
  outcome: z.enum(["received", "not-received"]),
  receivedAmountPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  receivedDate: z.string().date().optional(),
  actualTdsPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  bankAccountLast4: z.string().regex(/^\d{4}$/).optional().or(z.literal("")),
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

  const db = getDb();
  const input = parsed.data;
  const [schedule] = await db.select().from(payoutSchedules).where(and(
    eq(payoutSchedules.id, input.scheduleId),
    eq(payoutSchedules.userId, ownerId),
    isNull(payoutSchedules.deletedAt),
  )).limit(1);
  if (!schedule) return Response.json({ error: "Payout not found" }, { status: 404 });

  const [investment] = await db.select({ name: investments.investmentName }).from(investments).where(and(
    eq(investments.id, schedule.investmentId),
    eq(investments.userId, ownerId),
    isNull(investments.deletedAt),
  )).limit(1);
  if (!investment) return Response.json({ error: "Investment not found" }, { status: 404 });

  const [previous] = await db.select().from(payoutTransactions).where(and(
    eq(payoutTransactions.payoutScheduleId, schedule.id),
    eq(payoutTransactions.userId, ownerId),
    isNull(payoutTransactions.deletedAt),
  )).orderBy(desc(payoutTransactions.createdAt)).limit(1);

  const createdAt = new Date().toISOString();
  const receivedAmount = input.receivedAmountPaise ?? null;
  const status = input.outcome === "not-received"
    ? "not-received"
    : receivedAmount !== null && receivedAmount < schedule.expectedNetPaise
      ? "partial-received"
      : "received";
  const transactionId = crypto.randomUUID();

  const operations = [
    db.insert(payoutTransactions).values({
      id: transactionId,
      payoutScheduleId: schedule.id,
      investmentId: schedule.investmentId,
      userId: ownerId,
      receivedAmountPaise: receivedAmount,
      receivedDate: input.receivedDate ?? null,
      actualTdsPaise: input.actualTdsPaise ?? null,
      bankAccountLast4: input.bankAccountLast4 || null,
      paymentReference: input.paymentReference || null,
      status,
      followUpDate: input.followUpDate ?? null,
      remarks: input.remarks || null,
      createdAt,
      updatedAt: createdAt,
    }),
    db.update(payoutSchedules).set({
      status,
      revision: sql`${payoutSchedules.revision} + 1`,
      updatedAt: createdAt,
    }).where(and(eq(payoutSchedules.id, schedule.id), eq(payoutSchedules.userId, ownerId))),
    db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      userId: ownerId,
      investmentId: schedule.investmentId,
      action: input.outcome === "received" ? "payout-confirmed" : "payout-not-received",
      entityType: "payout",
      entityId: transactionId,
      summary: input.outcome === "received"
        ? `Payout for ${investment.name} confirmed as ${status}`
        : `Payout for ${investment.name} marked not received`,
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

  const tdsOperation = input.outcome === "received"
    ? db.insert(tdsRecords).values({
      id: crypto.randomUUID(),
      userId: ownerId,
      investmentId: schedule.investmentId,
      payoutScheduleId: schedule.id,
      financialYear: schedule.financialYear,
      grossInterestPaise: schedule.grossInterestPaise,
      expectedTdsRateBps: schedule.expectedTdsRateBps,
      expectedTdsPaise: schedule.expectedTdsPaise,
      actualTdsPaise: input.actualTdsPaise ?? null,
      differencePaise: input.actualTdsPaise === undefined ? null : schedule.expectedTdsPaise - input.actualTdsPaise,
      status: "pending",
      createdAt,
      updatedAt: createdAt,
    })
    : null;

  try {
    const batch = tdsOperation ? [...operations, tdsOperation] : operations;
    await db.batch(batch as unknown as Parameters<typeof db.batch>[0]);
    const backupWarning = await createUserBackup(identity)
      .then(() => null)
      .catch(() => "Payout saved, but the recovery snapshot could not be refreshed");
    return Response.json({ transactionId, status, backupWarning }, { status: 201 });
  } catch {
    return Response.json({ error: "Payout confirmation could not be saved" }, { status: 503 });
  }
}
