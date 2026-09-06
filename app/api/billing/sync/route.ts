import { and, desc, eq, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { getEntitlement, razorpayRequest, unixToIso } from "@/lib/billing";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

type ProviderSubscription = { id: string; status: string; current_start?: number; current_end?: number; cancel_at_cycle_end?: boolean };

export async function POST() {
  const user = await authenticatedUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const db = getDb();
  const [record] = await db.select().from(subscriptions).where(and(
    eq(subscriptions.userId, user.uid),
    isNull(subscriptions.deletedAt),
  )).orderBy(desc(subscriptions.createdAt)).limit(1);
  if (!record?.providerSubscriptionId) return Response.json({ entitlement: await getEntitlement(user.uid) });

  try {
    const provider = await razorpayRequest<ProviderSubscription>(`/subscriptions/${record.providerSubscriptionId}`);
    await db.update(subscriptions).set({
      status: provider.status,
      currentPeriodStart: unixToIso(provider.current_start),
      currentPeriodEnd: unixToIso(provider.current_end) ?? record.currentPeriodEnd,
      cancelAtPeriodEnd: Boolean(provider.cancel_at_cycle_end),
      updatedAt: new Date().toISOString(),
    }).where(eq(subscriptions.id, record.id));
    return Response.json({ entitlement: await getEntitlement(user.uid) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Subscription status unavailable" }, { status: 503 });
  }
}
