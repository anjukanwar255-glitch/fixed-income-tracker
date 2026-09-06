import { and, eq, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";

import { getDb } from "@/db";
import { documents } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const ownerId = (await headers()).get("oai-authenticated-user-id");
  if (!ownerId) return Response.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  const db = getDb();
  const [document] = await db.select().from(documents).where(and(
    eq(documents.id, id),
    eq(documents.userId, ownerId),
    isNull(documents.deletedAt),
  )).limit(1);
  if (!document) return Response.json({ error: "Document not found" }, { status: 404 });

  const object = await env.BUCKET.get(document.objectKey);
  if (!object) return Response.json({ error: "Document file is unavailable" }, { status: 404 });
  const safeName = document.documentName.replace(/["\r\n]/g, "_");
  return new Response(object.body, {
    headers: {
      "content-type": document.mimeType,
      "content-disposition": `attachment; filename="${safeName}"`,
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
    },
  });
}
