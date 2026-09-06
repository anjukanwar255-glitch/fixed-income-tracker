"use client";

import { Landmark, LockKeyhole, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";

export function AuthFlow() {
  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark"><Landmark aria-hidden="true" /></span>
          <span>Fixed Income Tracker</span>
        </div>

        <div className="auth-heading">
          <span className="eyebrow">Protected portfolio</span>
          <h1 id="auth-title">Access your investments securely</h1>
          <p>Sign in to view and manage only your own FD, bond, payout and TDS records.</p>
        </div>

        <div className="auth-form">
          <Button asChild size="lg" className="w-full">
            <a href="/signin-with-chatgpt?return_to=%2F" target="_top">Continue securely</a>
          </Button>
          <p className="auth-provider-note">Authentication is handled by your ChatGPT account. Test codes are not accepted.</p>
        </div>

        <div className="auth-security">
          <ShieldCheck aria-hidden="true" />
          <span>Your records are isolated by signed-in user and stored in the private cloud database.</span>
        </div>
        <div className="auth-footnote"><LockKeyhole aria-hidden="true" /> Secure connection</div>
      </section>
    </main>
  );
}
