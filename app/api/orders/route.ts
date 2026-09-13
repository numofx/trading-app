import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";
import { getPostHogClient } from "@/lib/posthog-server";

/** Paging params forwarded to markets-service; anything else on the request is dropped. */
const ORDER_HISTORY_PARAMS = ["limit", "before"] as const;

/**
 * Lists the signed-in wallet's orders in every status (`GET /v1/orders`).
 *
 * The browser signs the login; this only forwards its `X-Numo-Auth` header and the paging params.
 * Never cached on either side — the response is one owner's private history.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = new URLSearchParams();
  for (const key of ORDER_HISTORY_PARAMS) {
    const value = searchParams.get(key);
    if (value) {
      query.set(key, value);
    }
  }

  const auth = request.headers.get("x-numo-auth");
  const queryString = query.toString();
  const response = await fetch(
    `${getMarketsServiceUrl()}/v1/orders${queryString === "" ? "" : `?${queryString}`}`,
    {
      cache: "no-store",
      headers: { accept: "application/json", ...(auth === null ? {} : { "x-numo-auth": auth }) },
    }
  );

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}

export async function POST(request: Request) {
  const payload = await request.json();
  const distinctId: string =
    request.headers.get("x-posthog-distinct-id") ?? payload?.owner_address ?? "anonymous";

  const response = await fetch(`${getMarketsServiceUrl()}/v1/orders`, {
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
    event: "server_order_received",
    properties: {
      asset_address: payload?.asset_address ?? null,
      http_status: response.status,
      order_id: payload?.order_id ?? null,
      order_side: payload?.side ?? null,
      sub_id: payload?.sub_id ?? null,
      success: response.ok,
    },
  });
  await posthog.flush();

  return new NextResponse(responseText, {
    status: response.status,
    headers: {
      "content-type": contentType,
    },
  });
}
