import { documents, readDoc } from "@/db";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { downloadFirebaseObject } from "@/lib/firebase-storage";
import { requireEntitlement } from "@/lib/billing";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const ownerId = identity.uid;
  const paywall = await requireEntitlement(ownerId);
  if (paywall) return paywall;

  const { id } = await params;
  const document = await readDoc(documents(ownerId).doc(id));
  if (!document || document.deletedAt) return Response.json({ error: "Document not found" }, { status: 404 });

  const object = await downloadFirebaseObject(identity.token, document.objectKey, identity.appCheckToken);
  if (!object.ok || !object.body) {
    return Response.json({ error: "Document file is unavailable" }, { status: object.status === 404 ? 404 : 503 });
  }
  const safeName = document.documentName.replace(/["\r\n]/g, "_");
  const encodedName = encodeURIComponent(safeName);
  return new Response(object.body, {
    headers: {
      "content-type": document.mimeType,
      "content-disposition": `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      "content-length": String(document.sizeBytes),
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
