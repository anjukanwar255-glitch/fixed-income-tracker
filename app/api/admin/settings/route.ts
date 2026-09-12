import { z } from "zod";

import { activityLogs, setOp, commitAll } from "@/db";
import { subscriptionPlans } from "@/lib/plans";
import { isAdministrator, readAdminSettings, writeAdminSettings } from "@/lib/admin-settings";
import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The settings an administrator controls.
 *
 * Gated on the stored role rather than on a shared secret, so the same sign-in
 * that protects everything else protects this — there is no second credential
 * to leak, rotate or forget.
 */
const settingsInput = z.object({
  maintenance: z.object({
    enabled: z.boolean(),
    message: z.string().trim().max(500),
    until: z.string().datetime().nullable().optional(),
  }),
  planRates: z.array(z.object({
    code: z.enum(subscriptionPlans.map((plan) => plan.code) as [string, ...string[]]),
    // A price of zero would read as free rather than as unset, so it is refused.
    amountPaise: z.number().int().positive().max(100_000_00),
  })).max(subscriptionPlans.length),
  supportUrl: z.string().trim().url().max(300).nullable().optional(),
  // Bounded: a trial of zero locks every new account out on sight, and one of
  // a year is a mistake rather than a policy.
  trialDays: z.number().int().min(1).max(90),
  // Zero is allowed and means scanning is off, which is a real choice; the
  // upper bound is there so a slipped digit cannot uncap it.
  monthlyScanLimit: z.number().int().min(0).max(5_000),
});

export async function GET() {
  const identity = await authenticatedUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!await isAdministrator(identity.uid)) return Response.json({ error: "Not permitted" }, { status: 403 });
  return Response.json(await readAdminSettings(), { headers: { "cache-control": "no-store" } });
}

export async function PUT(request: Request) {
  const identity = await authenticatedUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!await isAdministrator(identity.uid)) return Response.json({ error: "Not permitted" }, { status: 403 });

  const limited = await rateLimit(request, "admin-settings", identity.uid, 60, 60 * 60 * 1000);
  if (limited) return limited;

  const parsed = settingsInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Please check the settings" }, { status: 400 });

  const input = parsed.data;
  try {
    const updatedAt = await writeAdminSettings({
      maintenance: {
        enabled: input.maintenance.enabled,
        message: input.maintenance.message,
        until: input.maintenance.until ?? null,
      },
      planRates: input.planRates.map((rate) => ({ code: rate.code as never, amountPaise: rate.amountPaise })),
      supportUrl: input.supportUrl ?? null,
      trialDays: input.trialDays,
      monthlyScanLimit: input.monthlyScanLimit,
    }, identity.uid);

    // Under the administrator's own tree: who changed a published price, and
    // when, is the first thing anyone asks afterwards.
    const logId = crypto.randomUUID();
    await commitAll([setOp(activityLogs(identity.uid).doc(logId), {
      id: logId,
      actorType: "admin",
      action: "updated",
      entityType: "admin-settings",
      entityId: "global",
      summary: input.maintenance.enabled ? "Maintenance notice turned on" : "Administered settings updated",
      nextSnapshot: JSON.stringify(input),
      createdAt: updatedAt,
    })]);

    return Response.json({ updatedAt });
  } catch {
    return Response.json({ error: "The settings could not be saved" }, { status: 503 });
  }
}
