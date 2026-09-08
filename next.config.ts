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
};

export default nextConfig;
