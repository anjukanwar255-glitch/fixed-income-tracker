import { firstDoc, subscriptions } from "@/db";
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

  const record = await firstDoc(subscriptions(identity.uid)
    .where("deletedAt", "==", null)
    .where("status", "in", ["created", "authenticated", "pending", "active"])
    .orderBy("createdAt", "desc"));
  if (!record?.providerSubscriptionId) {
    return Response.json({ error: "No renewable subscription was found" }, { status: 404 });
  }

  try {
    await razorpayRequest(`/subscriptions/${record.providerSubscriptionId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ cancel_at_cycle_end: 1 }),
    });
    await subscriptions(identity.uid).doc(record.id).update({
      cancelAtPeriodEnd: true,
      updatedAt: new Date().toISOString(),
    });
    return Response.json({ cancelledAtPeriodEnd: true, entitlement: await getEntitlement(identity.uid) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Subscription renewal could not be cancelled" }, { status: 503 });
  }
}
