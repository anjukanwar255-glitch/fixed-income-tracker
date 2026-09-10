import { z } from "zod";

import { activityLogs, commitAll, firstDoc, forms, investments, readDoc, setOp, updateOp } from "@/db";
import { DECLARATION_FORM_TYPE, DECLARATION_STATUSES } from "@/core/tax/declarations";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";

export const dynamic = "force-dynamic";

/**
 * Records the declaration filed against an investment for one financial year.
 *
 * A declaration lapses every 31 March, so it is stored per year rather than as
 * a flag on the investment. Only what was actually filed is kept — whether a
 * year still needs one is worked out from the absence of a record, so a new
 * financial year raises the question by itself.
 */
const declaration = z.object({
  investmentId: z.string().uuid(),
  financialYear: z.string().regex(/^\d{4}-\d{2}$/, "Use a financial year like 2026-27"),
  status: z.enum(DECLARATION_STATUSES),
  submissionDate: z.string().date().optional(),
  acknowledgementNumber: z.string().trim().max(80).optional(),
  remarks: z.string().trim().max(1000).optional(),
});

export async function POST(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const ownerId = identity.uid;
  const paywall = await requireEntitlement(ownerId);
  if (paywall) return paywall;

  const parsed = declaration.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check the declaration details" }, { status: 400 });

  const input = parsed.data;
  const investment = await readDoc(investments(ownerId).doc(input.investmentId));
  if (!investment || investment.deletedAt) return Response.json({ error: "Investment not found" }, { status: 404 });

  const now = new Date().toISOString();
  const submitted = input.status === "submitted" || input.status === "accepted";

  try {
    // One record per year: filing again, or hearing back on what was filed,
    // updates the year's record rather than stacking another beside it.
    const existing = await firstDoc(forms(ownerId)
      .where("deletedAt", "==", null)
      .where("investmentId", "==", input.investmentId)
      .where("financialYear", "==", input.financialYear));

    const fields = {
      formType: DECLARATION_FORM_TYPE,
      required: true,
      submitted,
      submissionDate: input.submissionDate ?? null,
      accepted: input.status === "accepted",
      acknowledgementNumber: input.acknowledgementNumber || null,
      status: input.status,
      remarks: input.remarks || null,
      updatedAt: now,
    };

    const formId = existing?.id ?? crypto.randomUUID();
    const logId = crypto.randomUUID();
    await commitAll([
      existing
        ? updateOp(forms(ownerId).doc(formId), fields)
        : setOp(forms(ownerId).doc(formId), {
            id: formId,
            investmentId: input.investmentId,
            financialYear: input.financialYear,
            ...fields,
            createdAt: now,
            deletedAt: null,
          }),
      setOp(activityLogs(ownerId).doc(logId), {
        id: logId,
        investmentId: input.investmentId,
        actorType: "user",
        action: existing ? "updated" : "created",
        entityType: "form",
        entityId: formId,
        summary: `${DECLARATION_FORM_TYPE} for ${input.financialYear} marked ${input.status}`,
        createdAt: now,
      }),
    ]);

    const backupWarning = await createUserBackup(identity).then(() => null).catch(() => "Firebase recovery backup is pending configuration");
    return Response.json({ formId, warning: backupWarning });
  } catch {
    return Response.json({ error: "The declaration could not be saved" }, { status: 503 });
  }
}
