import { z } from "zod";

import { feedback } from "@/db";
import { authenticatedRequest } from "@/lib/firebase-auth";
import { uploadFirebaseObject } from "@/lib/firebase-storage";
import { MAX_DOCUMENT_BYTES, validateDocumentBytes } from "@/lib/file-validation";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Takes a report or a suggestion, with the evidence behind it.
 *
 * Not gated behind a subscription: someone whose payment or trial has gone
 * wrong is exactly who most needs to reach us, and a paywall in front of the
 * complaint box would silence them.
 */
const MAX_ATTACHMENTS = 3;

const feedbackFields = z.object({
  category: z.enum(["issue", "improvement", "question", "other"]),
  subject: z.string().trim().min(3).max(120),
  message: z.string().trim().min(10).max(4000),
  appContext: z.string().trim().max(200).optional(),
});

export async function POST(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const limited = await rateLimit(request, "feedback", identity.uid, 10, 60 * 60 * 1000);
  if (limited) return limited;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return Response.json({ error: "The message could not be read" }, { status: 400 });
  }

  const parsed = feedbackFields.safeParse({
    category: form.get("category") ?? undefined,
    subject: form.get("subject") ?? undefined,
    message: form.get("message") ?? undefined,
    appContext: form.get("appContext") ?? undefined,
  });
  if (!parsed.success) {
    return Response.json({ error: "Add a subject and describe what happened in a little detail" }, { status: 400 });
  }

  const files = form.getAll("attachment").filter((entry): entry is File => entry instanceof File && entry.size > 0);
  if (files.length > MAX_ATTACHMENTS) {
    return Response.json({ error: `Attach up to ${MAX_ATTACHMENTS} files` }, { status: 413 });
  }
  if (files.some((file) => file.size > MAX_DOCUMENT_BYTES)) {
    return Response.json({ error: "Each file must be 10 MB or smaller" }, { status: 413 });
  }

  const feedbackId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const attachments: { objectKey: string; fileName: string; mimeType: string; sizeBytes: number }[] = [];

  for (const file of files) {
    let validated;
    try {
      // The same content check the rest of the app uses: a file is what its
      // bytes say it is, not what its name or its declared type claims.
      validated = await validateDocumentBytes(await file.arrayBuffer(), file.type);
    } catch (error) {
      return Response.json({ error: error instanceof Error ? error.message : "That file is not valid" }, { status: 400 });
    }
    const objectKey = `users/${identity.uid}/feedback/${feedbackId}/${crypto.randomUUID()}.${validated.extension}`;
    try {
      await uploadFirebaseObject(identity.token, objectKey, validated.bytes, validated.mimeType, identity.appCheckToken);
    } catch {
      return Response.json({ error: "The attachment could not be uploaded. Try again, or send the message without it." }, { status: 503 });
    }
    attachments.push({
      objectKey,
      fileName: (file.name || "attachment").slice(0, 180),
      mimeType: validated.mimeType,
      sizeBytes: file.size,
    });
  }

  try {
    await feedback(identity.uid).doc(feedbackId).set({
      id: feedbackId,
      category: parsed.data.category,
      subject: parsed.data.subject,
      message: parsed.data.message,
      appContext: parsed.data.appContext || null,
      status: "received",
      attachments,
      createdAt,
      updatedAt: createdAt,
      deletedAt: null,
    });
  } catch {
    return Response.json({ error: "The message could not be saved. Please try again." }, { status: 503 });
  }

  return Response.json({ feedbackId, attachmentCount: attachments.length }, { status: 201 });
}

export async function GET() {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  try {
    const rows = await feedback(identity.uid).where("deletedAt", "==", null).orderBy("createdAt", "desc").limit(20).get();
    return Response.json({
      messages: rows.docs.map((row) => {
        const data = row.data();
        return {
          id: data.id,
          category: data.category,
          subject: data.subject,
          status: data.status,
          attachmentCount: data.attachments?.length ?? 0,
          createdAt: data.createdAt,
        };
      }),
    });
  } catch {
    return Response.json({ error: "Your messages are temporarily unavailable" }, { status: 503 });
  }
}
