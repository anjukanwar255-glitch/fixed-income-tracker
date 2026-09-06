import { and, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { activityLogs, documents } from "@/db/schema";
import { authenticatedRequest, hasRecentAuthentication } from "@/lib/firebase-auth";
import { deleteFirebaseObject } from "@/lib/firebase-storage";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";

export const dynamic = "force-dynamic";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(identity.uid);
  if (paywall) return paywall;
  if (!hasRecentAuthentication(identity)) {
    return Response.json({ error: "Please sign in again before deleting a document" }, { status: 403 });
  }

  const { id } = await params;
  const db = getDb();
  const [document] = await db.select().from(documents).where(and(
    eq(documents.id, id),
    eq(documents.userId, identity.uid),
    isNull(documents.deletedAt),
  )).limit(1);
  if (!document) return Response.json({ error: "Document not found" }, { status: 404 });

  await deleteFirebaseObject(identity.token, document.objectKey, identity.appCheckToken);
  const deletedAt = new Date().toISOString();
  const update = db.update(documents).set({ deletedAt, updatedAt: deletedAt }).where(eq(documents.id, id));
  const log = db.insert(activityLogs).values({
    id: crypto.randomUUID(),
    userId: identity.uid,
    investmentId: document.investmentId,
    action: "deleted",
    entityType: "document",
    entityId: document.id,
    summary: "Document permanently deleted",
    previousSnapshot: JSON.stringify({ name: document.documentName, sha256: document.sha256 }),
    createdAt: deletedAt,
  });
  await db.batch([update, log]);
  const backupWarning = await createUserBackup(identity)
    .then(() => null)
    .catch(() => "Document deleted, but the recovery snapshot could not be refreshed");
  return Response.json({ deleted: true, backupWarning });
}
