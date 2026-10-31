import { NextResponse } from "next/server";
import { getMarketsServiceUrl } from "@/lib/markets-service";

/** The newest trades fetched: enough to hold a market order's fills read just after it filled. */
const TRADES_LIMIT = "100";

/**
 * A market's newest public trades (`GET /v1/trades?symbol=`), for reading an order's own fills by
 * `taker_order_id` after it filled (`lib/order-fill.ts`). Only `symbol` is forwarded.
 */
export async function GET(request: Request) {
  const symbol = new URL(request.url).searchParams.get("symbol");
  if (!symbol) {
    return NextResponse.json({ error: "symbol is required" }, { status: 400 });
  }
  const query = new URLSearchParams({ limit: TRADES_LIMIT, symbol });
  const response = await fetch(`${getMarketsServiceUrl()}/v1/trades?${query}`, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });

  return new NextResponse(await response.text(), {
    status: response.status,
    headers: {
      "cache-control": "no-store",
      "content-type": response.headers.get("content-type") ?? "application/json",
    },
  });
}
