import { requireEntitlement } from "@/lib/billing";
import { isDocumentScanConfigured, scanInvestmentDocuments, type ScanSource } from "@/lib/document-scan";
import { MAX_DOCUMENT_BYTES, validateDocumentBytes } from "@/lib/file-validation";
import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * A bond usually needs two documents to describe it fully: a deal sheet or
 * certificate for the terms, and a repayment schedule for how interest
 * actually behaves. They are read together in one pass so the model can
 * reconcile them, rather than scanned separately and merged afterwards.
 */
const MAX_DOCUMENTS = 3;

/**
 * Reads certificates and statements and returns the add-investment form's
 * fields. Nothing is stored: the response pre-fills the form, and the investor
 * confirms every value against the documents before saving.
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

  // Every document counts against the same ceiling, so several large files
  // cannot together exceed what one was allowed to be.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES * MAX_DOCUMENTS) {
    return Response.json({ error: `Upload up to ${MAX_DOCUMENTS} files, each a PDF, JPG, JPEG or PNG up to 10 MB` }, { status: 413 });
  }

  let files: File[];
  try {
    const form = await request.formData();
    files = form.getAll("documents").filter((entry): entry is File => entry instanceof File);
  } catch {
    return Response.json({ error: "The upload could not be read" }, { status: 400 });
  }

  if (!files.length) return Response.json({ error: "Attach at least one document" }, { status: 400 });
  if (files.length > MAX_DOCUMENTS) {
    return Response.json({ error: `Attach at most ${MAX_DOCUMENTS} documents` }, { status: 400 });
  }

  // The same content-signature and structural checks uploads use: the declared
  // type is not trusted, and an active PDF is rejected before anything reads
  // it. These are never stored, so there is no filename to agree with.
  const sources: ScanSource[] = [];
  for (const file of files) {
    try {
      const validated = await validateDocumentBytes(await file.arrayBuffer(), file.type);
      sources.push({ bytes: validated.bytes, mimeType: validated.mimeType });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The file is not valid" }, { status: 400 });
    }
  }

  try {
    const fields = await scanInvestmentDocuments(sources);
    return Response.json({ fields }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "The documents could not be read. Enter the details manually." }, { status: 503 });
  }
}
