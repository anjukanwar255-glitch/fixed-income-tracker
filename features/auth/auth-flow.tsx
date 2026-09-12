"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, Landmark, LockKeyhole, LogIn, ShieldCheck } from "lucide-react";
import { GoogleAuthProvider, RecaptchaVerifier, signInWithPhoneNumber, signInWithPopup, type ConfirmationResult } from "firebase/auth";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { Label } from "@/components/ui/label";
import { RecaptchaBlockedDialog } from "@/features/auth/recaptcha-blocked-dialog";
import { getFirebaseAuth, isRecaptchaReachable } from "@/lib/firebase-client";

/**
 * Firebase rate-limits a device that requests codes too often, and recovering
 * from that takes far longer than waiting between requests does. Two minutes
 * keeps well clear of it.
 */
const RESEND_SECONDS = 120;
/**
 * How long the UI holds the button after Firebase reports a rate limit. Firebase
 * does not say how long its own block lasts, so this is a courtesy pause rather
 * than a countdown to the real limit — if the block is still in force, the next
 * attempt simply re-arms it.
 */
const RATE_LIMIT_SECONDS = 120;
const OTP_LENGTH = 6;

function formatCooldown(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** Firebase error codes surfaced to the user in plain language. */
const errorMessages: Record<string, string> = {
  "auth/invalid-phone-number": "That mobile number doesn't look right. Check and try again.",
  "auth/missing-phone-number": "Enter your 10-digit mobile number.",
  "auth/quota-exceeded": "Too many codes requested right now. Try again shortly.",
  "auth/too-many-requests": "Too many attempts from this device. Sign-in is paused for a short while — the button below unlocks when you can try again.",
  "auth/invalid-verification-code": "That code is incorrect. Check the SMS and try again.",
  "auth/code-expired": "That code has expired. Request a new one.",
  "auth/network-request-failed": "Network problem. Check your connection and try again.",
  // Raised when this origin is missing from Firebase's authorized domains, which
  // is also how a misconfigured reCAPTCHA usually surfaces.
  "auth/unauthorized-domain": "Sign-in is not available from this address yet. Please use the main app address, or write to us if this is the only one you have.",
  // The reCAPTCHA answer was rejected or had already been spent. The tick box
  // resets itself alongside this message so the next attempt starts clean.
  "auth/invalid-app-credential": "The security check didn't go through. Tick the box again, then request the code.",
  "auth/captcha-check-failed": "The security check didn't go through. Tick the box again, then request the code.",
  // Firebase reuses this code for two very different causes: the phone provider
  // being off, and the SMS region policy excluding the number's country.
  "auth/operation-not-allowed": "Phone sign-in is unavailable. Check that the Phone provider is enabled and that the SMS region policy allows India (+91).",
  "auth/billing-not-enabled": "Sign-in by mobile is temporarily unavailable. Please try again shortly.",
  "auth/internal-error": "The sign-in request was refused. Reload the page and try once more.",
};

function errorCode(error: unknown): string {
  return typeof error === "object" && error && "code" in error ? String(error.code) : "";
}

/**
 * DIAGNOSTIC — remove once phone sign-in is confirmed working.
 *
 * The SDK collapses several distinct Identity Toolkit failures into one code, so
 * the reason Google actually gave is lost. This records the raw error body of
 * the underlying request for the duration of one call.
 */
/** Codes that mean the reCAPTCHA answer never reached Firebase intact. */
const CAPTCHA_FAILURE_CODES = new Set(["auth/invalid-app-credential", "auth/captcha-check-failed", "auth/internal-error"]);

function describeError(error: unknown): string {
  const code = errorCode(error);
  const message = typeof error === "object" && error && "message" in error ? String(error.message) : "";
  // Firebase's own message carries the detail a code cannot — several causes
  // share one code — so it is kept rather than discarded.
  // The code and message only; never the phone number, which stays out of logs.
  console.error("Phone sign-in failed:", code || error, message);

  // DIAGNOSTIC — drop this block along with withIdentityToolkitCapture.
  const detail = typeof error === "object" && error && "identityToolkitDetail" in error
    ? String((error as { identityToolkitDetail?: string }).identityToolkitDetail ?? "")
    : "";
  if (detail) return `${code || "error"} — ${detail}`;

  const known = errorMessages[code];
  if (known) return known;

  // Nothing is mapped for this failure, so the user has no action to take from a
  // polite summary. Showing the raw detail at least makes the problem reportable.
  return `Sign-in failed${code ? ` (${code})` : ""}. ${message || "No further detail was reported."}`;
}

export function AuthFlow() {
  const [step, setStep] = useState<"phone" | "otp">("phone");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [blockedOpen, setBlockedOpen] = useState(false);
  /** True once the investor has ticked "I'm not a robot" and it has not expired. */
  const [captchaSolved, setCaptchaSolved] = useState(false);
  const [captchaReady, setCaptchaReady] = useState(false);
  const confirmationRef = useRef<ConfirmationResult | null>(null);
  const verifierRef = useRef<RecaptchaVerifier | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  /**
   * Renders the visible reCAPTCHA tick box.
   *
   * The visible widget is used rather than the invisible one on purpose: the
   * invisible variant decides silently from a risk score, so a rejection leaves
   * the investor with nothing to act on. Here they can always complete the
   * challenge themselves.
   *
   * A solved answer is spent by one request, and grecaptcha refuses to render
   * twice into the same element, so each mount tears the previous widget down
   * and empties the container first.
   */
  const mountRecaptcha = useCallback(async () => {
    const slot = slotRef.current;
    if (!slot) return;

    verifierRef.current?.clear();
    verifierRef.current = null;
    slot.replaceChildren();
    setCaptchaSolved(false);
    setCaptchaReady(false);

    try {
      const verifier = new RecaptchaVerifier(getFirebaseAuth(), slot, {
        size: "normal",
        callback: () => setCaptchaSolved(true),
        "expired-callback": () => setCaptchaSolved(false),
      });
      verifierRef.current = verifier;
      await verifier.render();
      setCaptchaReady(true);
    } catch (renderError) {
      console.error("reCAPTCHA could not be rendered:", renderError);
      setError("The security check couldn't load. Reload the page and try again.");
    }
  }, []);

  /**
   * Whether a request is currently held back. A solved reCAPTCHA answer expires
   * in about two minutes — well inside a rate-limit hold — so the challenge is
   * withheld until the wait is over rather than letting someone solve one that
   * is guaranteed to be stale by the time the button unlocks.
   */
  const waiting = cooldown > 0;

  // Keyed on the step because the slot only exists on the phone screen; mounting
  // from an event handler would run before React had rendered the element back.
  useEffect(() => {
    if (step !== "phone" || waiting) return;
    const timer = window.setTimeout(() => void mountRecaptcha(), 0);
    return () => {
      window.clearTimeout(timer);
      verifierRef.current?.clear();
      verifierRef.current = null;
    };
  }, [step, waiting, mountRecaptcha]);

  const sendCode = async () => {
    if (!/^[6-9]\d{9}$/.test(phone)) {
      setError("Enter a valid 10-digit Indian mobile number.");
      return;
    }
    if (!verifierRef.current || !captchaSolved) {
      setError("Tick “I'm not a robot” before requesting the code.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const auth = getFirebaseAuth();
      auth.useDeviceLanguage();
      confirmationRef.current = await signInWithPhoneNumber(auth, `+91${phone}`, verifierRef.current!);
      setStep("otp");
      setCode("");
      setCooldown(RESEND_SECONDS);
    } catch (sendError) {
      setError(describeError(sendError));
      const failureCode = errorCode(sendError);
      // Hold the button once Firebase reports a rate limit; retrying straight
      // away only extends the block.
      if (failureCode === "auth/too-many-requests") setCooldown(RATE_LIMIT_SECONDS);
      // A captcha failure has several possible causes, so the blocked-browser
      // dialog only opens once a probe confirms reCAPTCHA is actually
      // unreachable. Guessing would nag people whose setup is fine.
      if (CAPTCHA_FAILURE_CODES.has(failureCode) && !(await isRecaptchaReachable())) {
        setBlockedOpen(true);
      }
      // The answer is spent either way, so present a fresh challenge.
      void mountRecaptcha();
    } finally {
      setBusy(false);
    }
  };

  const signInWithGoogle = async () => {
    setBusy(true);
    setError(null);
    try {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: "select_account" });
      await signInWithPopup(getFirebaseAuth(), provider);
    } catch (signInError) {
      const code = errorCode(signInError);
      setError(code === "auth/operation-not-allowed"
        ? "Google sign-in is not available yet. Please use your mobile number."
        : code === "auth/popup-closed-by-user"
          ? "Google sign-in was closed before completion."
          : describeError(signInError));
      setBusy(false);
    }
  };

  /** On success the session listener in the app shell swaps in the portfolio. */
  const verifyCode = async (value: string) => {
    if (!confirmationRef.current || value.length !== OTP_LENGTH) return;
    setBusy(true);
    setError(null);
    try {
      await confirmationRef.current.confirm(value);
    } catch (verifyError) {
      setError(describeError(verifyError));
      setCode("");
      setBusy(false);
    }
  };

  /** Returning to the phone screen remounts the challenge through the effect. */
  const editNumber = () => {
    setStep("phone");
    setCode("");
    setError(null);
  };

  return (
    <main className="auth-shell">
      <section className="auth-card" aria-labelledby="auth-title">
        <div className="auth-brand">
          <span className="brand-mark"><Landmark aria-hidden="true" /></span>
          <span>Portfolio</span>
        </div>

        {step === "phone" ? (
          <>
            <div className="auth-heading">
              <span className="eyebrow">Protected portfolio</span>
              <h1 id="auth-title">Sign in with your mobile number</h1>
              <p>We&apos;ll send a one-time code to verify it&apos;s you. Only your own FD, bond, payout and TDS records are visible.</p>
            </div>

            <div className="auth-form">
              <Label htmlFor="phone-number">Mobile number</Label>
              <div className="phone-input-row">
                <span className="phone-prefix">+91</span>
                <Input
                  id="phone-number"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder="98765 43210"
                  maxLength={10}
                  value={phone}
                  onChange={(event) => { setPhone(event.target.value.replace(/\D/g, "").slice(0, 10)); setError(null); }}
                />
              </div>

              {/* grecaptcha owns everything inside this element. It is rendered
                  with no React children so reconciliation never touches it. */}
              <div className="recaptcha-slot" ref={slotRef} hidden={waiting} />
              {waiting && (
                <p className="captcha-waiting">
                  The security check will appear when the timer ends, so the one you complete is still valid.
                </p>
              )}

              {error && <p className="auth-error" role="alert">{error}</p>}

              <Button
                size="lg"
                className="w-full"
                disabled={busy || phone.length !== 10 || !captchaSolved || cooldown > 0}
                onClick={() => void sendCode()}
              >
                {busy
                  ? "Sending code…"
                  : cooldown > 0
                    ? `Try again in ${formatCooldown(cooldown)}`
                    : captchaSolved || !captchaReady
                      ? "Send OTP"
                      : "Tick the box above to continue"}
              </Button>
              <div className="auth-divider"><span>or</span></div>
              <Button size="lg" variant="outline" className="w-full" disabled={busy} onClick={() => void signInWithGoogle()}><LogIn /> Continue with Google</Button>
              <p className="auth-provider-note">Standard SMS charges may apply. The code is valid for a few minutes.</p>
            </div>
          </>
        ) : (
          <>
            <div className="auth-heading">
              <span className="eyebrow">Verify</span>
              <h1 id="auth-title">Enter the 6-digit code</h1>
              <p>Sent to <b>+91 {phone.slice(0, 5)} {phone.slice(5)}</b>.</p>
              <button className="link-button" onClick={editNumber}><ArrowLeft aria-hidden="true" /> Change number</button>
            </div>

            <div className="auth-form">
              <InputOTP
                maxLength={OTP_LENGTH}
                value={code}
                disabled={busy}
                onChange={(value) => { setCode(value); setError(null); if (value.length === OTP_LENGTH) void verifyCode(value); }}
                containerClassName="otp-group"
                aria-label="One-time code"
              >
                <InputOTPGroup className="otp-group">
                  {Array.from({ length: OTP_LENGTH }, (_, index) => (
                    <InputOTPSlot className="otp-slot" index={index} key={index} />
                  ))}
                </InputOTPGroup>
              </InputOTP>
              {error && <p className="auth-error" role="alert">{error}</p>}
              <Button size="lg" className="w-full" disabled={busy || code.length !== OTP_LENGTH} onClick={() => void verifyCode(code)}>
                {busy ? "Verifying…" : "Verify and continue"}
              </Button>
              <Button variant="ghost" disabled={busy || cooldown > 0} onClick={editNumber}>
                {cooldown > 0 ? `Request a new code in ${formatCooldown(cooldown)}` : "Request a new code"}
              </Button>
            </div>
          </>
        )}

        <div className="auth-security">
          <ShieldCheck aria-hidden="true" />
          <span>Your records are isolated by verified mobile number and stored in the private cloud database.</span>
        </div>
        <div className="auth-footnote"><LockKeyhole aria-hidden="true" /> Secure connection</div>
      </section>

      <RecaptchaBlockedDialog
        open={blockedOpen}
        onOpenChange={setBlockedOpen}
        onRetry={() => { setBlockedOpen(false); setError(null); void mountRecaptcha(); }}
      />
    </main>
  );
}
