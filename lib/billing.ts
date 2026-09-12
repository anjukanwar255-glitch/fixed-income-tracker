import { env } from "@/lib/env";

import { firstDoc, readDoc, subscriptions, userDoc } from "@/db";
import { subscriptionPlans as plans, type PlanCode as Code } from "@/lib/plans";

export { subscriptionPlans, planSavingPercent } from "@/lib/plans";
export type { PlanCode } from "@/lib/plans";

export type Entitlement = {
  entitled: boolean;
  state: "onboarding" | "trial" | "subscribed" | "expired";
  trialEndsAt: string | null;
  daysRemaining: number;
  planCode: Code | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  billingConfigured: boolean;
};

export async function getEntitlement(ownerId: string): Promise<Entitlement> {
  const now = new Date();
  const stored = await readDoc(userDoc(ownerId));
  const profile = stored && !stored.deletedAt ? stored : null;
  if (!profile) {
    return { entitled: true, state: "onboarding", trialEndsAt: null, daysRemaining: 0, planCode: null, subscriptionStatus: null, currentPeriodEnd: null, cancelAtPeriodEnd: false, billingConfigured: isBillingConfigured() };
  }

  const active = await firstDoc(subscriptions(ownerId)
    .where("deletedAt", "==", null)
    .where("status", "in", ["active", "authenticated"])
    .where("currentPeriodEnd", ">", now.toISOString())
    .orderBy("currentPeriodEnd", "desc"));
  if (active) {
    return {
      entitled: true,
      state: "subscribed",
      trialEndsAt: profile.trialEndsAt ?? null,
      daysRemaining: 0,
      planCode: active.planCode,
      subscriptionStatus: active.status,
      currentPeriodEnd: active.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: active.cancelAtPeriodEnd,
      billingConfigured: isBillingConfigured(),
    };
  }

  const trialEndsAt = profile.trialEndsAt ? new Date(profile.trialEndsAt) : null;
  const trialActive = Boolean(trialEndsAt && trialEndsAt.getTime() > now.getTime());
  return {
    entitled: trialActive,
    state: trialActive ? "trial" : "expired",
    trialEndsAt: profile.trialEndsAt ?? null,
    daysRemaining: trialEndsAt ? Math.max(0, Math.ceil((trialEndsAt.getTime() - now.getTime()) / 86_400_000)) : 0,
    planCode: null,
    subscriptionStatus: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    billingConfigured: isBillingConfigured(),
  };
}

export async function requireEntitlement(ownerId: string) {
  const entitlement = await getEntitlement(ownerId);
  return entitlement.entitled ? null : Response.json({
    error: "Your free trial has ended. Choose a plan to continue.",
    code: "SUBSCRIPTION_REQUIRED",
    entitlement,
  }, { status: 402 });
}

export function startTrial(now = new Date(), days = 7) {
  const start = now.toISOString();
  // Fixed at the moment the account is created. Shortening the trial later
  // must not cut short one already running — someone who was told seven days
  // was told seven days.
  const length = Number.isFinite(days) && days >= 1 && days <= 90 ? Math.round(days) : 7;
  const end = new Date(now.getTime() + length * 86_400_000).toISOString();
  return { trialStartedAt: start, trialEndsAt: end };
}

export async function trialIdentityHash(identity: { phoneNumber: string | null; email: string | null }) {
  const secret = env.TRIAL_HASH_SECRET;
  if (!secret || secret.length < 24) throw new Error("Trial protection is not configured");
  const canonical = identity.phoneNumber
    ? `phone:${identity.phoneNumber.replace(/\s/g, "")}`
    : identity.email
      ? `email:${identity.email.trim().toLowerCase()}`
      : null;
  if (!canonical) throw new Error("A verified phone number or email is required for the free trial");
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(canonical));
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function isBillingConfigured() {
  return Boolean(
    env.RAZORPAY_KEY_ID &&
    env.RAZORPAY_KEY_SECRET &&
    env.RAZORPAY_PLAN_MONTHLY &&
    env.RAZORPAY_PLAN_HALF_YEARLY &&
    env.RAZORPAY_PLAN_YEARLY &&
    env.RAZORPAY_WEBHOOK_SECRET
  );
}

export function razorpayConfig() {
  if (!isBillingConfigured()) throw new Error("Razorpay billing is not configured");
  return {
    keyId: env.RAZORPAY_KEY_ID!,
    keySecret: env.RAZORPAY_KEY_SECRET!,
    webhookSecret: env.RAZORPAY_WEBHOOK_SECRET!,
    planIds: {
      monthly: env.RAZORPAY_PLAN_MONTHLY!,
      "half-yearly": env.RAZORPAY_PLAN_HALF_YEARLY!,
      yearly: env.RAZORPAY_PLAN_YEARLY!,
    } satisfies Record<Code, string>,
  };
}

export function findPlan(code: string) {
  return plans.find((plan) => plan.code === code) ?? null;
}

export async function razorpayRequest<T>(path: string, init: RequestInit = {}) {
  const config = razorpayConfig();
  const response = await fetch(`https://api.razorpay.com/v1${path}`, {
    ...init,
    headers: {
      authorization: `Basic ${btoa(`${config.keyId}:${config.keySecret}`)}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  const payload = await response.json().catch(() => null) as T | { error?: { description?: string } } | null;
  if (!response.ok) {
    const description = payload && typeof payload === "object" && "error" in payload ? payload.error?.description : null;
    throw new Error(description || `Razorpay request failed (${response.status})`);
  }
  return payload as T;
}

export function unixToIso(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value * 1000).toISOString() : null;
}
