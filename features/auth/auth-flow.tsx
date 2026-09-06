"use client";

import { useState } from "react";
import { ArrowLeft, Landmark, LockKeyhole, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";

type AuthStep = "mobile" | "otp";

export function AuthFlow() {
  const [step, setStep] = useState<AuthStep>("mobile");
  const [mobile, setMobile] = useState("");
  const [otp, setOtp] = useState("");

  const sendOtp = () => {
    if (!/^\d{10}$/.test(mobile)) {
      toast.error("Enter a valid 10-digit mobile number");
      return;
    }
    setStep("otp");
    toast.success(`OTP requested for ••••••${mobile.slice(-4)}`);
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark"><Landmark aria-hidden="true" /></span>
          <span>Fixed Income Tracker</span>
        </div>

        {step === "otp" && (
          <button className="auth-back" onClick={() => setStep("mobile")}>
            <ArrowLeft aria-hidden="true" /> Change number
          </button>
        )}

        <div className="auth-heading">
          <span className="eyebrow">Protected portfolio</span>
          <h1 id="auth-title">{step === "mobile" ? "Welcome back" : "Verify your mobile"}</h1>
          <p>
            {step === "mobile"
              ? "Use your registered mobile number to securely access your investments."
              : `Enter the 6-digit code sent to +91 ••••••${mobile.slice(-4)}.`}
          </p>
        </div>

        {step === "mobile" ? (
          <div className="auth-form">
            <Label htmlFor="mobile">Mobile number</Label>
            <div className="mobile-field">
              <span>+91</span>
              <Input
                id="mobile"
                inputMode="numeric"
                autoComplete="tel"
                maxLength={10}
                value={mobile}
                onChange={(event) => setMobile(event.target.value.replace(/\D/g, ""))}
                placeholder="98765 43210"
              />
            </div>
            <Button size="lg" className="w-full" onClick={sendOtp}>Get OTP</Button>
          </div>
        ) : (
          <div className="auth-form">
            <Label htmlFor="otp-input">One-time password</Label>
            <InputOTP id="otp-input" maxLength={6} value={otp} onChange={setOtp}>
              <InputOTPGroup className="otp-group">
                {Array.from({ length: 6 }).map((_, index) => (
                  <InputOTPSlot className="otp-slot" index={index} key={index} />
                ))}
              </InputOTPGroup>
            </InputOTP>
            <Button asChild size="lg" className="w-full" disabled={otp.length !== 6}>
              <a href="/signin-with-chatgpt?return_to=%2F" target="_top">Verify securely</a>
            </Button>
            <button className="resend-button" onClick={() => toast.info("A fresh OTP has been requested")}>Resend OTP</button>
          </div>
        )}

        <div className="auth-security">
          <ShieldCheck aria-hidden="true" />
          <span>Your PAN and financial data stay encrypted and isolated to your account.</span>
        </div>
        <div className="auth-footnote"><LockKeyhole aria-hidden="true" /> Secure connection</div>
      </section>
    </main>
  );
}
