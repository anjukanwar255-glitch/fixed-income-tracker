"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from "firebase/auth";

import { getFirebaseAuth, initializeFirebaseSecurity } from "@/lib/firebase-client";

export type AuthState =
  | { status: "loading"; user: null }
  | { status: "configuration-error"; user: null }
  | { status: "signed-out"; user: null }
  | { status: "signed-in"; user: User };

/**
 * Tracks Firebase session state.
 *
 * The first emission is asynchronous because the SDK restores a persisted
 * session from browser storage, so `loading` must be rendered as its own state
 * rather than assumed to mean signed out.
 */
export function useFirebaseAuth(): AuthState & { signOut: () => Promise<void> } {
  const [state, setState] = useState<AuthState>({ status: "loading", user: null });

  useEffect(() => {
    let cancelled = false;
    let unsubscribe: (() => void) | undefined;

    void initializeFirebaseSecurity()
      .then(() => {
        if (cancelled) return;
        unsubscribe = onAuthStateChanged(getFirebaseAuth(), (user) =>
          setState(user ? { status: "signed-in", user } : { status: "signed-out", user: null }),
        );
      })
      .catch(() => {
        if (!cancelled) setState({ status: "configuration-error", user: null });
      });

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  return { ...state, signOut: () => firebaseSignOut(getFirebaseAuth()) };
}

/** `+919876543210` → `+91 ••••• 43210`. Never send the full value to logs. */
export function maskPhoneNumber(phoneNumber: string | null): string {
  if (!phoneNumber) return "Not linked";
  const digits = phoneNumber.replace(/[^\d+]/g, "");
  if (digits.length < 6) return "••••••";
  return `${digits.slice(0, -10) || "+91"} ••••• ${digits.slice(-5)}`;
}
