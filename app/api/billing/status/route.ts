import { getEntitlement } from "@/lib/billing";
import { plansWithRates, readAdminSettings } from "@/lib/admin-settings";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  const { planRates } = await readAdminSettings();
  return Response.json({ entitlement: await getEntitlement(user.uid), plans: plansWithRates(planRates) });
}
