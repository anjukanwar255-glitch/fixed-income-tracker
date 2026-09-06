"use client";

import { useState } from "react";
import { Check, Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { deleteUser } from "firebase/auth";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { apiFetch, getFirebaseAuth } from "@/lib/firebase-client";
import type { Entitlement, PlanCode } from "@/lib/billing";

type Plan = {
  code: PlanCode;
  label: string;
  amountPaise: number;
  period: string;
  interval: number;
};

type Props = {
  entitlement: Entitlement;
  plans: Plan[];
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  onActivated: () => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
};

type RazorpayConstructor = new (options: Record<string, unknown>) => { open(): void; on(event: string, callback: (value: unknown) => void): void };

declare global {
  interface Window { Razorpay?: RazorpayConstructor }
}

export function SubscriptionGate({ entitlement, plans, displayName, email, phoneNumber, onActivated, onSignOut }: Props) {
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
        name: "Fixed Income Tracker",
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

  const exportData = async () => {
    const response = await apiFetch("/api/account/export");
    if (!response.ok) { toast.error("Account export could not be prepared"); return; }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = "fixed-income-account-export.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const deleteAccount = async () => {
    if (!window.confirm("Permanently delete this account, all investments, documents and backups?")) return;
    const response = await apiFetch("/api/account", { method: "DELETE" });
    const result = await response.json() as { error?: string };
    if (!response.ok) { toast.error(result.error ?? "Account could not be deleted"); return; }
    const current = getFirebaseAuth().currentUser;
    if (current) await deleteUser(current).catch(() => undefined);
    await onSignOut();
  };

  return (
    <main className="subscription-shell">
      <section className="subscription-card">
        <div className="auth-brand"><span className="brand-mark"><Landmark aria-hidden="true" /></span><span>Fixed Income Tracker</span></div>
        <div className="subscription-heading">
          <span className="eyebrow"><LockKeyhole aria-hidden="true" /> Trial complete</span>
          <h1>Keep your portfolio protected and up to date</h1>
          <p>Your records remain private. Choose a plan to continue adding investments, checking payouts and downloading documents.</p>
        </div>
        <div className="pricing-grid">
          {plans.map((plan) => (
            <article className="pricing-card" data-featured={plan.code === "yearly"} key={plan.code}>
              {plan.code === "yearly" && <span className="pricing-badge">Best value</span>}
              <h2>{plan.label}</h2>
              <p className="pricing-amount"><strong>₹{plan.amountPaise / 100}</strong><span>/{plan.code === "monthly" ? "month" : plan.code === "half-yearly" ? "6 months" : "year"}</span></p>
              <ul><li><Check /> Unlimited investments</li><li><Check /> Encrypted Firebase backups</li><li><Check /> Payout and TDS tracking</li></ul>
              <Button className="w-full" disabled={!entitlement.billingConfigured || busyPlan !== null} onClick={() => void subscribe(plan.code)}>
                {busyPlan === plan.code ? "Opening secure checkout…" : `Choose ${plan.label}`}
              </Button>
            </article>
          ))}
        </div>
        {!entitlement.billingConfigured && <p className="billing-setup-warning">Secure payments are being configured. No charge can be made until Razorpay live keys and plan IDs are connected.</p>}
        <div className="subscription-trust"><ShieldCheck /><span>Payments are processed by Razorpay. Card, UPI and bank credentials are never stored by this app.</span></div>
        <div className="subscription-links"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/support">Support</a><button onClick={() => void exportData()}>Export my data</button><button onClick={() => void deleteAccount()}>Delete account</button><button onClick={() => void onSignOut()}>Sign out</button></div>
      </section>
    </main>
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
    document.head.appendChild(script);
  });
}
