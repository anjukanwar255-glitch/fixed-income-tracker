import { readAdminSettings } from "@/lib/admin-settings";

export const dynamic = "force-dynamic";

/**
 * The administered settings a signed-out visitor may see.
 *
 * The maintenance notice has to reach someone who cannot get past the sign-in
 * screen, because an outage is exactly when that happens — a notice only
 * signed-in users can read is not a notice. The support link travels with it
 * for the same reason: someone who cannot sign in is precisely who needs it.
 *
 * Nothing else administered is exposed. Prices belong to the billing endpoint,
 * which already serves them, and the trial length is applied rather than
 * published.
 */
export async function GET() {
  const { maintenance, supportUrl } = await readAdminSettings();
  return Response.json({ maintenance, supportUrl }, {
    // Short, so turning the notice off reaches people quickly, but not zero:
    // every visitor asks for this on every load.
    headers: { "cache-control": "public, max-age=30, stale-while-revalidate=120" },
  });
}
