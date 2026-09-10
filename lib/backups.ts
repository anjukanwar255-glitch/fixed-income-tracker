import { env } from "@/lib/env";

import {
  activityLogs,
  backupRuns,
  commitAll,
  deleteOp,
  documents,
  firstDoc,
  closures,
  contributions,
  forms,
  investments,
  listDocs,
  notifications,
  payoutSchedules,
  payoutTransactions,
  readDoc,
  tdsRecords,
  userDoc,
} from "@/db";
import type { AuthenticatedRequest } from "@/lib/firebase-auth";
import { deleteFirebaseObject, downloadFirebaseObject, firebaseObjectExists, uploadFirebaseObject } from "@/lib/firebase-storage";

const BACKUP_FORMAT_VERSION = 1;

type BackupEnvelope = {
  version: 1;
  keyVersion: string;
  algorithm: "AES-GCM-256";
  iv: string;
  ciphertext: string;
};

type PortfolioBackup = {
  version: 1;
  createdAt: string;
  ownerId: string;
  data: Awaited<ReturnType<typeof collectUserData>>;
};

/**
 * Writes the encrypted recovery snapshot.
 *
 * Mutations call this, and building a snapshot reads every document the user
 * owns. On D1 that was a free local scan; on Firestore each of those reads is
 * billed and crosses the network, and the activity log grows without bound, so
 * regenerating per write makes each edit progressively slower and costlier.
 *
 * The format already stores one object per day, so a same-day snapshot is
 * reused instead of rebuilt. `force` is for the explicit backup action, where
 * the user is asking for a fresh snapshot right now.
 */
export async function createUserBackup(identity: AuthenticatedRequest, { force = false }: { force?: boolean } = {}) {
  const secret = env.BACKUP_ENCRYPTION_KEY;
  if (!secret) throw new Error("BACKUP_ENCRYPTION_KEY is not configured");

  const createdAt = new Date().toISOString();
  const day = createdAt.slice(0, 10);
  const latestKey = `users/${identity.uid}/backups/latest.enc`;
  const dailyKey = `users/${identity.uid}/backups/${day}.enc`;

  const sameDay = await firstDoc(backupRuns(identity.uid)
    .where("objectKey", "==", dailyKey)
    .where("status", "==", "completed"));
  if (sameDay && !force) {
    return { createdAt: sameDay.createdAt, objectKey: sameDay.objectKey, sha256: sameDay.sha256, sizeBytes: sameDay.sizeBytes, reused: true };
  }

  const payload: PortfolioBackup = {
    version: BACKUP_FORMAT_VERSION,
    createdAt,
    ownerId: identity.uid,
    data: await collectUserData(identity.uid),
  };
  const encrypted = await encryptBackup(payload, secret, env.BACKUP_KEY_VERSION ?? "v1");
  const digest = await sha256(encrypted);

  await uploadFirebaseObject(identity.token, latestKey, encrypted, "application/octet-stream", identity.appCheckToken);
  await uploadFirebaseObject(identity.token, dailyKey, encrypted, "application/octet-stream", identity.appCheckToken);

  const runId = sameDay?.id ?? crypto.randomUUID();
  await backupRuns(identity.uid).doc(runId).set({
    id: runId,
    objectKey: dailyKey,
    sha256: digest,
    sizeBytes: encrypted.byteLength,
    status: "completed",
    failureReason: null,
    createdAt,
  });
  await pruneOldBackups(identity).catch(() => undefined);
  return { createdAt, objectKey: dailyKey, sha256: digest, sizeBytes: encrypted.byteLength, reused: false };
}

export async function readLatestUserBackup(identity: AuthenticatedRequest): Promise<PortfolioBackup> {
  const secret = env.BACKUP_ENCRYPTION_KEY;
  if (!secret) throw new Error("BACKUP_ENCRYPTION_KEY is not configured");
  const response = await downloadFirebaseObject(identity.token, `users/${identity.uid}/backups/latest.enc`, identity.appCheckToken);
  if (!response.ok) throw new Error(response.status === 404 ? "No recovery backup exists" : "Firebase backup is unavailable");
  const payload = await decryptBackup(await response.arrayBuffer());
  if (payload.ownerId !== identity.uid || payload.version !== BACKUP_FORMAT_VERSION) {
    throw new Error("Backup ownership or version is invalid");
  }
  return payload;
}

export async function latestBackupStatus(ownerId: string) {
  return firstDoc(backupRuns(ownerId).orderBy("createdAt", "desc"));
}

/**
 * Whether this account has a snapshot it could actually restore from.
 *
 * Deliberately probes Firebase Storage rather than the `backupRuns` records.
 * Recovery matters precisely when the Firestore side is missing, and those
 * records live under `users/{uid}` — the subtree that would be gone. The
 * encrypted object in Storage is what survives, so it is the only honest
 * signal that recovery would find anything.
 */
export async function hasRestorableBackup(identity: AuthenticatedRequest) {
  if (!isBackupConfigured()) return false;
  return firebaseObjectExists(identity.token, `users/${identity.uid}/backups/latest.enc`, identity.appCheckToken);
}

export async function collectUserData(ownerId: string) {
  const [stored, investmentRows, schedules, transactions, tds, formRows, documentRows, notificationRows, activities, contributionRows, closureRows] = await Promise.all([
    readDoc(userDoc(ownerId)),
    listDocs(investments(ownerId)),
    listDocs(payoutSchedules(ownerId)),
    listDocs(payoutTransactions(ownerId)),
    listDocs(tdsRecords(ownerId)),
    listDocs(forms(ownerId)),
    listDocs(documents(ownerId)),
    listDocs(notifications(ownerId)),
    listDocs(activityLogs(ownerId)),
    listDocs(contributions(ownerId)),
    listDocs(closures(ownerId)),
  ]);
  return {
    profile: stored && !stored.deletedAt ? stored : null,
    investments: investmentRows,
    payoutSchedules: schedules,
    payoutTransactions: transactions,
    tdsRecords: tds,
    forms: formRows,
    documents: documentRows,
    notifications: notificationRows,
    activityLogs: activities,
    contributions: contributionRows,
    closures: closureRows,
  };
}

export function isBackupConfigured() {
  return Boolean(env.BACKUP_ENCRYPTION_KEY);
}

async function pruneOldBackups(identity: AuthenticatedRequest) {
  const cutoff = new Date(Date.now() - 35 * 86_400_000).toISOString();
  const stale = await listDocs(backupRuns(identity.uid).where("createdAt", "<", cutoff));
  for (const item of stale) await deleteFirebaseObject(identity.token, item.objectKey, identity.appCheckToken);
  if (stale.length) {
    await commitAll(stale.map((item) => deleteOp(backupRuns(identity.uid).doc(item.id))));
  }
}

async function encryptBackup(payload: PortfolioBackup, secret: string, keyVersion: string) {
  const key = await importBackupKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plaintext);
  const envelope: BackupEnvelope = {
    version: BACKUP_FORMAT_VERSION,
    keyVersion,
    algorithm: "AES-GCM-256",
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
  return new TextEncoder().encode(JSON.stringify(envelope)).buffer;
}

async function decryptBackup(bytes: ArrayBuffer): Promise<PortfolioBackup> {
  let envelope: BackupEnvelope;
  try {
    envelope = JSON.parse(new TextDecoder().decode(bytes)) as BackupEnvelope;
  } catch {
    throw new Error("Backup envelope is damaged");
  }
  if (envelope.version !== BACKUP_FORMAT_VERSION || envelope.algorithm !== "AES-GCM-256") {
    throw new Error("Backup format is not supported");
  }
  const currentVersion = env.BACKUP_KEY_VERSION ?? "v1";
  const secret = envelope.keyVersion === currentVersion
    ? env.BACKUP_ENCRYPTION_KEY
    : envelope.keyVersion === env.BACKUP_PREVIOUS_KEY_VERSION
      ? env.BACKUP_PREVIOUS_ENCRYPTION_KEY
      : null;
  if (!secret) throw new Error(`Backup key ${envelope.keyVersion} is not configured`);
  const key = await importBackupKey(secret);
  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64(envelope.iv) },
      key,
      fromBase64(envelope.ciphertext),
    );
    return JSON.parse(new TextDecoder().decode(plaintext)) as PortfolioBackup;
  } catch {
    throw new Error("Backup authentication failed");
  }
}

async function importBackupKey(secret: string) {
  const bytes = fromBase64(secret);
  if (bytes.byteLength !== 32) throw new Error("BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function sha256(bytes: ArrayBuffer) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function toBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function fromBase64(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
