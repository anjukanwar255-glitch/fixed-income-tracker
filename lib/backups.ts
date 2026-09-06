import { and, desc, eq, isNull, lt } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { getDb } from "@/db";
import {
  activityLogs,
  backupRuns,
  documents,
  formRecords,
  investments,
  notifications,
  payoutSchedules,
  payoutTransactions,
  tdsRecords,
  users,
} from "@/db/schema";
import type { AuthenticatedRequest } from "@/lib/firebase-auth";
import { deleteFirebaseObject, downloadFirebaseObject, uploadFirebaseObject } from "@/lib/firebase-storage";

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

export async function createUserBackup(identity: AuthenticatedRequest) {
  const secret = env.BACKUP_ENCRYPTION_KEY;
  if (!secret) throw new Error("BACKUP_ENCRYPTION_KEY is not configured");

  const db = getDb();
  const createdAt = new Date().toISOString();
  const payload: PortfolioBackup = {
    version: BACKUP_FORMAT_VERSION,
    createdAt,
    ownerId: identity.uid,
    data: await collectUserData(identity.uid),
  };
  const encrypted = await encryptBackup(payload, secret, env.BACKUP_KEY_VERSION ?? "v1");
  const digest = await sha256(encrypted);
  const day = createdAt.slice(0, 10);
  const latestKey = `users/${identity.uid}/backups/latest.enc`;
  const dailyKey = `users/${identity.uid}/backups/${day}.enc`;

  await uploadFirebaseObject(identity.token, latestKey, encrypted, "application/octet-stream", identity.appCheckToken);
  await uploadFirebaseObject(identity.token, dailyKey, encrypted, "application/octet-stream", identity.appCheckToken);
  const [sameDay] = await db.select({ id: backupRuns.id }).from(backupRuns).where(and(
    eq(backupRuns.userId, identity.uid),
    eq(backupRuns.objectKey, dailyKey),
  )).limit(1);
  if (sameDay) {
    await db.update(backupRuns).set({ sha256: digest, sizeBytes: encrypted.byteLength, status: "completed", failureReason: null, createdAt }).where(eq(backupRuns.id, sameDay.id));
  } else {
    await db.insert(backupRuns).values({
      id: crypto.randomUUID(),
      userId: identity.uid,
      objectKey: dailyKey,
      sha256: digest,
      sizeBytes: encrypted.byteLength,
      status: "completed",
      createdAt,
    });
  }
  await pruneOldBackups(identity).catch(() => undefined);
  return { createdAt, objectKey: dailyKey, sha256: digest, sizeBytes: encrypted.byteLength };
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
  const db = getDb();
  const [latest] = await db.select().from(backupRuns)
    .where(eq(backupRuns.userId, ownerId))
    .orderBy(desc(backupRuns.createdAt))
    .limit(1);
  return latest ?? null;
}

export async function collectUserData(ownerId: string) {
  const db = getDb();
  const [profile, investmentRows, schedules, transactions, tds, forms, documentRows, notificationRows, activities] = await Promise.all([
    db.select().from(users).where(and(eq(users.id, ownerId), isNull(users.deletedAt))).limit(1),
    db.select().from(investments).where(eq(investments.userId, ownerId)),
    db.select().from(payoutSchedules).where(eq(payoutSchedules.userId, ownerId)),
    db.select().from(payoutTransactions).where(eq(payoutTransactions.userId, ownerId)),
    db.select().from(tdsRecords).where(eq(tdsRecords.userId, ownerId)),
    db.select().from(formRecords).where(eq(formRecords.userId, ownerId)),
    db.select().from(documents).where(eq(documents.userId, ownerId)),
    db.select().from(notifications).where(eq(notifications.userId, ownerId)),
    db.select().from(activityLogs).where(eq(activityLogs.userId, ownerId)),
  ]);
  return {
    profile: profile[0] ?? null,
    investments: investmentRows,
    payoutSchedules: schedules,
    payoutTransactions: transactions,
    tdsRecords: tds,
    forms,
    documents: documentRows,
    notifications: notificationRows,
    activityLogs: activities,
  };
}

export function isBackupConfigured() {
  return Boolean(env.BACKUP_ENCRYPTION_KEY);
}

async function pruneOldBackups(identity: AuthenticatedRequest) {
  const db = getDb();
  const cutoff = new Date(Date.now() - 35 * 86_400_000).toISOString();
  const stale = await db.select({ id: backupRuns.id, objectKey: backupRuns.objectKey }).from(backupRuns).where(and(
    eq(backupRuns.userId, identity.uid),
    lt(backupRuns.createdAt, cutoff),
  ));
  for (const item of stale) await deleteFirebaseObject(identity.token, item.objectKey, identity.appCheckToken);
  if (stale.length) await db.delete(backupRuns).where(and(eq(backupRuns.userId, identity.uid), lt(backupRuns.createdAt, cutoff)));
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
