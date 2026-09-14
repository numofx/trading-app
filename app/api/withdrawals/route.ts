import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";
import { getPostHogClient } from "@/lib/posthog-server";

/**
 * A withdrawal outlasts the default function limit: markets-service waits on the executor, which waits up to
 * 30s for the receipt. Set above markets-service's 45s EXECUTOR_WITHDRAW_TIMEOUT so the answer is the venue's,
 * not a platform timeout that would leave the outcome unknown.
 */
export const maxDuration = 60;

/**
 * Submits a signed withdrawal (`POST /v1/withdrawals`).
 *
 * The browser signs the WithdrawalModule action; this forwards it unchanged. markets-service verifies the
 * signature and the account's recorded owner before the venue's executor submits it. Never cached: the response
 * is one trader's transaction.
 */
export async function POST(request: Request) {
  const payload = (await request.json().catch(() => null)) as {
    action?: { owner?: string; subaccount_id?: string };
  } | null;
  if (payload === null) {
    return NextResponse.json(
      { error: "invalid JSON body" },
      { headers: { "cache-control": "no-store" }, status: 400 }
    );
  }

  const response = await fetch(`${getMarketsServiceUrl()}/v1/withdrawals`, {
    body: JSON.stringify(payload),
    cache: "no-store",
    headers: { accept: "application/json", "content-type": "application/json" },
    method: "POST",
  });
  const responseText = await response.text();

  const posthog = getPostHogClient();
  posthog.capture({
    distinctId:
      request.headers.get("x-posthog-distinct-id") ?? payload.action?.owner ?? "anonymous",
    event: "server_withdrawal_received",
    properties: {
      http_status: response.status,
      ok: response.ok,
      subaccount_id: payload.action?.subaccount_id ?? null,
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
