import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { getDb } from "@/db";
import { subscriptions } from "@/db/schema";
import { findPlan, getEntitlement, razorpayConfig, razorpayRequest } from "@/lib/billing";
import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const inputSchema = z.object({ planCode: z.enum(["monthly", "half-yearly", "yearly"]) });

type RazorpaySubscription = {
  id: string;
  status: string;
  current_start?: number;
  current_end?: number;
  start_at?: number;
};

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
    const db = getDb();
    const providerPlan = await razorpayRequest<RazorpayPlan>(`/plans/${config.planIds[plan.code]}`);
    if (providerPlan.item?.amount !== plan.amountPaise || providerPlan.item?.currency !== "INR" || providerPlan.period !== plan.period || providerPlan.interval !== plan.interval) {
      throw new Error(`The Razorpay ${plan.label} plan does not match the approved price and billing interval`);
    }
    const [existing] = await db.select().from(subscriptions).where(and(
      eq(subscriptions.userId, user.uid),
      eq(subscriptions.planCode, plan.code),
      inArray(subscriptions.status, ["created", "authenticated", "pending", "active"]),
      isNull(subscriptions.deletedAt),
    )).orderBy(desc(subscriptions.createdAt)).limit(1);
    if (existing?.providerSubscriptionId) {
      return Response.json({ keyId: config.keyId, subscriptionId: existing.providerSubscriptionId, plan });
    }

    const entitlement = await getEntitlement(user.uid);
    const trialStart = entitlement.state === "trial" && entitlement.trialEndsAt
      ? Math.floor(new Date(entitlement.trialEndsAt).getTime() / 1000)
      : undefined;
    const provider = await razorpayRequest<RazorpaySubscription>("/subscriptions", {
      method: "POST",
      body: JSON.stringify({
        plan_id: config.planIds[plan.code],
        total_count: plan.totalCount,
        quantity: 1,
        customer_notify: true,
        ...(trialStart ? { start_at: trialStart } : {}),
        notes: { app_user_id: user.uid, plan_code: plan.code },
      }),
    });
    const now = new Date().toISOString();
    await db.insert(subscriptions).values({
      id: crypto.randomUUID(),
      userId: user.uid,
      providerSubscriptionId: provider.id,
      planCode: plan.code,
      status: provider.status,
      currentPeriodStart: provider.current_start ? new Date(provider.current_start * 1000).toISOString() : null,
      currentPeriodEnd: provider.current_end ? new Date(provider.current_end * 1000).toISOString() : entitlement.trialEndsAt,
      createdAt: now,
      updatedAt: now,
    });
    return Response.json({ keyId: config.keyId, subscriptionId: provider.id, plan }, { status: 201 });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Checkout could not be started" }, { status: 503 });
  }
}
