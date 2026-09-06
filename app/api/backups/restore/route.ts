import { eq } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { activityLogs, documents, formRecords, investments, notifications, payoutSchedules, payoutTransactions, tdsRecords, users } from "@/db/schema";
import { readLatestUserBackup } from "@/lib/backups";
import { authenticatedRequest, hasRecentAuthentication } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const inputSchema = z.object({ confirm: z.literal("RESTORE") });

/**
 * Non-destructive, idempotent recovery: only missing rows are restored. If the
 * current portfolio contains an ID that is not in the snapshot, recovery stops
 * so a stale backup can never overwrite newer work.
 */
export async function POST(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasRecentAuthentication(identity)) return Response.json({ error: "Please sign in again before restoring data" }, { status: 403 });
  const limited = await rateLimit(request, "backup-restore", identity.uid, 3, 24 * 60 * 60 * 1000);
  if (limited) return limited;
  if (!inputSchema.safeParse(await request.json().catch(() => null)).success) {
    return Response.json({ error: "Recovery confirmation is invalid" }, { status: 400 });
  }

  try {
    const backup = await readLatestUserBackup(identity);
    const data = backup.data;
    if (!data.profile) return Response.json({ error: "The backup has no account profile" }, { status: 422 });
    const db = getDb();
    const existing = await db.select({ id: investments.id }).from(investments).where(eq(investments.userId, identity.uid));
    const backupInvestmentIds = new Set(data.investments.map((item) => item.id));
    if (existing.some((item) => !backupInvestmentIds.has(item.id))) {
      return Response.json({ error: "Recovery stopped because this account contains newer portfolio records. Export the current data before contacting support." }, { status: 409 });
    }

    const now = new Date().toISOString();
    await db.insert(users).values({
      ...data.profile,
      id: identity.uid,
      authSubject: identity.uid,
      mobileE164: identity.phoneNumber ?? data.profile.mobileE164,
      email: identity.email ?? data.profile.email,
      deletedAt: null,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: users.id,
      set: { fullName: data.profile.fullName, panMasked: data.profile.panMasked, dateOfBirth: data.profile.dateOfBirth, deletedAt: null, updatedAt: now },
    });

    const operations: unknown[] = [];
    for (const rows of chunks(data.investments.map((item) => ({ ...item, userId: identity.uid })), 2)) operations.push(db.insert(investments).values(rows).onConflictDoNothing());
    for (const rows of chunks(data.payoutSchedules.map((item) => ({ ...item, userId: identity.uid })), 6)) operations.push(db.insert(payoutSchedules).values(rows).onConflictDoNothing());
    for (const rows of chunks(data.payoutTransactions.map((item) => ({ ...item, userId: identity.uid })), 5)) operations.push(db.insert(payoutTransactions).values(rows).onConflictDoNothing());
    for (const rows of chunks(data.tdsRecords.map((item) => ({ ...item, userId: identity.uid })), 4)) operations.push(db.insert(tdsRecords).values(rows).onConflictDoNothing());
    for (const rows of chunks(data.forms.map((item) => ({ ...item, userId: identity.uid })), 5)) operations.push(db.insert(formRecords).values(rows).onConflictDoNothing());
    for (const rows of chunks(data.documents.map((item) => ({ ...item, userId: identity.uid })), 4)) operations.push(db.insert(documents).values(rows).onConflictDoNothing());
    for (const rows of chunks(data.notifications.map((item) => ({ ...item, userId: identity.uid })), 7)) operations.push(db.insert(notifications).values(rows).onConflictDoNothing());
    for (const rows of chunks(data.activityLogs.map((item) => ({ ...item, userId: identity.uid })), 7)) operations.push(db.insert(activityLogs).values(rows).onConflictDoNothing());

    for (const group of chunks(operations, 40)) {
      await db.batch(group as unknown as Parameters<typeof db.batch>[0]);
    }
    await db.insert(activityLogs).values({
      id: crypto.randomUUID(),
      userId: identity.uid,
      action: "backup-restored",
      entityType: "user",
      entityId: identity.uid,
      summary: `Encrypted Firebase snapshot from ${backup.createdAt} restored`,
      createdAt: now,
    });
    return Response.json({ restored: true, snapshotCreatedAt: backup.createdAt, investmentCount: data.investments.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Recovery failed" }, { status: 503 });
  }
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}
