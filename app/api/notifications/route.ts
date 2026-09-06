import { and, asc, eq, gte, inArray, isNull, lte, notInArray } from "drizzle-orm";

import { getDb } from "@/db";
import { investments, payoutSchedules } from "@/db/schema";
import { requireEntitlement } from "@/lib/billing";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const identity = await authenticatedUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  const paywall = await requireEntitlement(identity.uid);
  if (paywall) return paywall;

  const today = new Date();
  const from = today.toISOString().slice(0, 10);
  const until = new Date(today.getTime() + 30 * 86_400_000).toISOString().slice(0, 10);
  const db = getDb();
  const [payouts, maturities] = await Promise.all([
    db.select({
      id: payoutSchedules.id,
      dueDate: payoutSchedules.dueDate,
      investmentId: payoutSchedules.investmentId,
      name: investments.investmentName,
      amountPaise: payoutSchedules.expectedNetPaise,
    }).from(payoutSchedules).innerJoin(investments, eq(investments.id, payoutSchedules.investmentId)).where(and(
      eq(payoutSchedules.userId, identity.uid),
      isNull(payoutSchedules.deletedAt),
      isNull(investments.deletedAt),
      gte(payoutSchedules.dueDate, from),
      lte(payoutSchedules.dueDate, until),
      notInArray(payoutSchedules.status, ["received", "partial-received"]),
    )).orderBy(asc(payoutSchedules.dueDate)).limit(25),
    db.select({ id: investments.id, dueDate: investments.maturityDate, name: investments.investmentName })
      .from(investments).where(and(
        eq(investments.userId, identity.uid),
        isNull(investments.deletedAt),
        inArray(investments.status, ["active"]),
        gte(investments.maturityDate, from),
        lte(investments.maturityDate, until),
      )).orderBy(asc(investments.maturityDate)).limit(25),
  ]);

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
