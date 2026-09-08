import { z } from "zod";

import { activityLogs, commitAll, firstDoc, payoutSchedules, payoutTransactions, readDoc, setOp, tdsRecords } from "@/db";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";

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

  const input = parsed.data;
  const schedule = await readDoc(payoutSchedules(ownerId).doc(input.scheduleId));
  if (!schedule || schedule.deletedAt) return Response.json({ error: "Payout not found" }, { status: 404 });

  const transaction = await firstDoc(payoutTransactions(ownerId)
    .where("deletedAt", "==", null)
    .where("payoutScheduleId", "==", schedule.id)
    .orderBy("createdAt", "desc"));
  const actualTdsPaise = transaction?.actualTdsPaise ?? null;
  const comparisonPaise = actualTdsPaise ?? schedule.expectedTdsPaise;
  const differencePaise = comparisonPaise - input.reflectedAmountPaise;
  const status = input.reflected && differencePaise === 0 ? "matched" : "mismatch";
  const recordId = crypto.randomUUID();
  const createdAt = new Date().toISOString();

  try {
    const logId = crypto.randomUUID();
    await commitAll([
      setOp(tdsRecords(ownerId).doc(recordId), {
        id: recordId,
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
        certificateReceived: false,
        status,
        remarks: input.remarks || null,
        createdAt,
        updatedAt: createdAt,
        deletedAt: null,
      }),
      setOp(activityLogs(ownerId).doc(logId), {
        id: logId,
        investmentId: schedule.investmentId,
        actorType: "user",
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
