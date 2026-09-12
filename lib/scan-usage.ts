import { FieldValue } from "@google-cloud/firestore";

import { readDoc, usage } from "@/db";

/**
 * How many scans an account has left this month.
 *
 * The hourly rate limit stops someone hammering the reader; it does nothing
 * about the bill. At fifteen an hour an account can ask for ten thousand
 * readings in a month, and each one costs real money against a subscription
 * that does not move — so the ceiling has to be measured over the month that
 * is being paid for.
 */
export function currentPeriod(now = new Date()) {
  return now.toISOString().slice(0, 7);
}

export async function scansUsed(uid: string, period = currentPeriod()) {
  try {
    const stored = await readDoc(usage(uid).doc(period));
    return stored?.scans ?? 0;
  } catch {
    // An unreadable counter must not hand out free scans, but it must not
    // block someone either; the hourly limit still stands behind this.
    return 0;
  }
}

/**
 * Counted after the reading succeeds, not before it.
 *
 * A refused or broken scan gives nothing back, and charging someone's
 * allowance for it would make a fault of ours cost them. Concurrency is
 * already held down by the hourly limit, so counting afterwards cannot be
 * used to slip past the month's.
 */
export async function recordScan(uid: string, period = currentPeriod()) {
  const now = new Date().toISOString();
  await usage(uid).doc(period).set({
    id: period,
    scans: FieldValue.increment(1) as unknown as number,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  }, { merge: true });
}
