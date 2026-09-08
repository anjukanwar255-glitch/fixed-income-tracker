import type { NextConfig } from "next";

/**
 * Security headers, previously applied by the Cloudflare Worker wrapper.
 *
 * These live here rather than in middleware on purpose. Firebase's App Hosting
 * adapter documents the Next.js Proxy (middleware) as still having
 * architectural hurdles, and headers this app depends on — the CSP that allows
 * Firebase Auth and Razorpay, and the COOP value that lets the Google sign-in
 * popup work — must not be contingent on that. `headers()` is resolved at build
 * time and served by the platform.
 */
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self' https://api.razorpay.com",
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.google.com https://www.recaptcha.net https://checkout.razorpay.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://*.googleusercontent.com https://*.firebaseapp.com https://*.razorpay.com",
  "connect-src 'self' https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://firebaseinstallations.googleapis.com https://firebaseappcheck.googleapis.com https://firebasestorage.googleapis.com https://www.google.com https://*.googleapis.com https://api.razorpay.com https://*.razorpay.com",
  "frame-src 'self' https://www.google.com https://www.recaptcha.net https://*.firebaseapp.com https://api.razorpay.com https://*.razorpay.com",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "x-content-type-options", value: "nosniff" },
  { key: "referrer-policy", value: "strict-origin-when-cross-origin" },
  { key: "permissions-policy", value: "camera=(), microphone=(), geolocation=(), payment=(self \"https://checkout.razorpay.com\")" },
  { key: "strict-transport-security", value: "max-age=31536000; includeSubDomains" },
  // Google sign-in opens a popup, which a strict same-origin policy blocks.
  { key: "cross-origin-opener-policy", value: "same-origin-allow-popups" },
  { key: "content-security-policy", value: contentSecurityPolicy },
];

/**
 * The app is meant to be reachable only at portfolio.cartranspro.com, but App
 * Hosting also keeps its generated `*.hosted.app` domain serving the same
 * backend and offers no way to switch that off.
 *
 * This matches on `x-forwarded-host`, not the request Host. Behind App
 * Hosting's CDN and Cloud Run, the Host header is always the internal
 * `…run.app` hostname whichever public domain the client used — an earlier
 * attempt matched on Host and consequently redirected every request,
 * including ones to the custom domain, which then redirected to itself in a
 * loop. Confirmed against live request headers:
 *
 *   via portfolio.cartranspro.com → host: …run.app, x-forwarded-host: portfolio.cartranspro.com
 *   via …hosted.app              → host: …run.app, x-forwarded-host: …hosted.app
 *
 * Matching one exact alternate hostname rather than "anything that isn't
 * primary" keeps this fail-safe: a request with no `x-forwarded-host` at all
 * (local development) matches nothing and is served normally. The raw Cloud
 * Run URL needs no rule — it answers 403 to the public, reachable only by the
 * CDN in front of it.
 */
const PRIMARY_HOST = "portfolio.cartranspro.com";
const GENERATED_HOST = "fixed-income-tracker--portfolio-7c0d0.asia-southeast1.hosted.app";

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      {
        source: "/api/:path*",
        headers: [{ key: "cache-control", value: "no-store, max-age=0" }],
      },
    ];
  },
  async redirects() {
    return [
      {
        source: "/:path*",
        has: [{ type: "header" as const, key: "x-forwarded-host", value: GENERATED_HOST }],
        destination: `https://${PRIMARY_HOST}/:path*`,
        permanent: true,
      },
    ];
  },
};

export default nextConfig;
