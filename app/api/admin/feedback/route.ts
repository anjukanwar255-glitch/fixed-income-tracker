import { getDb } from "@/db";
import { isAdministrator } from "@/lib/admin-settings";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

/**
 * Every message sent through "Write to us", for whoever answers them.
 *
 * Read where it was written, with a collection-group query, rather than copied
 * to somewhere an administrator can see. A copy is a second thing to keep in
 * step and a second thing to delete when an account is deleted — and this one
 * would hold what people wrote about their own money.
 */
const PAGE_SIZE = 50;

export async function GET(request: Request) {
  const identity = await authenticatedUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!await isAdministrator(identity.uid)) return Response.json({ error: "Not permitted" }, { status: 403 });

  const limit = Math.min(Number(new URL(request.url).searchParams.get("limit") ?? PAGE_SIZE) || PAGE_SIZE, 200);

  try {
    const rows = await getDb()
      .collectionGroup("feedback")
      .where("deletedAt", "==", null)
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    return Response.json({
      messages: rows.docs.map((row) => {
        const data = row.data() as Record<string, unknown>;
        return {
          id: String(data.id ?? row.id),
          // The tree it was written in names its author; there is no other
          // link back, and none is added here.
          userId: row.ref.parent.parent?.id ?? null,
          category: String(data.category ?? "other"),
          subject: String(data.subject ?? ""),
          message: String(data.message ?? ""),
          status: String(data.status ?? "received"),
          appContext: data.appContext ? String(data.appContext) : null,
          attachmentCount: Array.isArray(data.attachments) ? data.attachments.length : 0,
          createdAt: String(data.createdAt ?? ""),
        };
      }),
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Messages are temporarily unavailable" }, { status: 503 });
  }
}
