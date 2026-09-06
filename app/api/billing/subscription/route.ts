import { and, desc, eq, inArray, isNull } from "drizzle-orm";

import { getDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { getEntitlement, razorpayRequest } from "@/lib/billing";
import { authenticatedRequest, hasRecentAuthentication } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  const identity = await authenticatedRequest();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });
  if (!hasRecentAuthentication(identity)) {
    return Response.json({ error: "Please sign in again before changing subscription renewal" }, { status: 403 });
  }
  const limited = await rateLimit(request, "billing-cancel", identity.uid, 5, 60 * 60 * 1000);
  if (limited) return limited;

  const db = getDb();
  const [record] = await db.select().from(subscriptions).where(and(
    eq(subscriptions.userId, identity.uid),
    inArray(subscriptions.status, ["created", "authenticated", "pending", "active"]),
    isNull(subscriptions.deletedAt),
  )).orderBy(desc(subscriptions.createdAt)).limit(1);
  if (!record?.providerSubscriptionId) {
    return Response.json({ error: "No renewable subscription was found" }, { status: 404 });
  }

  try {
    await razorpayRequest(`/subscriptions/${record.providerSubscriptionId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
    });
    await db.update(subscriptions).set({
      cancelAtPeriodEnd: true,
      updatedAt: new Date().toISOString(),
    }).where(eq(subscriptions.id, record.id));
    return Response.json({ cancelledAtPeriodEnd: true, entitlement: await getEntitlement(identity.uid) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Subscription renewal could not be cancelled" }, { status: 503 });
  }
}
