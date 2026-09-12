import { allSubscriptions, billingEventId, billingEvents, readDoc } from "@/db";
import { razorpayConfig, unixToIso } from "@/lib/billing";
import { oneTimeAccessEnd } from "@/lib/plans";

const PROVIDER = "razorpay";
/** gRPC ALREADY_EXISTS, thrown by `create()` when the document is present. */
const ALREADY_EXISTS = 6;

export const dynamic = "force-dynamic";

type OrderEntity = { id?: string; status?: string; amount?: number };

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

  // The document id carries the uniqueness the old index enforced, so a replay
  // is caught here and, if two deliveries race past this read, again by the
  // `create()` below.
  const recordId = billingEventId(PROVIDER, eventId);
  if (await readDoc(billingEvents().doc(recordId))) {
    return Response.json({ received: true, duplicate: true });
  }

  let payload: {
    event?: string;
    payload?: {
      subscription?: { entity?: SubscriptionEntity };
      order?: { entity?: OrderEntity };
      payment?: { entity?: { order_id?: string; status?: string } };
    };
  };
  try { payload = JSON.parse(raw) as typeof payload; } catch { return new Response("Invalid JSON", { status: 400 }); }
  const entity = payload.payload?.subscription?.entity;
  /*
   * A plan bought outright arrives as an order, not a subscription, and the
   * paid event names the order on the payment rather than on the order itself.
   * Both are the provider's handle on the same purchase, which is why they are
   * looked up through the same field.
   */
  const orderId = payload.payload?.order?.entity?.id ?? payload.payload?.payment?.entity?.order_id ?? null;
  const digest = await sha256(raw);
  const now = new Date().toISOString();

  if (entity?.id) {
    // This request is authenticated by signature alone, so the provider
    // subscription id is the only route back to the owning user. Subscriptions
    // live under their user, which makes this a collection group query and
    // requires the matching index.
    const matches = await allSubscriptions().where("providerSubscriptionId", "==", entity.id).get();
    await Promise.all(matches.docs.map((match) => match.ref.update({
      status: entity.status,
      currentPeriodStart: unixToIso(entity.current_start),
      currentPeriodEnd: unixToIso(entity.current_end),
      cancelAtPeriodEnd: Boolean(entity.cancel_at_cycle_end),
      cancelledAt: entity.status === "cancelled" ? unixToIso(entity.ended_at) ?? now : null,
      updatedAt: now,
    })));
  }

  if (!entity?.id && orderId) {
    const matches = await allSubscriptions().where("providerSubscriptionId", "==", orderId).get();
    await Promise.all(matches.docs.map((match) => {
      const record = match.data();
      const paid = payload.event === "order.paid" || payload.payload?.payment?.entity?.status === "captured";
      if (!paid) return Promise.resolve();
      // The term runs from when it was paid for, not from when the order was
      // opened: someone who left the payment sheet and came back a week later
      // should not lose that week.
      const boughtAt = new Date(now);
      return match.ref.update({
        status: "active",
        currentPeriodStart: now,
        currentPeriodEnd: oneTimeAccessEnd(record.planCode, boughtAt) ?? record.currentPeriodEnd ?? null,
        updatedAt: now,
      });
    }));
  }

  try {
    await billingEvents().doc(recordId).create({
      id: recordId,
      provider: PROVIDER,
      providerEventId: eventId,
      eventType: payload.event ?? "unknown",
      providerSubscriptionId: entity?.id ?? orderId,
      payloadSha256: digest,
      processingStatus: entity?.id || orderId ? "processed" : "ignored",
      processedAt: now,
      createdAt: now,
    });
  } catch (error) {
    if ((error as { code?: number }).code === ALREADY_EXISTS) {
      return Response.json({ received: true, duplicate: true });
    }
    // Let the provider retry. The subscription update above sets absolute
    // values from the entity, so replaying it changes nothing.
    return new Response("Webhook could not be recorded", { status: 503 });
  }
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
