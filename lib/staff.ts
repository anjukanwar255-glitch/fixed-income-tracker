import { getDb, readDoc, staffActions, userDoc, users } from "@/db";
import { env } from "@/lib/env";

/**
 * Who may do what.
 *
 * Three levels, and the line between the last two is the point of this file.
 * Staff do the day-to-day work — looking at accounts, chasing people who have
 * gone quiet. What staff may not do is change what the business charges or
 * take the public site down, because those reach every customer at once and
 * cannot be undone by the person who did them.
 */
export type Capability =
  | "view-users"        // see accounts, activity, who has gone quiet
  | "contact-users"     // record an attempt to reach someone
  | "manage-pricing"    // what the app charges
  | "manage-service"    // the maintenance notice
  | "manage-staff"      // who else may sign in here
  | "approve-handover"; // release an account's records to its nominees

const STAFF_CAPABILITIES: Capability[] = ["view-users", "contact-users"];
const ADMIN_CAPABILITIES: Capability[] = [
  ...STAFF_CAPABILITIES,
  "manage-pricing",
  "manage-service",
  "manage-staff",
  "approve-handover",
];

export type Actor = { uid: string; role: "admin" | "support"; capabilities: Capability[] };

/**
 * What this account may do, or null if it may do nothing here.
 *
 * The configured list is what bootstraps: the first administrator cannot be
 * appointed by an administrator, and it lives outside the database, so read
 * access to Firestore is not by itself a way to become one.
 */
export async function resolveActor(uid: string): Promise<Actor | null> {
  if (configuredAdministrators().includes(uid)) {
    return { uid, role: "admin", capabilities: ADMIN_CAPABILITIES };
  }
  try {
    const stored = await readDoc(userDoc(uid));
    if (!stored || stored.deletedAt) return null;
    if (stored.role === "admin") return { uid, role: "admin", capabilities: ADMIN_CAPABILITIES };
    if (stored.role === "support") return { uid, role: "support", capabilities: STAFF_CAPABILITIES };
    return null;
  } catch {
    // An unreadable role is not a role.
    return null;
  }
}

export function can(actor: Actor | null, capability: Capability) {
  return Boolean(actor?.capabilities.includes(capability));
}

function configuredAdministrators() {
  return (env.ADMIN_UIDS ?? "").split(",").map((uid) => uid.trim()).filter(Boolean);
}

/**
 * Everyone who may sign in to the console.
 *
 * Read from the accounts themselves rather than kept as a second list: a staff
 * member is an account with a role, so there is no way for the two to disagree
 * about who works here.
 */
export async function listStaff() {
  const rows = await users().where("role", "in", ["admin", "support"]).get();
  return rows.docs
    .map((row) => row.data())
    .filter((row) => !row.deletedAt)
    .map((row) => ({
      uid: row.id,
      name: row.fullName,
      role: row.role as "admin" | "support",
      mobileE164: row.mobileE164 ?? null,
      displayId: row.displayId ?? null,
    }));
}

/** Finds the account to appoint, by the number they sign in with. */
export async function findByMobile(mobileE164: string) {
  const rows = await users().where("mobileE164", "==", mobileE164).limit(2).get();
  const found = rows.docs.map((row) => row.data()).filter((row) => !row.deletedAt);
  return found.length === 1 ? found[0] : null;
}

/**
 * Records something a member of staff did, in one place.
 *
 * Kept apart from the per-account trail on purpose. That one answers "what
 * happened to this account"; this one answers "what has this person been
 * doing", and an administrator cannot read the second out of the first without
 * opening every account in turn.
 */
export async function recordStaffAction(input: {
  actor: Actor;
  action: string;
  subjectType: string;
  subjectId: string;
  summary: string;
  detail?: Record<string, unknown>;
}) {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await staffActions().doc(id).set({
    id,
    actorId: input.actor.uid,
    actorRole: input.actor.role,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    summary: input.summary,
    detailJson: input.detail ? JSON.stringify(input.detail) : null,
    createdAt: now,
  });
}

/** The most recent staff actions, newest first. */
export async function recentStaffActions(limit = 100) {
  const rows = await getDb()
    .collection("staffActions")
    .orderBy("createdAt", "desc")
    .limit(Math.min(limit, 300))
    .get();
  return rows.docs.map((row) => row.data());
}
