import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import {
  activityLogs, backupRuns, documents, formRecords, investments, notifications, payoutSchedules,
  payoutTransactions, subscriptions, tdsRecords, users,
} from "@/db/schema";
import { razorpayRequest } from "@/lib/billing";
import { authenticatedRequest, hasRecentAuthentication } from "@/lib/firebase-auth";
import { deleteFirebaseObject } from "@/lib/firebase-storage";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasRecentAuthentication(identity)) return Response.json({ error: "Please sign out and sign in again before deleting your account" }, { status: 403 });
  const db = getDb();
  const [documentRows, subscriptionRows, backupRows] = await Promise.all([
    db.select({ objectKey: documents.objectKey }).from(documents).where(eq(documents.userId, identity.uid)),
    db.select({ providerSubscriptionId: subscriptions.providerSubscriptionId, status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.userId, identity.uid)),
    db.select({ objectKey: backupRuns.objectKey }).from(backupRuns).where(eq(backupRuns.userId, identity.uid)),
  ]);

  for (const subscription of subscriptionRows) {
    if (subscription.providerSubscriptionId && !["cancelled", "completed", "expired"].includes(subscription.status)) {
      try {
        await razorpayRequest(`/subscriptions/${subscription.providerSubscriptionId}/cancel`, { method: "POST", body: JSON.stringify({ cancel_at_cycle_end: 0 }) });
      } catch {
        return Response.json({ error: "The active subscription could not be cancelled. No account data was deleted; please try again." }, { status: 503 });
      }
    }
  }
  try {
    for (const document of documentRows) await deleteFirebaseObject(identity.token, document.objectKey, identity.appCheckToken);
  } catch {
    return Response.json({ error: "Private documents could not be removed from Firebase. No database records were deleted; please try again." }, { status: 503 });
  }
  const backupKeys = new Set([`users/${identity.uid}/backups/latest.enc`, ...backupRows.map((item) => item.objectKey)]);
  try {
    for (const objectKey of backupKeys) await deleteFirebaseObject(identity.token, objectKey, identity.appCheckToken);
  } catch {
    return Response.json({ error: "Recovery snapshots could not be removed from Firebase. No database records were deleted; please try again." }, { status: 503 });
  }

  const operations = [
    db.delete(tdsRecords).where(eq(tdsRecords.userId, identity.uid)),
    db.delete(payoutTransactions).where(eq(payoutTransactions.userId, identity.uid)),
    db.delete(payoutSchedules).where(eq(payoutSchedules.userId, identity.uid)),
    db.delete(formRecords).where(eq(formRecords.userId, identity.uid)),
    db.delete(documents).where(eq(documents.userId, identity.uid)),
    db.delete(notifications).where(eq(notifications.userId, identity.uid)),
    db.delete(activityLogs).where(eq(activityLogs.userId, identity.uid)),
    db.delete(backupRuns).where(eq(backupRuns.userId, identity.uid)),
    db.delete(subscriptions).where(eq(subscriptions.userId, identity.uid)),
    db.delete(investments).where(eq(investments.userId, identity.uid)),
    db.delete(users).where(eq(users.id, identity.uid)),
  ];
  await db.batch(operations as unknown as Parameters<typeof db.batch>[0]);
  return Response.json({ deleted: true });
}
