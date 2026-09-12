import { requireEntitlement } from "@/lib/billing";
import { isDocumentScanConfigured, scanInvestmentDocuments, type ScanSource } from "@/lib/document-scan";
import { MAX_DOCUMENT_BYTES, validateDocumentBytes } from "@/lib/file-validation";
import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";
import { readAdminSettings } from "@/lib/admin-settings";
import { recordScan, scansUsed } from "@/lib/scan-usage";

export const dynamic = "force-dynamic";

/**
 * A bond usually needs two documents to describe it fully: a deal sheet or
 * certificate for the terms, and a repayment schedule for how interest
 * actually behaves. They are read together in one pass so the model can
 * reconcile them, rather than scanned separately and merged afterwards.
 */
const DOCUMENT_ROLES = ["deal", "schedule"] as const;
type DocumentRole = (typeof DOCUMENT_ROLES)[number];

const ROLE_LABELS: Record<DocumentRole, string> = {
  deal: "Deal sheet, contract note, bond agreement or deposit receipt — the terms as issued",
  schedule: "Repayment or interest schedule — the payments as they fall due",
};

const MAX_DOCUMENTS = DOCUMENT_ROLES.length;

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

  // The hour holds back a burst; the month holds back the bill. Both are
  // needed, and they are not the same limit set at different scales.
  const { monthlyScanLimit } = await readAdminSettings();
  const used = await scansUsed(identity.uid);
  if (used >= monthlyScanLimit) {
    return Response.json({
      error: monthlyScanLimit === 0
        ? "Document scanning is switched off."
        : `You have used all ${monthlyScanLimit} scans for this month. Enter the details by hand, or come back next month.`,
      code: "SCAN_LIMIT_REACHED",
      used,
      limit: monthlyScanLimit,
    }, { status: 429 });
  }

  const limited = await rateLimit(request, "document-scan", identity.uid, 15, 60 * 60 * 1000);
  if (limited) return limited;

  // Every document counts against the same ceiling, so several large files
  // cannot together exceed what one was allowed to be.
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_DOCUMENT_BYTES * MAX_DOCUMENTS) {
    return Response.json({ error: `Upload up to ${MAX_DOCUMENTS} files, each a PDF, JPG, JPEG or PNG up to 10 MB` }, { status: 413 });
  }

  // Each document arrives under the field name describing what it is, so the
  // reader is told which paper is which instead of inferring it. A statement
  // and a deal sheet overlap heavily but disagree in places, and knowing which
  // is which is what decides who wins.
  let attached: { role: DocumentRole; file: File }[];
  let lookAgainFor: string[] = [];
  try {
    const form = await request.formData();
    attached = DOCUMENT_ROLES.flatMap((role) => {
      const entry = form.get(role);
      return entry instanceof File ? [{ role, file: entry }] : [];
    });
    lookAgainFor = (form.get("lookAgainFor") ?? "")
      .toString()
      .split(",")
      .map((field: string) => field.trim())
      .filter((field: string) => /^[a-zA-Z ]{2,40}$/.test(field))
      .slice(0, 12);
  } catch {
    return Response.json({ error: "The upload could not be read" }, { status: 400 });
  }

  if (!attached.length) return Response.json({ error: "Attach at least one document" }, { status: 400 });

  // The same content-signature and structural checks uploads use: the declared
  // type is not trusted, and an active PDF is rejected before anything reads
  // it. These are never stored, so there is no filename to agree with.
  const sources: ScanSource[] = [];
  for (const { role, file } of attached) {
    try {
      const validated = await validateDocumentBytes(await file.arrayBuffer(), file.type);
      sources.push({ bytes: validated.bytes, mimeType: validated.mimeType, label: ROLE_LABELS[role] });
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "The file is not valid" }, { status: 400 });
    }
  }

  /*
   * A second pass names what the first one missed. The reader is asked at
   * temperature 0, so repeating the same question returns the same answer
   * word for word — only a different question can produce a different one.
   */
  try {
    const fields = await scanInvestmentDocuments(sources, lookAgainFor);
    // Only a reading that produced something counts against the month.
    await recordScan(identity.uid).catch(() => undefined);
    return Response.json({
      fields,
      used: used + 1,
      limit: monthlyScanLimit,
    }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "The documents could not be read. Enter the details manually." }, { status: 503 });
  }
}
