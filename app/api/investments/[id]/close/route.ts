import { z } from "zod";

import { activityLogs, type BatchOperation, closures, commitAll, investments, listDocs, payoutSchedules, readDoc, setOp, updateOp } from "@/db";
import { calculateFinancialYear } from "@/core/finance/calculations";
import { closurePosition, scalePayout } from "@/core/finance/closure";
import { holdsUnits } from "@/core/data/investment-types";
import type { DayCountBasis, PayoutProjection } from "@/core/models/financial";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";

export const dynamic = "force-dynamic";

/**
 * Closes a holding before its maturity date, in whole or in part.
 *
 * A part-closure is not a smaller version of a full one: what is left keeps
 * running, so the payouts still ahead are reduced to the portion still held
 * rather than cancelled. Only a full exit ends the holding.
 */
const closureInput = z.object({
  closureDate: z.string().date(),
  /** Units sold, or paise withdrawn — whichever the holding is counted in. */
  closedPortion: z.number().positive().max(Number.MAX_SAFE_INTEGER),
  proceedsPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(identity.uid);
  if (paywall) return paywall;

  const { id } = await params;
  const parsed = closureInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check the closure details" }, { status: 400 });
  const input = parsed.data;

  const existing = await readDoc(investments(identity.uid).doc(id));
  if (!existing || existing.deletedAt) return Response.json({ error: "Investment not found" }, { status: 404 });
  if (existing.status === "closed") return Response.json({ error: "This holding is already closed" }, { status: 409 });
  if (input.closureDate < existing.investmentDate) {
    return Response.json({ error: "A holding cannot be closed before it was bought" }, { status: 400 });
  }

  const live = await listDocs(payoutSchedules(identity.uid)
    .where("deletedAt", "==", null)
    .where("investmentId", "==", id));

  const schedule: PayoutProjection[] = live.map((row) => ({
    id: row.id,
    dueDate: row.dueDate,
    financialYear: row.financialYear,
    grossInterestPaise: BigInt(row.grossInterestPaise),
    principalRepaidPaise: BigInt(row.principalRepaidPaise ?? 0),
    expectedTdsPaise: BigInt(row.expectedTdsPaise),
    expectedNetPaise: BigInt(row.expectedNetPaise),
    status: "upcoming",
  }));

  /*
   * A bond is sold in units and a deposit is broken for an amount, so what a
   * portion means depends on the holding. Counting a deposit in units it does
   * not have would make every part-closure of one an all-or-nothing choice.
   */
  const countedInUnits = holdsUnits(existing.investmentType as never) || Boolean(existing.units);
  const heldPortion = countedInUnits && existing.units ? existing.units : existing.principalPaise;

  const position = closurePosition({
    closureDate: input.closureDate,
    closedPortion: input.closedPortion,
    heldPortion,
    schedule,
    interestBasePaise: BigInt(existing.faceValuePaise ?? existing.principalPaise),
    principalPaise: BigInt(existing.principalPaise),
    annualRateBps: existing.interestRateBps,
    dayCountBasis: (existing.dayCountBasis ?? "actual-365") as DayCountBasis,
    interestStartDate: existing.interestStartDate ?? existing.investmentDate,
  });

  const now = new Date().toISOString();
  const closureId = crypto.randomUUID();
  const logId = crypto.randomUUID();
  const nextRevision = existing.revision + 1;
  const byId = new Map(schedule.map((row) => [row.id, row]));

  const operations: BatchOperation[] = [
    setOp(closures(identity.uid).doc(closureId), {
      id: closureId,
      investmentId: id,
      closureDate: input.closureDate,
      financialYear: calculateFinancialYear(input.closureDate),
      closedPortion: input.closedPortion,
      heldPortionBefore: heldPortion,
      proceedsPaise: input.proceedsPaise ?? null,
      accruedInterestPaise: Number(position.accruedInterestPaise),
      fullExit: position.fullExit,
      remarks: input.remarks || null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }),
    updateOp(investments(identity.uid).doc(id), {
      status: position.fullExit ? "closed" : existing.status,
      principalPaise: Number(position.remainingPrincipalPaise),
      // Face value falls with the holding too, or later coupons would be
      // computed on units that have been sold.
      faceValuePaise: existing.faceValuePaise === null || existing.faceValuePaise === undefined
        ? null
        : Math.round(existing.faceValuePaise * position.remainingRatio),
      units: countedInUnits && existing.units ? position.remainingPortion : (existing.units ?? null),
      revision: nextRevision,
      updatedAt: now,
    }),
    setOp(activityLogs(identity.uid).doc(logId), {
      id: logId,
      investmentId: id,
      actorType: "user",
      action: "closed",
      entityType: "investment",
      entityId: id,
      summary: position.fullExit
        ? `Closed early on ${input.closureDate}`
        : `Part-closed on ${input.closureDate}; ${position.remainingPortion} of ${heldPortion} still held`,
      nextSnapshot: JSON.stringify({
        accruedInterestPaise: Number(position.accruedInterestPaise),
        proceedsPaise: input.proceedsPaise ?? null,
        remainingPrincipalPaise: Number(position.remainingPrincipalPaise),
      }),
      createdAt: now,
    }),
  ];

  for (const payoutId of position.cancelledPayoutIds) {
    operations.push(updateOp(payoutSchedules(identity.uid).doc(payoutId), { deletedAt: now, updatedAt: now }));
  }
  for (const payoutId of position.scaledPayoutIds) {
    const row = byId.get(payoutId);
    if (!row) continue;
    const scaled = scalePayout(row, position.remainingPortion, heldPortion);
    operations.push(updateOp(payoutSchedules(identity.uid).doc(payoutId), {
      grossInterestPaise: Number(scaled.grossInterestPaise),
      principalRepaidPaise: Number(scaled.principalRepaidPaise),
      expectedTdsPaise: Number(scaled.expectedTdsPaise),
      expectedNetPaise: Number(scaled.expectedNetPaise),
      revision: nextRevision,
      updatedAt: now,
    }));
  }

  try {
    await commitAll(operations);
  } catch {
    return Response.json({ error: "The closure could not be saved" }, { status: 503 });
  }

  const backupWarning = await createUserBackup(identity).then(() => null).catch(() => "Firebase recovery backup is pending configuration");
  return Response.json({
    closureId,
    accruedInterestPaise: Number(position.accruedInterestPaise),
    remainingPrincipalPaise: Number(position.remainingPrincipalPaise),
    fullExit: position.fullExit,
    warning: backupWarning,
  });
}
