import type { CollectionReference } from "firebase-admin/firestore";
import { z } from "zod";

import {
  activityLogs,
  commitAll,
  documents,
  forms,
  investments,
  notifications,
  payoutSchedules,
  payoutTransactions,
  readDoc,
  setOp,
  tdsRecords,
  userDoc,
} from "@/db";
import { readLatestUserBackup } from "@/lib/backups";
import { authenticatedRequest, hasRecentAuthentication } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const inputSchema = z.object({ confirm: z.literal("RESTORE") });

/**
 * Non-destructive, idempotent recovery: only missing rows are restored. If the
 * current portfolio contains an ID that is not in the snapshot, recovery stops
 * so a stale backup can never overwrite newer work.
 */
export async function POST(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasRecentAuthentication(identity)) return Response.json({ error: "Please sign in again before restoring data" }, { status: 403 });
  const limited = await rateLimit(request, "backup-restore", identity.uid, 3, 24 * 60 * 60 * 1000);
  if (limited) return limited;
  if (!inputSchema.safeParse(await request.json().catch(() => null)).success) {
    return Response.json({ error: "Recovery confirmation is invalid" }, { status: 400 });
  }

  try {
    const backup = await readLatestUserBackup(identity);
    const data = backup.data;
    if (!data.profile) return Response.json({ error: "The backup has no account profile" }, { status: 422 });
    const existingIds = await documentIds(investments(identity.uid));
    const backupInvestmentIds = new Set(data.investments.map((item) => item.id));
    if ([...existingIds].some((id) => !backupInvestmentIds.has(id))) {
      return Response.json({ error: "Recovery stopped because this account contains newer portfolio records. Export the current data before contacting support." }, { status: 409 });
    }

    const now = new Date().toISOString();
    const storedProfile = await readDoc(userDoc(identity.uid));
    if (storedProfile) {
      await userDoc(identity.uid).update({
        fullName: data.profile.fullName,
        panMasked: data.profile.panMasked ?? null,
        dateOfBirth: data.profile.dateOfBirth ?? null,
        deletedAt: null,
        updatedAt: now,
      });
    } else {
      await userDoc(identity.uid).set({
        ...data.profile,
        id: identity.uid,
        mobileE164: identity.phoneNumber ?? data.profile.mobileE164,
        email: identity.email ?? data.profile.email,
        deletedAt: null,
        updatedAt: now,
      });
    }

    // Firestore has no "insert or ignore", and a `create()` inside a batch
    // would fail the whole batch on the first row that already exists. The
    // rows already present are read first so only genuinely missing ones are
    // written, which keeps recovery non-destructive and idempotent.
    await restoreMissing(investments(identity.uid), data.investments);
    await restoreMissing(payoutSchedules(identity.uid), data.payoutSchedules);
    await restoreMissing(payoutTransactions(identity.uid), data.payoutTransactions);
    await restoreMissing(tdsRecords(identity.uid), data.tdsRecords);
    await restoreMissing(forms(identity.uid), data.forms);
    await restoreMissing(documents(identity.uid), data.documents);
    await restoreMissing(notifications(identity.uid), data.notifications);
    await restoreMissing(activityLogs(identity.uid), data.activityLogs);

    const logId = crypto.randomUUID();
    await activityLogs(identity.uid).doc(logId).set({
      id: logId,
      actorType: "user",
      action: "backup-restored",
      entityType: "user",
      entityId: identity.uid,
      summary: `Encrypted Firebase snapshot from ${backup.createdAt} restored`,
      createdAt: now,
    });
    return Response.json({ restored: true, snapshotCreatedAt: backup.createdAt, investmentCount: data.investments.length });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Recovery failed" }, { status: 503 });
  }
}

/** Ids only: the documents themselves are not needed to decide what is missing. */
async function documentIds(collection: CollectionReference<{ id: string }>) {
  const snapshot = await collection.select().get();
  return new Set(snapshot.docs.map((document) => document.id));
}

async function restoreMissing<T extends { id: string }>(collection: CollectionReference<T>, rows: T[]) {
  if (!rows.length) return;
  const present = await documentIds(collection as CollectionReference<{ id: string }>);
  const missing = rows.filter((row) => !present.has(row.id));
  if (missing.length) {
    await commitAll(missing.map((row) => setOp(collection.doc(row.id), row)));
  }
}
