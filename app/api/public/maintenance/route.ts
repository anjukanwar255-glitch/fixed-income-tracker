import { readAdminSettings } from "@/lib/admin-settings";

export const dynamic = "force-dynamic";

/**
 * The maintenance notice, readable without signing in.
 *
 * It has to reach someone who cannot get past the sign-in screen, because an
 * outage is exactly when that happens — a notice only logged-in users can see
 * is not a notice.
 *
 * Nothing else administered is exposed here. Prices belong to the billing
 * endpoint, which already serves them.
 */
export async function GET() {
  const { maintenance } = await readAdminSettings();
  return Response.json(maintenance, {
    // Short, so turning it off reaches people quickly, but not zero: every
    // visitor asks for this on every load.
    headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" },
  });
}
