"use client";

import { useState } from "react";
import { Check } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch } from "@/lib/firebase-client";
import { planSavingPercent, subscriptionPlans, type PlanCode } from "@/lib/plans";
import type { Entitlement } from "@/lib/billing";

export type Plan = {
  code: PlanCode;
  label: string;
  amountPaise: number;
  monthsCovered: number;
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
      const payload = await response.json() as { error?: string; keyId?: string; subscriptionId?: string; orderId?: string; plan?: Plan };
      const handle = payload.subscriptionId ?? payload.orderId;
      if (!response.ok || !payload.keyId || !handle) throw new Error(payload.error ?? "Checkout could not be started");

      const checkout = new window.Razorpay!({
        key: payload.keyId,
        // A plan bought outright is an order, not a subscription. Razorpay
        // takes one or the other, and naming the wrong one opens a sheet that
        // charges the wrong thing.
        ...(payload.orderId ? { order_id: payload.orderId } : { subscription_id: payload.subscriptionId }),
        name: "Portfolio",
        description: payload.orderId ? `${payload.plan?.label ?? "Premium"} — one payment` : `${payload.plan?.label ?? "Premium"} subscription`,
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

/** What one payment buys, for the line beside the price. */
export function planPeriodLabel(code: PlanCode) {
  const plan = subscriptionPlans.find((entry) => entry.code === code);
  if (!plan) return "year";
  if (plan.monthsCovered === 1) return "month";
  if (plan.monthsCovered === 12) return "year";
  return `${plan.monthsCovered / 12} years`;
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
        const saving = planSavingPercent(plans, plan.code);
        const perMonth = plan.monthsCovered > 1 ? plan.amountPaise / plan.monthsCovered / 100 : null;
        const selectable = !active && entitlement.billingConfigured && busyPlan === null;
        return (
          // The whole card is the target, not just the button at the bottom —
          // a pricing card reads as one thing to tap, and on a phone the button
          // is often the part that is scrolled off.
          <article
            className="pricing-card"
            data-featured={plan.code === "yearly"}
            data-active={active}
            data-selectable={selectable}
            key={plan.code}
            role={selectable ? "button" : undefined}
            tabIndex={selectable ? 0 : undefined}
            onClick={selectable ? () => onChoose(plan.code) : undefined}
            onKeyDown={selectable ? (event) => {
              if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onChoose(plan.code); }
            } : undefined}
          >
            <div className="pricing-badge-row">
              {active
                ? <span className="pricing-badge">Current plan</span>
                : saving > 0 ? <span className="pricing-badge">Save {saving}%</span> : null}
            </div>
            <h2>{plan.label}</h2>
            <p className="pricing-amount"><strong>₹{plan.amountPaise / 100}</strong><span>/{planPeriodLabel(plan.code)}</span></p>
            <p className="pricing-permonth">{perMonth === null ? "Billed every month" : `₹${perMonth.toFixed(2)} per month`}</p>
            <ul><li><Check /> Unlimited investments</li><li><Check /> Encrypted Firebase backups</li><li><Check /> Payout and TDS tracking</li></ul>
            <Button
              className="w-full"
              variant={active ? "outline" : "default"}
              disabled={active || !entitlement.billingConfigured || busyPlan !== null}
              // The card already handles the click; without this the button
              // would fire it a second time and open two checkouts.
              onClick={(event) => { event.stopPropagation(); onChoose(plan.code); }}
              aria-label={active ? `${plan.label} is your current plan` : `Choose the ${plan.label} plan`}
            >
              {active ? "Active" : busyPlan === plan.code ? "Opening checkout…" : "Choose"}
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
