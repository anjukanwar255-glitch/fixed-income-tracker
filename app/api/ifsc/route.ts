import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Resolves an IFSC to the branch it belongs to.
 *
 * An eleven-character code is not something anyone can check by eye, and a
 * wrong one is only discovered when a payout fails to arrive. Naming the bank
 * and branch back turns it into something the investor can confirm.
 *
 * The lookup runs here rather than in the browser so the directory is reached
 * from the server, and only ever with the code itself — nothing about the
 * account or its holder is sent.
 */
const DIRECTORY = "https://ifsc.razorpay.com";
const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;

type Branch = { BANK?: unknown; BRANCH?: unknown; CITY?: unknown };

export async function GET(request: Request) {
  const identity = await authenticatedUser();
  if (!identity) return Response.json({ error: "Authentication required" }, { status: 401 });

  const limited = await rateLimit(request, "ifsc-lookup", identity.uid, 60, 60 * 60 * 1000);
  if (limited) return limited;

  const code = (new URL(request.url).searchParams.get("code") ?? "").trim().toUpperCase();
  if (!IFSC_PATTERN.test(code)) {
    return Response.json({ error: "Enter a valid IFSC code" }, { status: 400 });
  }

  try {
    const response = await fetch(`${DIRECTORY}/${code}`, {
      signal: AbortSignal.timeout(5000),
      headers: { accept: "application/json" },
    });
    if (!response.ok) return Response.json({ error: "No branch found for this IFSC" }, { status: 404 });

    const branch = await response.json() as Branch;
    const field = (value: unknown) => typeof value === "string" && value.trim() ? value.trim().slice(0, 120) : null;
    const bank = field(branch.BANK);
    if (!bank) return Response.json({ error: "No branch found for this IFSC" }, { status: 404 });

    return Response.json(
      { bank, branch: field(branch.BRANCH), city: field(branch.CITY) },
      // The directory changes rarely and the answer is not specific to the
      // caller, so a resolved code is worth holding on to.
      { headers: { "cache-control": "private, max-age=86400" } },
    );
  } catch {
    return Response.json({ error: "The IFSC directory is unavailable" }, { status: 503 });
  }
}
