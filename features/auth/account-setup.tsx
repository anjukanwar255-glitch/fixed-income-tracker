"use client";

import { useState } from "react";
import { Landmark, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { maskPhoneNumber } from "@/hooks/use-firebase-auth";
import { apiFetch } from "@/lib/firebase-client";

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

type Props = {
  phoneNumber: string | null;
  /** Resolves once the saved profile has been re-read by the shell. */
  onComplete: () => Promise<void> | void;
};

/**
 * Shown once, after the first successful sign-in, while `users.full_name` is
 * still empty. Only the name is required — every other field can be filled in
 * later from Profile, so a new investor reaches their dashboard quickly.
 */
export function AccountSetup({ phoneNumber, onComplete }: Props) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [pan, setPan] = useState("");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [saving, setSaving] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async () => {
    if (fullName.trim().length < 2) {
      setError("Enter your full name as it appears on your investments.");
      return;
    }
    if (pan && !PAN_PATTERN.test(pan)) {
      setError("That PAN doesn't look right. The format is ABCDE1234F.");
      return;
    }
    if (!acceptedTerms) {
      setError("Accept the Terms and Privacy Policy to start your free trial.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch("/api/profile", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim(), email: email.trim(), pan, dateOfBirth, acceptedTerms }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Your profile could not be saved");
      await onComplete();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Your profile could not be saved");
      setSaving(false);
    }
  };

  const restoreBackup = async () => {
    if (!window.confirm("Restore the latest encrypted Firebase snapshot for this account? Existing newer records will never be overwritten.")) return;
    setSaving(true);
    setError(null);
    try {
      const response = await apiFetch("/api/backups/restore", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirm: "RESTORE" }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Recovery failed");
      await onComplete();
    } catch (restoreError) {
      setError(restoreError instanceof Error ? restoreError.message : "Recovery failed");
      setSaving(false);
    }
  };

  return (
    <main className="auth-shell">
      <section className="auth-card setup-card" aria-labelledby="setup-title">
        <div className="auth-brand">
          <span className="brand-mark"><Landmark aria-hidden="true" /></span>
          <span>Fixed Income Tracker</span>
        </div>

        <div className="auth-heading">
          <span className="eyebrow">Verified · {maskPhoneNumber(phoneNumber)}</span>
          <h1 id="setup-title">Set up your account</h1>
          <p>This appears on your reports and reconciliation records. You can change any of it later from Profile.</p>
        </div>

        <div className="auth-form">
          <div className="form-field">
            <Label htmlFor="setup-name">Full name</Label>
            <Input
              id="setup-name"
              autoComplete="name"
              placeholder="As printed on your FD or bond certificate"
              value={fullName}
              onChange={(event) => { setFullName(event.target.value); setError(null); }}
            />
          </div>

          <label className="terms-consent">
            <Checkbox checked={acceptedTerms} onCheckedChange={(value) => { setAcceptedTerms(value === true); setError(null); }} />
            <span>I agree to the <a href="/terms" target="_blank">Terms</a> and <a href="/privacy" target="_blank">Privacy Policy</a>. My 7-day free trial starts now.</span>
          </label>

          <div className="form-field">
            <Label htmlFor="setup-email">Email <span className="field-optional">optional</span></Label>
            <Input
              id="setup-email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => { setEmail(event.target.value); setError(null); }}
            />
          </div>

          <div className="form-field">
            <Label htmlFor="setup-pan">PAN <span className="field-optional">optional</span></Label>
            <Input
              id="setup-pan"
              placeholder="ABCDE1234F"
              maxLength={10}
              value={pan}
              onChange={(event) => { setPan(event.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10)); setError(null); }}
            />
            <p className="field-note">Stored masked as ABCDE****F. Used to label TDS reconciliation, never shown in full.</p>
          </div>

          <div className="form-field">
            <Label htmlFor="setup-dob">Date of birth <span className="field-optional">optional</span></Label>
            <Input
              id="setup-dob"
              type="date"
              value={dateOfBirth}
              onChange={(event) => { setDateOfBirth(event.target.value); setError(null); }}
            />
            <p className="field-note">Senior citizens have a higher TDS exemption threshold on interest income.</p>
          </div>

          {error && <p className="auth-error" role="alert">{error}</p>}

          <Button size="lg" className="w-full" disabled={saving || !acceptedTerms} onClick={() => void save()}>
            {saving ? "Saving…" : "Continue to dashboard"}
          </Button>
          <Button variant="outline" className="w-full" disabled={saving} onClick={() => void restoreBackup()}>Restore encrypted backup</Button>
          <p className="auth-provider-note">Use recovery only if you previously had an account and its records are missing.</p>
        </div>

        <div className="auth-security">
          <ShieldCheck aria-hidden="true" />
          <span>These details stay private to your account and are never written to logs.</span>
        </div>
      </section>
    </main>
  );
}
