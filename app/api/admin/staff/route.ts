import { z } from "zod";

import { userDoc } from "@/db";
import { can, findByMobile, listStaff, recordStaffAction, resolveActor } from "@/lib/staff";
import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Who may sign in to the console.
 *
 * Appointing staff is an administrator's job alone. Staff who could appoint
 * staff could give themselves an administrator, and the difference between the
 * two would stop meaning anything.
 */
const appointInput = z.object({
  mobileE164: z.string().trim().regex(/^\+91[6-9]\d{9}$/, "Enter the mobile number the account signs in with"),
  role: z.enum(["support", "admin"]),
});

const removeInput = z.object({ uid: z.string().trim().min(6).max(128) });

export async function GET() {
  const identity = await authenticatedUser();
  const actor = identity ? await resolveActor(identity.uid) : null;
  if (!actor) return Response.json({ error: "Not permitted" }, { status: 403 });
  // Staff may see who else works here; only an administrator may change it.
  return Response.json({ staff: await listStaff(), canManage: can(actor, "manage-staff") }, {
    headers: { "cache-control": "no-store" },
  });
}

export async function POST(request: Request) {
  const identity = await authenticatedUser();
  const actor = identity ? await resolveActor(identity.uid) : null;
  if (!can(actor, "manage-staff")) return Response.json({ error: "Not permitted" }, { status: 403 });

  const limited = await rateLimit(request, "admin-staff", actor!.uid, 30, 60 * 60 * 1000);
  if (limited) return limited;

  const parsed = appointInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Check the mobile number and role" }, { status: 400 });

  const account = await findByMobile(parsed.data.mobileE164);
  if (!account) {
    return Response.json({
      error: "No single account signs in with that number. They must open the app and finish setting up first.",
    }, { status: 404 });
  }

  const now = new Date().toISOString();
  await userDoc(account.id).update({ role: parsed.data.role, updatedAt: now });
  await recordStaffAction({
    actor: actor!,
    action: "staff-appointed",
    subjectType: "user",
    subjectId: account.id,
    summary: `${account.fullName || "An account"} made ${parsed.data.role === "admin" ? "an administrator" : "staff"}`,
    detail: { role: parsed.data.role },
  });

  return Response.json({ staff: await listStaff() }, { status: 201 });
}

export async function DELETE(request: Request) {
  const identity = await authenticatedUser();
  const actor = identity ? await resolveActor(identity.uid) : null;
  if (!can(actor, "manage-staff")) return Response.json({ error: "Not permitted" }, { status: 403 });

  const parsed = removeInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose who to remove" }, { status: 400 });

  // Removing yourself would leave the console with one fewer administrator
  // than whoever did it intended, and possibly none at all.
  if (parsed.data.uid === actor!.uid) {
    return Response.json({ error: "You cannot remove your own access" }, { status: 400 });
  }

  const now = new Date().toISOString();
  await userDoc(parsed.data.uid).update({ role: "user", updatedAt: now });
  await recordStaffAction({
    actor: actor!,
    action: "staff-removed",
    subjectType: "user",
    subjectId: parsed.data.uid,
    summary: "Console access removed",
  });

  return Response.json({ staff: await listStaff() });
}
