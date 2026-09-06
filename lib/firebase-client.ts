"use client";

import { getApp, getApps, initializeApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getToken, initializeAppCheck, ReCaptchaEnterpriseProvider, type AppCheck } from "firebase/app-check";

import { firebaseConfig } from "@/lib/firebase-config";

/**
 * Browser-side Firebase handle. Initialised lazily and reused, because React
 * strict mode and fast refresh both re-run module consumers.
 */
export function getFirebaseAuth(): Auth {
  return getAuth(getApps().length ? getApp() : initializeApp(firebaseConfig));
}

let appCheck: AppCheck | null = null;
let appCheckPromise: Promise<AppCheck> | null = null;

/**
 * Initializes App Check before Authentication starts making network requests.
 *
 * The Enterprise site key is public, but it is read from the hosting runtime so
 * production key rotation does not require baking a credential into the client
 * bundle. The promise is shared because React strict mode mounts effects twice.
 */
export function initializeFirebaseSecurity(): Promise<AppCheck> {
  if (appCheck) return Promise.resolve(appCheck);
  if (!appCheckPromise) {
    appCheckPromise = fetch("/api/public/firebase-config", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("App security is not configured");
        const payload = await response.json() as { appCheck?: { provider?: string; siteKey?: string } };
        const siteKey = payload.appCheck?.siteKey?.trim();
        if (payload.appCheck?.provider !== "recaptcha-enterprise" || !siteKey) {
          throw new Error("App security configuration is invalid");
        }

        const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
        appCheck = initializeAppCheck(app, {
          provider: new ReCaptchaEnterpriseProvider(siteKey),
          isTokenAutoRefreshEnabled: true,
        });
        return appCheck;
      })
      .catch((error) => {
        appCheckPromise = null;
        throw error;
      });
  }
  return appCheckPromise;
}

/**
 * Calls an authenticated API route with the current user's ID token.
 *
 * `getIdToken()` refreshes the token automatically when it is close to expiry,
 * so routes always receive a token the server can verify. Only the
 * `authorization` header is set — a `FormData` body keeps the boundary
 * `content-type` the browser generates for it.
 */
export async function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const check = await initializeFirebaseSecurity();
  const user = getFirebaseAuth().currentUser;
  if (!user) throw new Error("Your session has ended. Sign in again to continue.");

  const requestHeaders = new Headers(init.headers);
  requestHeaders.set("authorization", `Bearer ${await user.getIdToken()}`);
  requestHeaders.set("x-firebase-appcheck", (await getToken(check)).token);
  return fetch(path, { ...init, headers: requestHeaders });
}

/**
 * Reports whether the browser can reach Google's reCAPTCHA, which phone sign-in
 * depends on. Ad blockers and privacy extensions block that host, and the only
 * symptom Firebase then gives is a generic invalid-credential error.
 *
 * `no-cors` makes the response opaque — the body is unreadable and the status is
 * always 0 — so a resolved promise only proves the request left the browser.
 * That is exactly the signal wanted here. Some blockers answer with an empty
 * success instead of failing, so a `false` is strong evidence of a block while a
 * `true` is not proof of the opposite.
 */
export async function isRecaptchaReachable(): Promise<boolean> {
  try {
    await fetch("https://www.google.com/recaptcha/api.js", { mode: "no-cors", cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

/**
 * Downloads a private document.
 *
 * A plain `<a href>` cannot carry the bearer token, so the bytes are fetched
 * with credentials attached and handed to the browser as an object URL.
 */
export async function downloadDocument(documentId: string, fileName: string): Promise<void> {
  const response = await apiFetch(`/api/documents/download/${documentId}`);
  if (!response.ok) throw new Error("Document could not be downloaded");

  const objectUrl = URL.createObjectURL(await response.blob());
  try {
    const link = document.createElement("a");
    link.href = objectUrl;
    link.download = fileName;
    link.click();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
