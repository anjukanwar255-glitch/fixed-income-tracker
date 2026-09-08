import { getDb, investments, listDocs, payoutSchedules } from "@/db";
import type { InvestmentDoc } from "@/db/types";
import { requireEntitlement } from "@/lib/billing";
import { authenticatedUser } from "@/lib/firebase-auth";

const SETTLED_PAYOUT_STATUSES = new Set(["received", "partial-received"]);

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await authenticatedUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(identity.uid);
  if (paywall) return paywall;

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const until = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  // Firestore allows only one `not-in` per query and requires it to lead the
  // ordering, which conflicts with ordering by due date. Fetching a wider
  // window and dropping settled payouts here keeps the ordering and needs no
  // extra index.
  const [dueSchedules, maturityRows] = await Promise.all([
    listDocs(payoutSchedules(identity.uid)
      .where("deletedAt", "==", null)
      .where("dueDate", ">=", from)
      .where("dueDate", "<=", until)
      .orderBy("dueDate", "asc")
      .limit(100)),
    listDocs(investments(identity.uid)
      .where("deletedAt", "==", null)
      .where("status", "==", "active")
      .where("maturityDate", ">=", from)
      .where("maturityDate", "<=", until)
      .orderBy("maturityDate", "asc")
      .limit(25)),
  ]);

  const pending = dueSchedules.filter((row) => !SETTLED_PAYOUT_STATUSES.has(row.status)).slice(0, 25);

  // The join the SQL query did. Only the parent investments actually referenced
  // are read, and a soft-deleted parent hides its payouts as before.
  const parentIds = [...new Set(pending.map((row) => row.investmentId))];
  const parents = new Map<string, InvestmentDoc>();
  if (parentIds.length) {
    const snapshots = await getDb().getAll(...parentIds.map((id) => investments(identity.uid).doc(id)));
    for (const snapshot of snapshots) {
      const parent = snapshot.data() as InvestmentDoc | undefined;
      if (parent && !parent.deletedAt) parents.set(snapshot.id, parent);
    }
  }

  const payouts = pending.flatMap((row) => {
    const parent = parents.get(row.investmentId);
    return parent
      ? [{ id: row.id, dueDate: row.dueDate, investmentId: row.investmentId, name: parent.investmentName, amountPaise: row.expectedNetPaise }]
      : [];
  });
  const maturities = maturityRows.map((row) => ({ id: row.id, dueDate: row.maturityDate, name: row.investmentName }));

  const reminders = [
    ...payouts.map((item) => ({
      id: `payout:${item.id}`,
      category: "payout" as const,
      investmentId: item.investmentId,
      dueDate: item.dueDate,
      title: `${item.name} payout due`,
      body: `${formatRupees(item.amountPaise)} expected on ${formatDate(item.dueDate)}`,
    })),
    ...maturities.map((item) => ({
      id: `maturity:${item.id}`,
      category: "maturity" as const,
      investmentId: item.id,
      dueDate: item.dueDate,
      title: `${item.name} matures`,
      body: `Maturity is scheduled for ${formatDate(item.dueDate)}`,
    })),
  ].sort((a, b) => a.dueDate.localeCompare(b.dueDate)).slice(0, 30);

  return Response.json({ reminders, count: reminders.length });
}

function formatRupees(paise: number) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(paise / 100);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }).format(new Date(`${value}T00:00:00+05:30`));
}
