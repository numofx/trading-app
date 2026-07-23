import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";
import { getPostHogClient } from "@/lib/posthog-server";

export async function POST(request: Request) {
  const payload = await request.json();
  const distinctId: string = request.headers.get("x-posthog-distinct-id") ?? payload?.owner_address ?? "anonymous";

  const response = await fetch(`${getMarketsServiceUrl()}/v1/orders`, {
    body: JSON.stringify(payload),
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    method: "POST",
  });

  const responseText = await response.text();
  const contentType = response.headers.get("content-type") ?? "application/json";

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId,
    event: "server_order_received",
    properties: {
      order_side: payload?.side ?? null,
      asset_address: payload?.asset_address ?? null,
      sub_id: payload?.sub_id ?? null,
      order_id: payload?.order_id ?? null,
      http_status: response.status,
      success: response.ok,
    },
  });
  await posthog.flush();

  return new NextResponse(responseText, {
    headers: {
      "content-type": contentType,
    },
    status: response.status,
  });
}
