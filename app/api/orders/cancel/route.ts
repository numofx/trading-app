import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";
import { getPostHogClient } from "@/lib/posthog-server";

/**
 * Cancels a resting order.
 *
 * markets-service cancels by `(owner_address, nonce)` rather than by order id — the pair the book
 * exposes on every resting order. Proxied like order submission so the browser never needs the
 * service's origin, and so the outcome is recorded server-side.
 */
export async function POST(request: Request) {
  const payload = await request.json();
  const distinctId: string =
    request.headers.get("x-posthog-distinct-id") ?? payload?.owner_address ?? "anonymous";

  const response = await fetch(`${getMarketsServiceUrl()}/v1/orders/cancel`, {
    body: JSON.stringify(payload),
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
  });

  const responseText = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId,
    event: "server_order_cancel_received",
    properties: {
      http_status: response.status,
      nonce: payload?.nonce ?? null,
      ok: response.ok,
    },
  });

  return new NextResponse(responseText, {
    headers: { "content-type": contentType },
    status: response.status,
  });
}
