import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";

const SUBACCOUNT_ID_PATTERN = /^\d+$/;

/**
 * One account's perp positions and margin (`GET /v1/positions`). Positions are public on chain, so
 * this carries no auth; it only forwards a validated subaccount id. Never cached: margin moves with
 * every mark.
 */
export async function GET(request: Request) {
  const subaccountId = new URL(request.url).searchParams.get("subaccount_id") ?? "";
  if (!SUBACCOUNT_ID_PATTERN.test(subaccountId)) {
    return NextResponse.json(
      { error: "subaccount_id must be a non-negative integer" },
      { status: 400 }
    );
  }

  const response = await fetch(
    `${getMarketsServiceUrl()}/v1/positions?subaccount_id=${subaccountId}`,
    {
      cache: "no-store",
      headers: { accept: "application/json" },
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
