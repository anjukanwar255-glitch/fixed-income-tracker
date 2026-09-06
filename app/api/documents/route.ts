import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { authenticatedRequest, authenticatedUser } from "@/lib/firebase-auth";
import { deleteFirebaseObject, uploadFirebaseObject } from "@/lib/firebase-storage";
import { MAX_DOCUMENT_BYTES, validateDocumentFile } from "@/lib/file-validation";
import { documents, investments } from "@/db/schema";
import { requireEntitlement } from "@/lib/billing";
import { createUserBackup } from "@/lib/backups";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const documentFields = z.object({
  investmentId: z.string().uuid(),
  documentType: z.enum(["investment-certificate", "investment-document", "bond-certificate", "bond-document", "interest-certificate", "tds-certificate", "form-15g", "form-15h", "statement", "other"]),
  financialYear: z.string().regex(/^FY \d{4}-\d{2}$/).optional().or(z.literal("")),
});

export async function GET(request: Request) {
  const ownerId = (await authenticatedUser())?.uid;
  if (!ownerId) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(ownerId);
  if (paywall) return paywall;
  const limited = await rateLimit(request, "document-upload", ownerId, 20, 10 * 60 * 1000);
  if (limited) return limited;
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
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const ownerId = identity.uid;
  const paywall = await requireEntitlement(ownerId);
  if (paywall) return paywall;

  const url = new URL(request.url);
  const fields = documentFields.safeParse({
    investmentId: url.searchParams.get("investmentId") ?? "",
    documentType: url.searchParams.get("documentType") ?? "investment-certificate",
    financialYear: url.searchParams.get("financialYear") ?? "",
  });
  if (!fields.success) return Response.json({ error: "Please check the document details" }, { status: 400 });
  const { investmentId, documentType, financialYear } = fields.data;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) {
    return Response.json({ error: "Upload a PDF, JPG, JPEG or PNG up to 10 MB" }, { status: 413 });
  }

  let documentName = "document";
  try {
    documentName = decodeURIComponent(request.headers.get("x-document-name") ?? "document");
  } catch {
    return Response.json({ error: "The document name is invalid" }, { status: 400 });
  }
  const bytes = await request.arrayBuffer();
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";

  let validated: Awaited<ReturnType<typeof validateDocumentFile>>;
  try {
    validated = await validateDocumentFile({
      name: documentName,
      size: bytes.byteLength,
      type: contentType,
      arrayBuffer: async () => bytes,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The document is not valid" }, { status: 400 });
  }

  const db = getDb();
  const [ownedInvestment] = await db.select({ id: investments.id }).from(investments).where(and(
    eq(investments.id, investmentId),
    eq(investments.userId, ownerId),
    isNull(investments.deletedAt),
  )).limit(1);
  if (!ownedInvestment) return Response.json({ error: "Investment not found" }, { status: 404 });

  const documentId = crypto.randomUUID();
  const objectKey = `users/${ownerId}/documents/${investmentId}/${documentId}.${validated.extension}`;
  const createdAt = new Date().toISOString();

  try {
    await uploadFirebaseObject(identity.token, objectKey, validated.bytes, validated.mimeType, identity.appCheckToken);
  } catch {
    return Response.json({ error: "Firebase Storage is unavailable or not configured" }, { status: 503 });
  }

  try {
    await db.insert(documents).values({
      id: documentId,
      userId: ownerId,
      investmentId,
      documentName: documentName.slice(0, 180),
      documentType: documentType.slice(0, 80),
      financialYear: financialYear || null,
      objectKey,
      mimeType: validated.mimeType,
      sizeBytes: bytes.byteLength,
      storageProvider: "firebase",
      sha256: validated.sha256,
      validationStatus: "validated",
      validatedAt: createdAt,
      createdAt,
      updatedAt: createdAt,
    });
  } catch {
    await deleteFirebaseObject(identity.token, objectKey, identity.appCheckToken).catch(() => undefined);
    return Response.json({ error: "Document metadata could not be saved" }, { status: 503 });
  }

  const backupWarning = await createUserBackup(identity)
    .then(() => null)
    .catch(() => "Document saved, but the recovery snapshot could not be refreshed");
  return Response.json({ documentId, name: documentName, sha256: validated.sha256, validationStatus: "validated", backupWarning }, { status: 201 });
}
