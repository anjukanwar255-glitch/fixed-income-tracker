import { getApps, initializeApp } from "firebase-admin/app";
import {
  getFirestore,
  type CollectionReference,
  type DocumentReference,
  type Firestore,
  type Query,
  type UpdateData,
} from "firebase-admin/firestore";

/** Re-exported so callers get atomic operators without a second import path. */
export { FieldValue } from "firebase-admin/firestore";

import type {
  ActivityLogDoc,
  AdminSettingDoc,
  BackupRunDoc,
  ContributionDoc,
  BillingEventDoc,
  DocumentDoc,
  FinancialYearDoc,
  FormDoc,
  InvestmentDoc,
  InvestmentTypeDoc,
  IssuerDoc,
  NotificationDoc,
  PayoutScheduleDoc,
  PayoutTransactionDoc,
  SubscriptionDoc,
  TdsRecordDoc,
  TrialClaimDoc,
  UserDoc,
} from "./types";

/**
 * Firestore accessors.
 *
 * Credentials come from Application Default Credentials, which App Hosting
 * supplies through the Cloud Run metadata server. Locally, point
 * GOOGLE_APPLICATION_CREDENTIALS at a service account key or run the emulator.
 *
 * The instance is cached on `globalThis` rather than in a module variable
 * because `settings()` may only be called once per Firestore instance, and the
 * dev server re-evaluates modules while the admin app survives.
 */
const globalForDb = globalThis as unknown as { __firestore?: Firestore };

export function getDb(): Firestore {
  if (globalForDb.__firestore) return globalForDb.__firestore;

  const app = getApps()[0] ?? initializeApp();
  const db = getFirestore(app);
  // Route handlers pass `undefined` for unset optional fields. Without this
  // Firestore rejects the entire write rather than omitting the field.
  db.settings({ ignoreUndefinedProperties: true });
  globalForDb.__firestore = db;
  return db;
}

/**
 * Soft deletion.
 *
 * Firestore does not match a missing field against null, so a document written
 * without `deletedAt` is invisible to `where("deletedAt", "==", null)`. Every
 * create of a soft-deletable document must therefore write this explicitly,
 * and `ignoreUndefinedProperties` means `undefined` would silently not do it.
 */
export const NOT_DELETED = null;

/* Root collections. */

export function usersCollection() {
  return getDb().collection("users") as CollectionReference<UserDoc>;
}

export function userDoc(uid: string) {
  return usersCollection().doc(uid) as DocumentReference<UserDoc>;
}

export function issuers() {
  return getDb().collection("issuers") as CollectionReference<IssuerDoc>;
}

export function investmentTypes() {
  return getDb().collection("investmentTypes") as CollectionReference<InvestmentTypeDoc>;
}

export function financialYears() {
  return getDb().collection("financialYears") as CollectionReference<FinancialYearDoc>;
}

export function adminSettings() {
  return getDb().collection("adminSettings") as CollectionReference<AdminSettingDoc>;
}

export function billingEvents() {
  return getDb().collection("billingEvents") as CollectionReference<BillingEventDoc>;
}

export function trialClaims() {
  return getDb().collection("trialClaims") as CollectionReference<TrialClaimDoc>;
}

/**
 * The document id that makes a replayed webhook fail instead of processing
 * twice, replacing the old unique index on (provider, providerEventId).
 */
export function billingEventId(provider: string, providerEventId: string) {
  return `${provider}__${providerEventId}`;
}

/* User-owned subcollections. Ownership is the path, not a field. */

export function investments(uid: string) {
  return userDoc(uid).collection("investments") as CollectionReference<InvestmentDoc>;
}

export function payoutSchedules(uid: string) {
  return userDoc(uid).collection("payoutSchedules") as CollectionReference<PayoutScheduleDoc>;
}

export function payoutTransactions(uid: string) {
  return userDoc(uid).collection("payoutTransactions") as CollectionReference<PayoutTransactionDoc>;
}

export function tdsRecords(uid: string) {
  return userDoc(uid).collection("tdsRecords") as CollectionReference<TdsRecordDoc>;
}

export function contributions(uid: string) {
  return userDoc(uid).collection("contributions") as CollectionReference<ContributionDoc>;
}

export function forms(uid: string) {
  return userDoc(uid).collection("forms") as CollectionReference<FormDoc>;
}

export function documents(uid: string) {
  return userDoc(uid).collection("documents") as CollectionReference<DocumentDoc>;
}

export function subscriptions(uid: string) {
  return userDoc(uid).collection("subscriptions") as CollectionReference<SubscriptionDoc>;
}

export function backupRuns(uid: string) {
  return userDoc(uid).collection("backupRuns") as CollectionReference<BackupRunDoc>;
}

export function notifications(uid: string) {
  return userDoc(uid).collection("notifications") as CollectionReference<NotificationDoc>;
}

export function activityLogs(uid: string) {
  return userDoc(uid).collection("activityLogs") as CollectionReference<ActivityLogDoc>;
}

/**
 * Every user's subscriptions at once. The Razorpay webhook is authenticated by
 * signature, not by a session, so it knows the provider subscription id and
 * nothing else; this is the only way back to the owning user. It requires a
 * collection group index on `subscriptions`.
 */
export function allSubscriptions() {
  // `collectionGroup` is typed as `DocumentData` because Firestore cannot know
  // what a group holds, and the driver's types no longer accept a direct
  // assertion to a concrete shape. The cast is the same claim every accessor
  // above makes: these documents are written by this module, so they have the
  // shape it writes.
  return getDb().collectionGroup("subscriptions") as unknown as Query<SubscriptionDoc>;
}

/* Read helpers. */

export async function listDocs<T>(query: Query<T>): Promise<T[]> {
  const snapshot = await query.get();
  return snapshot.docs.map((doc) => doc.data());
}

export async function firstDoc<T>(query: Query<T>): Promise<T | null> {
  const snapshot = await query.limit(1).get();
  return snapshot.empty ? null : snapshot.docs[0].data();
}

export async function readDoc<T>(ref: DocumentReference<T>): Promise<T | null> {
  const snapshot = await ref.get();
  return snapshot.exists ? (snapshot.data() as T) : null;
}

/* Write helpers. */

/** Firestore commits at most 500 writes per batch. */
const BATCH_LIMIT = 500;

export type BatchOperation =
  | { kind: "set"; ref: DocumentReference<never>; data: unknown; merge?: boolean }
  | { kind: "update"; ref: DocumentReference<never>; data: unknown }
  | { kind: "delete"; ref: DocumentReference<never> };

/**
 * Applies writes in batches of 500.
 *
 * A single investment can generate hundreds of payout schedule rows, and
 * account deletion removes everything a user owns, so callers cannot assume
 * they stay under the limit. Chunks are committed in order; a failure part way
 * through leaves earlier chunks applied, which matches the previous D1
 * `batch()` behaviour for oversized operation lists.
 */
export async function commitAll(operations: BatchOperation[]): Promise<void> {
  const db = getDb();
  for (let index = 0; index < operations.length; index += BATCH_LIMIT) {
    const batch = db.batch();
    for (const operation of operations.slice(index, index + BATCH_LIMIT)) {
      if (operation.kind === "set") {
        batch.set(operation.ref, operation.data as never, { merge: operation.merge ?? false });
      } else if (operation.kind === "update") {
        batch.update(operation.ref, operation.data as never);
      } else {
        batch.delete(operation.ref);
      }
    }
    await batch.commit();
  }
}

export function setOp<T>(ref: DocumentReference<T>, data: T, merge = false): BatchOperation {
  return { kind: "set", ref: ref as DocumentReference<never>, data, merge };
}

/** `UpdateData` rather than `Partial<T>` so `FieldValue` operators are allowed. */
export function updateOp<T>(ref: DocumentReference<T>, data: UpdateData<T>): BatchOperation {
  return { kind: "update", ref: ref as DocumentReference<never>, data };
}

export function deleteOp<T>(ref: DocumentReference<T>): BatchOperation {
  return { kind: "delete", ref: ref as DocumentReference<never> };
}

/**
 * Removes a user and every subcollection beneath them. Firestore has no
 * cascade, and the old schema relied on foreign keys for this.
 *
 * `trialClaims` deliberately survives: it is pseudonymous and exists to stop a
 * deleted account from claiming a second free trial.
 */
export async function deleteUserTree(uid: string): Promise<void> {
  await getDb().recursiveDelete(userDoc(uid));
}
