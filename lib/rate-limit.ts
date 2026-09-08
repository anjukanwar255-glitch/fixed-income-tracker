type Bucket = { count: number; resetsAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Per-instance abuse protection. Cloud Armor rate-limit/WAF rules should be
 * the outer production layer; this still stops accidental request storms in a
 * warm instance without persisting phone numbers or IP addresses.
 */
export async function rateLimit(
  request: Request,
  scope: string,
  subject: string,
  limit: number,
  windowMs: number,
) {
  const now = Date.now();
  const source = `${scope}:${subject}:${request.headers.get("cf-connecting-ip") ?? "unknown"}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(source));
  const key = [...new Uint8Array(digest).slice(0, 12)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const current = buckets.get(key);
  const bucket = !current || current.resetsAt <= now ? { count: 0, resetsAt: now + windowMs } : current;
  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > 2_000) {
    for (const [candidate, value] of buckets) if (value.resetsAt <= now) buckets.delete(candidate);
  }

  if (bucket.count <= limit) return null;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetsAt - now) / 1000));
  return Response.json(
    { error: "Too many requests. Please wait and try again.", code: "RATE_LIMITED" },
    { status: 429, headers: { "retry-after": String(retryAfter) } },
  );
}
