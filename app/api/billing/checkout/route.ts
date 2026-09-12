import { z } from "zod";

import { firstDoc, subscriptions } from "@/db";
import { findPlan, getEntitlement, razorpayConfig, razorpayRequest } from "@/lib/billing";
import { isOneTimePlan, oneTimeAccessEnd, subscriptionPlans } from "@/lib/plans";
import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const inputSchema = z.object({
  planCode: z.enum(subscriptionPlans.map((plan) => plan.code) as [string, ...string[]]),
});

type RazorpaySubscription = {
  id: string;
  status: string;
  current_start?: number;
  current_end?: number;
  start_at?: number;
};

type RazorpayOrder = { id: string; status: string; amount: number; currency: string };

type RazorpayPlan = { period: string; interval: number; item?: { amount?: number; currency?: string } };

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const limited = await rateLimit(request, "billing-checkout", user.uid, 5, 10 * 60 * 1000);
  if (limited) return limited;
  const parsed = inputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose a valid subscription plan" }, { status: 400 });
  const plan = findPlan(parsed.data.planCode)!;

  try {
    const config = razorpayConfig();
    /*
     * Two shapes of purchase, and they are not variations of one another.
     *
     * A short plan is a subscription: Razorpay bills it again and again, and
     * access follows those bills. A long one is bought outright — a single
     * order for a stated number of years — so there is no plan configured with
     * Razorpay to check against, and nothing will ever bill again. Treating
     * the second as a subscription with a long interval would leave a mandate
     * standing on someone who has already paid in full.
     */
    return isOneTimePlan(plan.code)
      ? await buyOutright(user.uid, plan, config)
      : await subscribe(user.uid, plan, config);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Checkout could not be started" }, { status: 503 });
  }
}

type Plan = NonNullable<ReturnType<typeof findPlan>>;
type Config = ReturnType<typeof razorpayConfig>;

/** A plan Razorpay bills on a schedule. */
async function subscribe(uid: string, plan: Plan, config: Config) {
  const planId = config.planIds[plan.code as "monthly" | "yearly"];
  if (!planId) throw new Error(`No Razorpay plan is configured for ${plan.label}`);

  // The price is checked against Razorpay's own record rather than trusted
  // from here: a plan edited in their dashboard would otherwise charge one
  // amount while this app advertised another.
  const providerPlan = await razorpayRequest<RazorpayPlan>(`/plans/${planId}`);
  if (providerPlan.item?.amount !== plan.amountPaise || providerPlan.item?.currency !== "INR"
    || providerPlan.period !== plan.period || providerPlan.interval !== plan.interval) {
    throw new Error(`The Razorpay ${plan.label} plan does not match the approved price and billing interval`);
  }

  const existing = await firstDoc(subscriptions(uid)
    .where("deletedAt", "==", null)
    .where("planCode", "==", plan.code)
    .where("status", "in", ["created", "authenticated", "pending", "active"])
    .orderBy("createdAt", "desc"));
  if (existing?.providerSubscriptionId) {
    return Response.json({ keyId: config.keyId, subscriptionId: existing.providerSubscriptionId, plan });
  }

  const entitlement = await getEntitlement(uid);
  // Billing starts when the trial runs out, so nobody pays for days they had
  // already been given.
  const trialStart = entitlement.state === "trial" && entitlement.trialEndsAt
    ? Math.floor(new Date(entitlement.trialEndsAt).getTime() / 1000)
    : undefined;

  const provider = await razorpayRequest<RazorpaySubscription>("/subscriptions", {
    method: "POST",
    body: JSON.stringify({
      plan_id: planId,
      total_count: plan.totalCount,
      quantity: 1,
      customer_notify: true,
      ...(trialStart ? { start_at: trialStart } : {}),
      notes: { app_user_id: uid, plan_code: plan.code },
    }),
  });

  const now = new Date().toISOString();
  const recordId = crypto.randomUUID();
  await subscriptions(uid).doc(recordId).set({
    id: recordId,
    // Denormalised so the webhook, which sees only the provider id, can find
    // the owner through the subscriptions collection group.
    userId: uid,
    provider: "razorpay",
    providerSubscriptionId: provider.id,
    planCode: plan.code,
    status: provider.status,
    currentPeriodStart: provider.current_start ? new Date(provider.current_start * 1000).toISOString() : null,
    currentPeriodEnd: provider.current_end ? new Date(provider.current_end * 1000).toISOString() : entitlement.trialEndsAt,
    cancelAtPeriodEnd: false,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return Response.json({ keyId: config.keyId, subscriptionId: provider.id, plan }, { status: 201 });
}

/**
 * A plan bought outright: one order, one payment, access for a stated term.
 *
 * The record is written as `created` and only becomes active when the payment
 * is confirmed — by the webhook, or by the sync the client runs after
 * checkout. Writing it active here would hand out years of access to anyone
 * who opened the payment sheet and closed it.
 */
async function buyOutright(uid: string, plan: Plan, config: Config) {
  const existing = await firstDoc(subscriptions(uid)
    .where("deletedAt", "==", null)
    .where("planCode", "==", plan.code)
    .where("status", "in", ["created", "pending"])
    .orderBy("createdAt", "desc"));
  if (existing?.providerSubscriptionId) {
    return Response.json({ keyId: config.keyId, orderId: existing.providerSubscriptionId, plan });
  }

  const order = await razorpayRequest<RazorpayOrder>("/orders", {
    method: "POST",
    body: JSON.stringify({
      amount: plan.amountPaise,
      currency: "INR",
      notes: { app_user_id: uid, plan_code: plan.code },
    }),
  });

  const now = new Date().toISOString();
  const recordId = crypto.randomUUID();
  await subscriptions(uid).doc(recordId).set({
    id: recordId,
    userId: uid,
    provider: "razorpay",
    // The same field carries the order id: both are the provider's handle on
    // this purchase, and the webhook looks the owner up by it either way.
    providerSubscriptionId: order.id,
    planCode: plan.code,
    status: "created",
    currentPeriodStart: now,
    currentPeriodEnd: oneTimeAccessEnd(plan.code, new Date(now)),
    // Nothing renews, so there is nothing to cancel at the end of a period.
    cancelAtPeriodEnd: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
  });
  return Response.json({ keyId: config.keyId, orderId: order.id, plan }, { status: 201 });
}
