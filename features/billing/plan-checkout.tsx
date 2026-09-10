"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/firebase-client";
import type { Entitlement, PlanCode } from "@/lib/billing";

export type Plan = {
  code: PlanCode;
  label: string;
  amountPaise: number;
  period: string;
  interval: number;
};

type RazorpayConstructor = new (options: Record<string, unknown>) => { open(): void; on(event: string, callback: (value: unknown) => void): void };

declare global {
  interface Window { Razorpay?: RazorpayConstructor }
}

/**
 * Starting a subscription, wherever it is started from.
 *
 * Shared by the gate that appears when a trial runs out and by the
 * subscription screen, so a plan is bought the same way in both — one
 * checkout, one activation path, one set of failure messages to keep honest.
 */
export function usePlanCheckout({ displayName, email, phoneNumber, onActivated }: {
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  onActivated: () => Promise<void> | void;
}) {
  const [busyPlan, setBusyPlan] = useState<PlanCode | null>(null);

  const subscribe = async (planCode: PlanCode) => {
    setBusyPlan(planCode);
    try {
      await loadRazorpay();
      const response = await apiFetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ planCode }),
      });
      const payload = await response.json() as { error?: string; keyId?: string; subscriptionId?: string; plan?: Plan };
      if (!response.ok || !payload.keyId || !payload.subscriptionId) throw new Error(payload.error ?? "Checkout could not be started");

      const checkout = new window.Razorpay!({
        key: payload.keyId,
        subscription_id: payload.subscriptionId,
        name: "Portfolio",
        description: `${payload.plan?.label ?? "Premium"} subscription`,
        prefill: { name: displayName, email: email ?? undefined, contact: phoneNumber ?? undefined },
        notes: { plan_code: planCode },
        theme: { color: "#0f766e" },
        modal: { ondismiss: () => setBusyPlan(null) },
        handler: async () => {
          toast.success("Payment authorised. Confirming your subscription…");
          const sync = await apiFetch("/api/billing/sync", { method: "POST" });
          if (!sync.ok) toast.warning("Payment is safe; activation will finish from the Razorpay webhook.");
          await onActivated();
          setBusyPlan(null);
        },
      });
      checkout.on("payment.failed", () => { toast.error("Payment was not completed"); setBusyPlan(null); });
      checkout.open();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Checkout could not be started");
      setBusyPlan(null);
    }
  };

  return { busyPlan, subscribe };
}

export function planPeriodLabel(code: PlanCode) {
  return code === "monthly" ? "month" : code === "half-yearly" ? "6 months" : "year";
}

export function PlanGrid({ plans, entitlement, busyPlan, onChoose, currentPlan }: {
  plans: Plan[];
  entitlement: Entitlement;
  busyPlan: PlanCode | null;
  onChoose: (code: PlanCode) => void;
  /** Marked rather than offered again, so the card cannot be bought twice. */
  currentPlan?: PlanCode | null;
}) {
  return (
    <div className="pricing-grid">
      {plans.map((plan) => {
        const active = currentPlan === plan.code;
        return (
          <article className="pricing-card" data-featured={plan.code === "yearly"} data-active={active} key={plan.code}>
            {active ? <span className="pricing-badge">Current plan</span> : plan.code === "yearly" && <span className="pricing-badge">Best value</span>}
            <h2>{plan.label}</h2>
            <p className="pricing-amount"><strong>₹{plan.amountPaise / 100}</strong><span>/{planPeriodLabel(plan.code)}</span></p>
            <ul><li><Check /> Unlimited investments</li><li><Check /> Encrypted Firebase backups</li><li><Check /> Payout and TDS tracking</li></ul>
            <Button
              className="w-full"
              variant={active ? "outline" : "default"}
              disabled={active || !entitlement.billingConfigured || busyPlan !== null}
              onClick={() => onChoose(plan.code)}
            >
              {active ? "Active" : busyPlan === plan.code ? "Opening secure checkout…" : `Choose ${plan.label}`}
            </Button>
          </article>
        );
      })}
    </div>
  );
}

function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve();
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[src="https://checkout.razorpay.com/v1/checkout.js"]');
    if (existing) {
      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener("error", () => reject(new Error("Secure checkout could not load")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Secure checkout could not load"));
    document.head.append(script);
  });
}
