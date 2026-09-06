import { env } from "cloudflare:workers";

export const dynamic = "force-dynamic";

/** Public browser configuration. The Enterprise site key identifies the site;
 * authorization still comes from Firebase Authentication and App Check tokens. */
export async function GET() {
  const siteKey = env.FIREBASE_APPCHECK_SITE_KEY?.trim();
  if (!siteKey) {
    return Response.json({ error: "App security is not configured" }, {
      status: 503,
      headers: { "cache-control": "no-store" },
    });
  }

  return Response.json({ appCheck: { provider: "recaptcha-enterprise", siteKey } }, {
    headers: {
      "cache-control": "public, max-age=300, stale-while-revalidate=300",
      "x-content-type-options": "nosniff",
    },
  });
}
