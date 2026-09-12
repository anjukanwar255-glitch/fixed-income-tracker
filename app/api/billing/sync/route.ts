import { firstDoc, subscriptions } from "@/db";
import { getEntitlement, razorpayRequest, unixToIso } from "@/lib/billing";
import { isOneTimePlan, oneTimeAccessEnd } from "@/lib/plans";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

type ProviderSubscription = { id: string; status: string; current_start?: number; current_end?: number; cancel_at_cycle_end?: boolean };
type ProviderOrder = { id: string; status: string; amount?: number };

export async function POST() {
  const user = await authenticatedUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const record = await firstDoc(subscriptions(user.uid)
    .where("deletedAt", "==", null)
    .orderBy("createdAt", "desc"));
  if (!record?.providerSubscriptionId) return Response.json({ entitlement: await getEntitlement(user.uid) });

  const now = new Date().toISOString();
  try {
    if (isOneTimePlan(record.planCode)) {
      const order = await razorpayRequest<ProviderOrder>(`/orders/${record.providerSubscriptionId}`);
      const paid = order.status === "paid";
      await subscriptions(user.uid).doc(record.id).update({
        status: paid ? "active" : order.status,
        // The term starts when it was paid for, and only then.
        currentPeriodStart: paid ? now : record.currentPeriodStart ?? null,
        currentPeriodEnd: paid ? oneTimeAccessEnd(record.planCode, new Date(now)) : record.currentPeriodEnd ?? null,
        updatedAt: now,
      });
      return Response.json({ entitlement: await getEntitlement(user.uid) });
    }

    const provider = await razorpayRequest<ProviderSubscription>(`/subscriptions/${record.providerSubscriptionId}`);
    await subscriptions(user.uid).doc(record.id).update({
      status: provider.status,
      currentPeriodStart: unixToIso(provider.current_start),
      currentPeriodEnd: unixToIso(provider.current_end) ?? record.currentPeriodEnd,
      cancelAtPeriodEnd: Boolean(provider.cancel_at_cycle_end),
      updatedAt: now,
    });
    return Response.json({ entitlement: await getEntitlement(user.uid) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Subscription status unavailable" }, { status: 503 });
  }
}
