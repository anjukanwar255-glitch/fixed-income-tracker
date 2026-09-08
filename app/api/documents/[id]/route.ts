import { activityLogs, commitAll, documents, readDoc, setOp, updateOp } from "@/db";
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
  const document = await readDoc(documents(identity.uid).doc(id));
  if (!document || document.deletedAt) return Response.json({ error: "Document not found" }, { status: 404 });

  await deleteFirebaseObject(identity.token, document.objectKey, identity.appCheckToken);
  const deletedAt = new Date().toISOString();
  const logId = crypto.randomUUID();
  await commitAll([
    updateOp(documents(identity.uid).doc(id), { deletedAt, updatedAt: deletedAt }),
    setOp(activityLogs(identity.uid).doc(logId), {
      id: logId,
      investmentId: document.investmentId,
      actorType: "user",
      action: "deleted",
      entityType: "document",
      entityId: document.id,
      summary: "Document permanently deleted",
      previousSnapshot: JSON.stringify({ name: document.documentName, sha256: document.sha256 }),
      createdAt: deletedAt,
    }),
  ]);
  const backupWarning = await createUserBackup(identity)
    .then(() => null)
    .catch(() => "Document deleted, but the recovery snapshot could not be refreshed");
  return Response.json({ deleted: true, backupWarning });
}
