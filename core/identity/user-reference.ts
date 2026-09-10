/**
 * The account number an investor quotes — on a support request, on a printed
 * statement, when two people are looking at the same record.
 *
 * `PORT-2026-A3F9`: the year the account was opened, then the last four
 * characters of the Firebase uid. The uid itself is long, case-sensitive and
 * unreadable aloud; four characters are not, and the year in front of them
 * makes the reference say something useful on its own.
 *
 * Assigned once and stored, never recomputed for display. A reference people
 * have written down cannot change because the format later did.
 *
 * Four characters do not make this unique on their own — it identifies an
 * account to someone who already has it, and is not a key to look one up by.
 */
const PREFIX = "PORT";

export function formatUserReference(uid: string, createdAtIso: string) {
  const year = createdAtIso.slice(0, 4);
  const suffix = uid.replace(/[^A-Za-z0-9]/g, "").slice(-4).toUpperCase();
  if (!/^\d{4}$/.test(year) || suffix.length < 4) return null;
  return `${PREFIX}-${year}-${suffix}`;
}
