import { recentStaffActions, resolveActor } from "@/lib/staff";
import { authenticatedUser } from "@/lib/firebase-auth";

export const dynamic = "force-dynamic";

/**
 * What staff have been doing.
 *
 * Readable by staff as well as administrators, deliberately: a record everyone
 * can see is one everyone behaves in front of, and hiding it would make it
 * look like something to be afraid of rather than the ordinary trail it is.
 */
export async function GET(request: Request) {
  const identity = await authenticatedUser();
  const actor = identity ? await resolveActor(identity.uid) : null;
  if (!actor) return Response.json({ error: "Not permitted" }, { status: 403 });

  const limit = Number(new URL(request.url).searchParams.get("limit") ?? 100) || 100;
  return Response.json({ actions: await recentStaffActions(limit) }, {
    headers: { "cache-control": "no-store" },
  });
}
