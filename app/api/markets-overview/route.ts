import { NextResponse } from "next/server";
import { buildOverviewRow, emptyOverviewRow } from "@/lib/market-overview";
import type { MarketOverviewResponse, TerminalMarketId } from "@/lib/market-overview.types";
import type { MarketPresentation } from "@/lib/markets-service";
import { getMarketBook, getMarketsServiceUrl, getMarketTrades } from "@/lib/markets-service";
import { parsePerpState } from "@/lib/perp-market";
import { buildSpotMarket } from "@/lib/spot-market";

/**
 * The market selector's table: every market the terminal offers, with the venue's own price,
 * 24h change and volume (and the perp's open interest, funding and leverage), read the same way
 * each terminal's header reads them. Never cached: the selector opens on demand and shows the
 * venue as it is now. A market the venue is not serving, or one whose reads fail, keeps its row
 * with every figure null; the selector still lists it, with dashes, since the route exists.
 */
export async function GET() {
  let markets: MarketPresentation[] = [];
  try {
    const response = await fetch(`${getMarketsServiceUrl()}/v1/markets`, {
      cache: "no-store",
      headers: { accept: "application/json" },
    });
    if (response.ok) {
      markets = (await response.json()) as MarketPresentation[];
    }
  } catch {
    markets = [];
  }

  const spot = markets.find(
    (market) =>
      market.contract_type === "spot" &&
      market.base_asset_symbol === "USDC" &&
      market.quote_asset_symbol === "cNGN"
  );
  const perp = markets.find(
    (market) =>
      market.contract_type === "perpetual" &&
      market.base_asset_symbol === "USDC" &&
      market.quote_asset_symbol === "cNGN"
  );

  const [spotRow, perpRow] = await Promise.all([
    readRow("spot", spot, null),
    readRow("perp", perp, parsePerpState(perp?.perp)),
  ]);

  return NextResponse.json({ rows: [spotRow, perpRow] } satisfies MarketOverviewResponse, {
    headers: { "cache-control": "no-store" },
  });
}

async function readRow(
  id: TerminalMarketId,
  presentation: MarketPresentation | undefined,
  perpState: ReturnType<typeof parsePerpState>
) {
  if (!presentation?.asset_address) {
    return emptyOverviewRow(id);
  }
  const assetAddress = presentation.asset_address;
  const subId = presentation.sub_id ?? "0";
  // Independent reads, run together; one failing still yields the other's figures.
  const [bookResult, tradesResult] = await Promise.allSettled([
    getMarketBook(assetAddress, subId),
    getMarketTrades(assetAddress, subId),
  ]);
  const market = buildSpotMarket({
    book: bookResult.status === "fulfilled" ? bookResult.value : null,
    candles: [],
    stats24h: tradesResult.status === "fulfilled" ? tradesResult.value.stats24h : null,
    trades: tradesResult.status === "fulfilled" ? tradesResult.value.trades : [],
  });
  return buildOverviewRow(id, market, perpState);
}
