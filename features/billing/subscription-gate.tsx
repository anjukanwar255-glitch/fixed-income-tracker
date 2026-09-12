"use client";

import { Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { deleteUser } from "firebase/auth";
import { toast } from "sonner";

import { apiFetch, getFirebaseAuth } from "@/lib/firebase-client";
import { PlanGrid, type Plan, usePlanCheckout } from "@/features/billing/plan-checkout";
import type { Entitlement } from "@/lib/billing";

type Props = {
  entitlement: Entitlement;
  plans: Plan[];
  displayName: string;
  email: string | null;
  phoneNumber: string | null;
  onActivated: () => Promise<void> | void;
  onSignOut: () => Promise<void> | void;
};

export function SubscriptionGate({ entitlement, plans, displayName, email, phoneNumber, onActivated, onSignOut }: Props) {
  const { busyPlan, subscribe } = usePlanCheckout({ displayName, email, phoneNumber, onActivated });

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
        <div className="auth-brand"><span className="brand-mark"><Landmark aria-hidden="true" /></span><span>Portfolio</span></div>
        <div className="subscription-heading">
          <span className="eyebrow"><LockKeyhole aria-hidden="true" /> Trial complete</span>
          <h1>Keep your portfolio protected and up to date</h1>
          <p>Your records remain private. Choose a plan to continue adding investments, checking payouts and downloading documents.</p>
        </div>
        <PlanGrid plans={plans} entitlement={entitlement} busyPlan={busyPlan} onChoose={(code) => void subscribe(code)} />
        {!entitlement.billingConfigured && <p className="billing-setup-warning">Payments are not switched on yet, so nothing here can be bought and nothing can be charged.</p>}
        <div className="subscription-trust"><ShieldCheck /><span>Payments are processed by Razorpay. Card, UPI and bank credentials are never stored by this app.</span></div>
        <div className="subscription-links"><a href="/terms">Terms</a><a href="/privacy">Privacy</a><a href="/support">Support</a><button onClick={() => void exportData()}>Export my data</button><button onClick={() => void deleteAccount()}>Delete account</button><button onClick={() => void onSignOut()}>Sign out</button></div>
      </section>
    </main>
  );
}
