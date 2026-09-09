import { requireEntitlement } from "@/lib/billing";
import { isDocumentScanConfigured, scanInvestmentDocument } from "@/lib/document-scan";
import { MAX_DOCUMENT_BYTES, validateDocumentFile } from "@/lib/file-validation";
import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Reads a certificate or statement and returns the add-investment form's
 * fields. Nothing is stored: the response pre-fills the form, and the investor
 * confirms every value against the document before saving.
 *
 * Rate limited more tightly than the upload endpoints, because each call bills
 * a model read rather than just storage.
 */
export async function POST(request: Request) {
  const identity = await authenticatedUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(identity.uid);
  if (paywall) return paywall;

  if (!isDocumentScanConfigured()) {
    return Response.json({ error: "Document scanning is not enabled" }, { status: 503 });
  }

  const limited = await rateLimit(request, "document-scan", identity.uid, 15, 60 * 60 * 1000);
  if (limited) return limited;

  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES) {
    return Response.json({ error: "Upload a PDF, JPG, JPEG or PNG up to 10 MB" }, { status: 413 });
  }

  const bytes = await request.arrayBuffer();
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim() ?? "";

  // The same content-signature check uploads use: the declared type is not
  // trusted, and an active PDF is rejected before anything reads it.
  let validated: Awaited<ReturnType<typeof validateDocumentFile>>;
  try {
    validated = await validateDocumentFile({
      name: "scan",
      size: bytes.byteLength,
      type: contentType,
      arrayBuffer: async () => bytes,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "The file is not valid" }, { status: 400 });
  }

  try {
    const fields = await scanInvestmentDocument(validated.bytes, validated.mimeType);
    return Response.json({ fields }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "The document could not be read. Enter the details manually." }, { status: 503 });
  }
}
