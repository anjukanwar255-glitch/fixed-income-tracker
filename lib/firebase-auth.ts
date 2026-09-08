import { headers } from "next/headers";

import { FIREBASE_PROJECT_ID } from "@/lib/firebase-config";

/**
 * Firebase ID token verification.
 *
 * This was written because `firebase-admin` could not run on Cloudflare
 * Workers. The Admin SDK is available now that the app runs on Node, and
 * `verifyIdToken` would be the idiomatic call, but this implementation is
 * kept deliberately: it is already covered by tests, and swapping the code
 * path that authenticates every request is a change worth making on its own
 * rather than inside a platform migration. Tokens are verified directly
 * against Google's published signing keys:
 *   - RS256 signature checked with WebCrypto
 *   - issuer, audience, subject and lifetime checked per Firebase's contract
 *
 * Only Google's *public* keys are used, so this project holds no service
 * account credential.
 */

const JWKS_URL =
  "https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com";
const ISSUER = `https://securetoken.google.com/${FIREBASE_PROJECT_ID}`;
/** Tolerance for small clock differences between Google and the edge runtime. */
const CLOCK_SKEW_SECONDS = 60;

export type FirebaseUser = {
  /** Firebase `uid`. Stable per user; used as the record ownership key. */
  uid: string;
  /** E.164 number for phone sign-in, e.g. `+919876543210`. */
  phoneNumber: string | null;
  email: string | null;
  /** Unix timestamp of the interactive sign-in, used for sensitive actions. */
  authTime: number | null;
};

export type AuthenticatedRequest = FirebaseUser & { token: string; appCheckToken: string | null };

type SigningKeys = Map<string, CryptoKey>;

let cachedKeys: SigningKeys | null = null;
let cacheExpiresAt = 0;

/**
 * Google rotates these keys roughly daily and advertises the lifetime through
 * `cache-control`. The cache lives per isolate; a miss simply refetches.
 */
async function getSigningKeys(): Promise<SigningKeys> {
  if (cachedKeys && Date.now() < cacheExpiresAt) return cachedKeys;

  const response = await fetch(JWKS_URL);
  if (!response.ok) throw new Error("Firebase signing keys are unavailable");

  const { keys } = (await response.json()) as {
    keys: Array<JsonWebKey & { kid: string }>;
  };

  const imported: SigningKeys = new Map();
  for (const key of keys) {
    if (!key.kid || key.kty !== "RSA") continue;
    imported.set(
      key.kid,
      await crypto.subtle.importKey(
        "jwk",
        { kty: key.kty, n: key.n, e: key.e, alg: "RS256", ext: true },
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["verify"],
      ),
    );
  }

  const maxAge = /max-age=(\d+)/.exec(response.headers.get("cache-control") ?? "");
  cachedKeys = imported;
  cacheExpiresAt = Date.now() + (maxAge ? Number(maxAge[1]) : 3600) * 1000;
  return imported;
}

function decodeBase64Url(value: string): ArrayBuffer {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, "="));
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return buffer;
}

function decodeJsonSegment<T>(segment: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(decodeBase64Url(segment))) as T;
  } catch {
    return null;
  }
}

/**
 * Returns the authenticated user, or `null` when the token is missing, expired,
 * malformed, or not issued by this Firebase project. Never throws for an invalid
 * token — only for an infrastructure failure fetching Google's keys.
 */
export async function verifyFirebaseToken(token: string): Promise<FirebaseUser | null> {
  const segments = token.split(".");
  if (segments.length !== 3) return null;

  const [headerSegment, payloadSegment, signatureSegment] = segments;
  const header = decodeJsonSegment<{ alg: string; kid: string }>(headerSegment);
  if (header?.alg !== "RS256" || !header.kid) return null;

  const key = (await getSigningKeys()).get(header.kid);
  if (!key) return null;

  const verified = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    decodeBase64Url(signatureSegment),
    new TextEncoder().encode(`${headerSegment}.${payloadSegment}`),
  );
  if (!verified) return null;

  const claims = decodeJsonSegment<{
    iss: string;
    aud: string;
    sub: string;
    exp: number;
    iat: number;
    auth_time?: number;
    phone_number?: string;
    email?: string;
  }>(payloadSegment);
  if (!claims) return null;

  const now = Math.floor(Date.now() / 1000);
  if (claims.iss !== ISSUER) return null;
  if (claims.aud !== FIREBASE_PROJECT_ID) return null;
  if (typeof claims.sub !== "string" || !claims.sub) return null;
  if (claims.exp <= now - CLOCK_SKEW_SECONDS) return null;
  if (claims.iat > now + CLOCK_SKEW_SECONDS) return null;
  if (claims.auth_time !== undefined && claims.auth_time > now + CLOCK_SKEW_SECONDS) return null;

  return {
    uid: claims.sub,
    phoneNumber: claims.phone_number ?? null,
    email: claims.email ?? null,
    authTime: claims.auth_time ?? null,
  };
}

/**
 * Resolves the owner of the current request from its `Authorization` header.
 * Every API route derives its ownership key through this function so that a
 * caller can never select which records it reads or writes.
 */
export async function authenticatedUser(): Promise<FirebaseUser | null> {
  const request = await authenticatedRequest();
  if (!request) return null;
  return { uid: request.uid, phoneNumber: request.phoneNumber, email: request.email, authTime: request.authTime };
}

/** Returns the verified identity together with the original token for calls to Firebase services. */
export async function authenticatedRequest(): Promise<AuthenticatedRequest | null> {
  const requestHeaders = await headers();
  const authorization = requestHeaders.get("authorization");
  if (!authorization?.toLowerCase().startsWith("bearer ")) return null;

  const token = authorization.slice(7).trim();
  if (!token) return null;

  try {
    const user = await verifyFirebaseToken(token);
    return user ? { ...user, token, appCheckToken: requestHeaders.get("x-firebase-appcheck") } : null;
  } catch {
    return null;
  }
}

export function hasRecentAuthentication(user: FirebaseUser, maxAgeSeconds = 10 * 60) {
  return user.authTime !== null && Math.floor(Date.now() / 1000) - user.authTime <= maxAgeSeconds;
}
