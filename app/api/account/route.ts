import { backupRuns, deleteUserTree, documents, listDocs, subscriptions } from "@/db";
import { razorpayRequest } from "@/lib/billing";
import { authenticatedRequest, hasRecentAuthentication } from "@/lib/firebase-auth";
import { deleteFirebaseObject } from "@/lib/firebase-storage";

export const dynamic = "force-dynamic";

export async function DELETE() {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasRecentAuthentication(identity)) return Response.json({ error: "Please sign out and sign in again before deleting your account" }, { status: 403 });
  const [documentRows, subscriptionRows, backupRows] = await Promise.all([
    listDocs(documents(identity.uid)),
    listDocs(subscriptions(identity.uid)),
    listDocs(backupRuns(identity.uid)),
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

  // Removes the user document and every subcollection under it, which is the
  // eleven table deletes this replaced. `trialClaims` is deliberately outside
  // the user subtree and survives, so a deleted account cannot claim a second
  // free trial.
  await deleteUserTree(identity.uid);
  return Response.json({ deleted: true });
}
