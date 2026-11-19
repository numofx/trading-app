import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";
import { getPostHogClient } from "@/lib/posthog-server";

/** Relayed calls wait on the executor's receipt (30s): above markets-service's 45s executor timeout. */
export const maxDuration = 60;

/**
 * Relays a BookCustodian call (`POST /custodian`): a take signed by the trading key, or a withdrawal, exit, key
 * change, permit deposit or account opening signed by the wallet. Forwarded unchanged; the contract checks every
 * signature. Never cached: the response is one trader's transaction.
 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as {
    call?: string;
    account_id?: string;
    take?: { account_id?: string };
    wallet?: string;
  } | null;
  if (payload === null) {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { headers: { "cache-control": "no-store" }, status: 400 }
    );
  }

  const response = await fetch(`${getMarketsServiceUrl()}/custodian`, {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
  });
  const responseText = await response.text();

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId: request.headers.get("x-posthog-distinct-id") ?? payload.wallet ?? "anonymous",
    event: "server_custodian_call_received",
    properties: {
      account_id: payload.account_id ?? payload.take?.account_id ?? null,
      call: payload.call ?? null,
      http_status: response.status,
      ok: response.ok,
    },
  });
  await posthog.flush();

  return new NextResponse(responseText, {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
