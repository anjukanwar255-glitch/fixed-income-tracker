import { authenticatedUser } from "@/lib/firebase-auth";
import { rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * The logo for an issuer, fetched from the site its own paperwork names.
 *
 * The domain is never guessed from the company name. A guess resolves to
 * whichever company happens to own that address, and a holding wearing the
 * wrong company's logo is worse than one wearing none — so this only ever
 * loads a site the documents or the investor supplied.
 *
 * Fetched here rather than in the browser, so the icon service is never told
 * which of our pages a person is on, and the response is cached hard: a
 * company's logo does not change between one screen and the next.
 */
const ICON_SERVICE = "https://www.google.com/s2/favicons";
const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/;
const MAX_BYTES = 512 * 1024;

/** Anything that is not a plain public hostname is refused before it is fetched. */
function safeDomain(raw: string) {
  let host = raw.trim().toLowerCase();
  if (!host) return null;
  if (host.includes("/") || host.includes("@")) {
    try {
      host = new URL(host.startsWith("http") ? host : `https://${host}`).hostname;
    } catch {
      return null;
    }
  }
  host = host.replace(/^www\./, "");
  if (!DOMAIN_PATTERN.test(host) || host.length > 253) return null;
  // No internal names: this fetch runs on our own network.
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return null;
  return host;
}

export async function GET(request: Request) {
  const identity = await authenticatedUser();
  if (!identity) return new Response("Authentication required", { status: 401 });

  const limited = await rateLimit(request, "issuer-logo", identity.uid, 300, 60 * 60 * 1000);
  if (limited) return limited;

  const domain = safeDomain(new URL(request.url).searchParams.get("domain") ?? "");
  if (!domain) return new Response("A valid domain is required", { status: 400 });

  try {
    const response = await fetch(`${ICON_SERVICE}?domain=${encodeURIComponent(domain)}&sz=128`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return new Response("No logo found", { status: 404 });

    const bytes = await response.arrayBuffer();
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
      return new Response("No logo found", { status: 404 });
    }

    return new Response(bytes, {
      headers: {
        "content-type": response.headers.get("content-type") ?? "image/png",
        // A day in the browser, a month at the edge. The page falls back to the
        // issuer's initials the moment this is slow or missing, so a stale
        // logo costs nothing and a re-fetch on every row costs a lot.
        "cache-control": "private, max-age=86400, stale-while-revalidate=2592000",
      },
    });
  } catch {
    return new Response("Logo lookup failed", { status: 503 });
  }
}
