import { z } from "zod";

import { activityLogs, commitAll, contributions, investments, readDoc, setOp, updateOp } from "@/db";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";

export const dynamic = "force-dynamic";

/**
 * Records whether a SIP instalment or an insurance premium was actually paid.
 *
 * The mirror of confirming a payout, and the reason contributions are tracked
 * one by one rather than as a standing instruction: a missed premium lapses a
 * policy, and the only way to see that coming is to know which ones went.
 */
const confirmation = z.object({
  contributionId: z.string().uuid(),
  outcome: z.enum(["paid", "missed"]),
  paidAmountPaise: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(),
  paidDate: z.string().date().optional(),
  paymentReference: z.string().trim().max(120).optional(),
  remarks: z.string().trim().max(1000).optional(),
}).superRefine((value, context) => {
  if (value.outcome === "paid" && value.paidAmountPaise === undefined) {
    context.addIssue({ code: "custom", path: ["paidAmountPaise"], message: "Enter the amount paid" });
  }
  if (value.outcome === "paid" && !value.paidDate) {
    context.addIssue({ code: "custom", path: ["paidDate"], message: "Enter the date it was paid" });
  }
});

export async function POST(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const ownerId = identity.uid;
  const paywall = await requireEntitlement(ownerId);
  if (paywall) return paywall;

  const parsed = confirmation.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check the payment details" }, { status: 400 });

  const input = parsed.data;
  const row = await readDoc(contributions(ownerId).doc(input.contributionId));
  if (!row || row.deletedAt) return Response.json({ error: "Instalment not found" }, { status: 404 });

  const investment = await readDoc(investments(ownerId).doc(row.investmentId));
  if (!investment || investment.deletedAt) return Response.json({ error: "Investment not found" }, { status: 404 });

  const now = new Date().toISOString();
  const paid = input.outcome === "paid";

  try {
    const logId = crypto.randomUUID();
    await commitAll([
      updateOp(contributions(ownerId).doc(row.id), {
        status: input.outcome,
        // Cleared rather than left behind when an instalment is marked missed:
        // a stale amount would keep counting as money in.
        paidAmountPaise: paid ? (input.paidAmountPaise ?? row.amountPaise) : null,
        paidDate: paid ? (input.paidDate ?? null) : null,
        paymentReference: input.paymentReference || null,
        remarks: input.remarks || null,
        revision: row.revision + 1,
        updatedAt: now,
      }),
      setOp(activityLogs(ownerId).doc(logId), {
        id: logId,
        investmentId: row.investmentId,
        actorType: "user",
        action: "updated",
        entityType: "contribution",
        entityId: row.id,
        summary: paid
          ? `Instalment due ${row.dueDate} marked paid`
          : `Instalment due ${row.dueDate} marked missed`,
        createdAt: now,
      }),
    ]);

    const backupWarning = await createUserBackup(identity).then(() => null).catch(() => "Firebase recovery backup is pending configuration");
    return Response.json({ contributionId: row.id, warning: backupWarning });
  } catch {
    return Response.json({ error: "The payment could not be saved" }, { status: 503 });
  }
}
