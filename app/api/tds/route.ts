import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";
import { activityLogs, payoutSchedules, payoutTransactions, tdsRecords } from "@/db/schema";

export const dynamic = "force-dynamic";

const tdsVerification = z.object({
  scheduleId: z.string().uuid(),
  reflected: z.boolean(),
  reflectedAmountPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  verificationDate: z.string().date(),
  remarks: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const ownerId = identity.uid;
  const paywall = await requireEntitlement(ownerId);
  if (paywall) return paywall;

  const parsed = tdsVerification.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check the TDS verification details" }, { status: 400 });

  const db = getDb();
  const input = parsed.data;
  const [schedule] = await db.select().from(payoutSchedules).where(and(
    eq(payoutSchedules.id, input.scheduleId),
    eq(payoutSchedules.userId, ownerId),
    isNull(payoutSchedules.deletedAt),
  )).limit(1);
  if (!schedule) return Response.json({ error: "Payout not found" }, { status: 404 });

  const [transaction] = await db.select().from(payoutTransactions).where(and(
    eq(payoutTransactions.payoutScheduleId, schedule.id),
    eq(payoutTransactions.userId, ownerId),
    isNull(payoutTransactions.deletedAt),
  )).orderBy(desc(payoutTransactions.createdAt)).limit(1);
  const actualTdsPaise = transaction?.actualTdsPaise ?? null;
  const comparisonPaise = actualTdsPaise ?? schedule.expectedTdsPaise;
  const differencePaise = comparisonPaise - input.reflectedAmountPaise;
  const status = input.reflected && differencePaise === 0 ? "matched" : "mismatch";
  const recordId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    await db.batch([
      db.insert(tdsRecords).values({
        id: recordId,
        userId: ownerId,
        investmentId: schedule.investmentId,
        payoutScheduleId: schedule.id,
        financialYear: schedule.financialYear,
        grossInterestPaise: schedule.grossInterestPaise,
        expectedTdsRateBps: schedule.expectedTdsRateBps,
        expectedTdsPaise: schedule.expectedTdsPaise,
        actualTdsPaise,
        tdsReflected: input.reflected,
        reflectedAmountPaise: input.reflectedAmountPaise,
        differencePaise,
        verificationDate: input.verificationDate,
        status,
        remarks: input.remarks || null,
        createdAt,
        updatedAt: createdAt,
      }),
      db.insert(activityLogs).values({
        id: crypto.randomUUID(),
        userId: ownerId,
        investmentId: schedule.investmentId,
        action: "tds-verified",
        entityType: "tds-record",
        entityId: recordId,
        summary: `TDS credit verification saved as ${status}`,
        nextSnapshot: JSON.stringify({
          reflected: input.reflected,
          reflectedAmountPaise: input.reflectedAmountPaise,
          verificationDate: input.verificationDate,
          status,
        }),
        createdAt,
      }),
    ]);
    const backupWarning = await createUserBackup(identity)
      .then(() => null)
      .catch(() => "TDS verification saved, but the recovery snapshot could not be refreshed");
    return Response.json({ recordId, status, backupWarning }, { status: 201 });
  } catch {
    return Response.json({ error: "TDS verification could not be saved" }, { status: 503 });
  }
}
