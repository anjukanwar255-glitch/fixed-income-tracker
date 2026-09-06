import { and, desc, eq, isNull } from "drizzle-orm";
import { env } from "cloudflare:workers";
import { headers } from "next/headers";

import { getDb } from "@/db";
import { documents, investments } from "@/db/schema";

export const dynamic = "force-dynamic";

const allowedTypes = new Set(["application/pdf", "image/jpeg", "image/png"]);
const maxBytes = 10 * 1024 * 1024;

export async function GET(request: Request) {
  const ownerId = (await headers()).get("oai-authenticated-user-id");
  if (!ownerId) return Response.json({ error: "Authentication required" }, { status: 401 });
  const investmentId = new URL(request.url).searchParams.get("investmentId");
  if (!investmentId) return Response.json({ error: "Investment is required" }, { status: 400 });

  const db = getDb();
  const [ownedInvestment] = await db.select({ id: investments.id }).from(investments).where(and(
    eq(investments.id, investmentId),
    eq(investments.userId, ownerId),
    isNull(investments.deletedAt),
  )).limit(1);
  if (!ownedInvestment) return Response.json({ error: "Investment not found" }, { status: 404 });

  const rows = await db.select({
    id: documents.id,
    documentName: documents.documentName,
    documentType: documents.documentType,
    financialYear: documents.financialYear,
    mimeType: documents.mimeType,
    sizeBytes: documents.sizeBytes,
    createdAt: documents.createdAt,
  }).from(documents).where(and(
    eq(documents.investmentId, investmentId),
    eq(documents.userId, ownerId),
    isNull(documents.deletedAt),
  )).orderBy(desc(documents.createdAt));

  return Response.json({ documents: rows });
}

export async function POST(request: Request) {
  const ownerId = (await headers()).get("oai-authenticated-user-id");
  if (!ownerId) return Response.json({ error: "Authentication required" }, { status: 401 });

  const form = await request.formData();
  const file = form.get("file");
  const investmentId = String(form.get("investmentId") ?? "");
  const documentType = String(form.get("documentType") ?? "investment-certificate");
  const financialYear = String(form.get("financialYear") ?? "");

  if (!(file instanceof File) || !allowedTypes.has(file.type) || file.size <= 0 || file.size > maxBytes) {
    return Response.json({ error: "Upload a PDF, JPG or PNG up to 10 MB" }, { status: 400 });
  }

  const db = getDb();
  const [ownedInvestment] = await db.select({ id: investments.id }).from(investments).where(and(
    eq(investments.id, investmentId),
    eq(investments.userId, ownerId),
    isNull(investments.deletedAt),
  )).limit(1);
  if (!ownedInvestment) return Response.json({ error: "Investment not found" }, { status: 404 });

  const documentId = crypto.randomUUID();
  const safeExtension = file.type === "application/pdf" ? "pdf" : file.type === "image/png" ? "png" : "jpg";
  const objectKey = `${ownerId}/${investmentId}/${documentId}.${safeExtension}`;
  const createdAt = new Date().toISOString();

  await env.BUCKET.put(objectKey, await file.arrayBuffer(), {
    httpMetadata: { contentType: file.type },
    customMetadata: { ownerId, investmentId, documentId },
  });

  try {
    await db.insert(documents).values({
      id: documentId,
      userId: ownerId,
      investmentId,
      documentName: file.name.slice(0, 180),
      documentType: documentType.slice(0, 80),
      financialYear: financialYear || null,
      objectKey,
      mimeType: file.type,
      sizeBytes: file.size,
      createdAt,
      updatedAt: createdAt,
    });
  } catch {
    await env.BUCKET.delete(objectKey);
    return Response.json({ error: "Document metadata could not be saved" }, { status: 503 });
  }

  return Response.json({ documentId, name: file.name }, { status: 201 });
}
