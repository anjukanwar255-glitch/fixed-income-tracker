import { firstDoc, subscriptions } from "@/db";
import { getEntitlement, razorpayRequest, unixToIso } from "@/lib/billing";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

type ProviderSubscription = { id: string; status: string; current_start?: number; current_end?: number; cancel_at_cycle_end?: boolean };

export async function POST() {
  const user = await authenticatedUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const record = await firstDoc(subscriptions(user.uid)
    .where("deletedAt", "==", null)
    .orderBy("createdAt", "desc"));
  if (!record?.providerSubscriptionId) return Response.json({ entitlement: await getEntitlement(user.uid) });

  try {
    const provider = await razorpayRequest<ProviderSubscription>(`/subscriptions/${record.providerSubscriptionId}`);
    await subscriptions(user.uid).doc(record.id).update({
      status: provider.status,
      currentPeriodStart: unixToIso(provider.current_start),
      currentPeriodEnd: unixToIso(provider.current_end) ?? record.currentPeriodEnd,
      cancelAtPeriodEnd: Boolean(provider.cancel_at_cycle_end),
      updatedAt: new Date().toISOString(),
    });
    return Response.json({ entitlement: await getEntitlement(user.uid) });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Subscription status unavailable" }, { status: 503 });
  }
}
