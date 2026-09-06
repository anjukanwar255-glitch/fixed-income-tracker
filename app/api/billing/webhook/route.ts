import { eq } from "drizzle-orm";

import { getDb } from "@/db";
import { billingEvents, subscriptions } from "@/db/schema";
import { razorpayConfig, unixToIso } from "@/lib/billing";

export const dynamic = "force-dynamic";

type SubscriptionEntity = {
  id: string;
  status: string;
  current_start?: number;
  current_end?: number;
  ended_at?: number;
  cancel_at_cycle_end?: boolean;
};

export async function POST(request: Request) {
  const signature = request.headers.get("x-razorpay-signature") ?? "";
  const eventId = request.headers.get("x-razorpay-event-id") ?? "";
  const raw = await request.text();
  let secret: string;
  try { secret = razorpayConfig().webhookSecret; } catch { return new Response("Billing not configured", { status: 503 }); }
  if (!signature || !eventId || !(await verifyHmac(raw, signature, secret))) {
    return new Response("Invalid signature", { status: 401 });
  }

  const db = getDb();
  const [alreadyProcessed] = await db.select({ id: billingEvents.id }).from(billingEvents)
    .where(eq(billingEvents.providerEventId, eventId)).limit(1);
  if (alreadyProcessed) return Response.json({ received: true, duplicate: true });

  let payload: { event?: string; payload?: { subscription?: { entity?: SubscriptionEntity } } };
  try { payload = JSON.parse(raw) as typeof payload; } catch { return new Response("Invalid JSON", { status: 400 }); }
  const entity = payload.payload?.subscription?.entity;
  const digest = await sha256(raw);
  const now = new Date().toISOString();

  if (entity?.id) {
    await db.update(subscriptions).set({
      status: entity.status,
      currentPeriodStart: unixToIso(entity.current_start),
      currentPeriodEnd: unixToIso(entity.current_end),
      cancelAtPeriodEnd: Boolean(entity.cancel_at_cycle_end),
      cancelledAt: entity.status === "cancelled" ? unixToIso(entity.ended_at) ?? now : null,
      updatedAt: now,
    }).where(eq(subscriptions.providerSubscriptionId, entity.id));
  }
  await db.insert(billingEvents).values({
    id: crypto.randomUUID(),
    providerEventId: eventId,
    eventType: payload.event ?? "unknown",
    providerSubscriptionId: entity?.id ?? null,
    payloadSha256: digest,
    processingStatus: entity?.id ? "processed" : "ignored",
    processedAt: now,
    createdAt: now,
  });
  return Response.json({ received: true });
}

async function verifyHmac(message: string, receivedHex: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const received = hexToBytes(receivedHex);
  if (!received) return false;
  return crypto.subtle.verify("HMAC", key, received, new TextEncoder().encode(message));
}

function hexToBytes(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value)) return null;
  return new Uint8Array(value.match(/.{2}/g)!.map((part) => Number.parseInt(part, 16)));
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
