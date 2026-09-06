import { getEntitlement, subscriptionPlans } from "@/lib/billing";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await authenticatedUser();
  if (!user) return Response.json({ error: "Authentication required" }, { status: 401 });
  return Response.json({ entitlement: await getEntitlement(user.uid), plans: subscriptionPlans });
}
