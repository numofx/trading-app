import { NextResponse } from "next/server";
import { parseAbi } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { futureMarkSource, futureOpenInterestUsd, parseFutureState } from "@/lib/future-market";
import { buildOverviewRow, emptyOverviewRow } from "@/lib/market-overview";
import type { MarketOverviewResponse, TerminalMarketId } from "@/lib/market-overview.types";
import { findPerpMarket, findSpotMarket, listLiveFutures } from "@/lib/market-pickers";
import type { MarketPresentation } from "@/lib/markets-service";
import { getMarketBook, getMarketsServiceUrl, getMarketTrades } from "@/lib/markets-service";
import { parsePerpState } from "@/lib/perp-market";
import { buildSpotMarket } from "@/lib/spot-market";

/**
 * The market selector's table: every market the terminal offers, with the venue's own price,
 * 24h change and volume (the perp's open interest, funding and leverage; each future series' mark,
 * index, open interest from chain and times), read the same way
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

  // The same pickers the terminals use, so the selector can never look for a market under an
  // orientation the venue no longer reports and show dashes for one it is serving.
  const spot = findSpotMarket(markets);
  const perp = findPerpMarket(markets);
  // Every series not yet expired, nearest first; the first is the front month `/` opens.
  const futures = listLiveFutures(markets, Date.now());

  const [spotRow, perpRow, futureRows] = await Promise.all([
    readRow("spot", spot ?? undefined, null),
    readRow("perp", perp ?? undefined, parsePerpState(perp?.perp)),
    Promise.all(futures.map((future) => readRow("future", future, null, parseFutureState(future)))),
  ]);

  return NextResponse.json(
    {
      futures: futureRows,
      rows: [spotRow, perpRow, futureRows[0] ?? emptyOverviewRow("future")],
    } satisfies MarketOverviewResponse,
    {
      headers: { "cache-control": "no-store" },
    }
  );
}

async function readRow(
  id: TerminalMarketId,
  presentation: MarketPresentation | undefined,
  perpState: ReturnType<typeof parsePerpState>,
  futureState: ReturnType<typeof parseFutureState> = null
) {
  if (!presentation?.asset_address) {
    return emptyOverviewRow(id);
  }
  const assetAddress = presentation.asset_address;
  const subId = presentation.sub_id ?? "0";
  // Independent reads, run together; one failing still yields the others' figures.
  const [bookResult, tradesResult, openInterestResult] = await Promise.allSettled([
    getMarketBook(assetAddress, subId),
    getMarketTrades(assetAddress, subId),
    futureState === null ? Promise.resolve(null) : readTotalPosition(presentation),
  ]);
  const market = buildSpotMarket({
    book: bookResult.status === "fulfilled" ? bookResult.value : null,
    candles: [],
    stats24h: tradesResult.status === "fulfilled" ? tradesResult.value.stats24h : null,
    trades: tradesResult.status === "fulfilled" ? tradesResult.value.trades : [],
  });
  const volumeUnits = Number(
    tradesResult.status === "fulfilled" ? tradesResult.value.stats24h?.volume : Number.NaN
  );
  return buildOverviewRow(
    id,
    market,
    perpState,
    futureState === null
      ? null
      : {
          expiryMs: futureState.expiryMs,
          indexPrice: futureState.indexPrice,
          lastTradeAtMs: futureState.lastTradeAtMs,
          markPrice: futureState.markPrice,
          markSource: futureMarkSource({
            asks: depthUsdc(market.orderBookAsks, futureState.unitUsdc),
            bids: depthUsdc(market.orderBookBids, futureState.unitUsdc),
          }),
          openInterestUsd:
            openInterestResult.status === "fulfilled" && openInterestResult.value !== null
              ? futureOpenInterestUsd(openInterestResult.value, futureState.contractSizeUsdc)
              : null,
          settled: futureState.settled,
          symbol: presentation.market,
          unitUsdc: futureState.unitUsdc,
          volumeUnits: Number.isFinite(volumeUnits) ? volumeUnits : null,
        }
  );
}

const positionTrackingAbi = parseAbi([
  "function totalPosition(address manager) view returns (uint256)",
]);

/** The future's tracked |positions| under its margin manager, from chain; null without the manager. */
async function readTotalPosition(presentation: MarketPresentation) {
  const asset = presentation.asset_address;
  const manager = presentation.margin_manager_address;
  if (!(asset && manager)) {
    return null;
  }
  return await createBasePublicClient().readContract({
    abi: positionTrackingAbi,
    address: asset as `0x${string}`,
    args: [manager as `0x${string}`],
    functionName: "totalPosition",
  });
}

/** One side's resting notional in USDC: the venue's sizes count `unitUsdc` each. */
function depthUsdc(levels: readonly { size: number }[], unitUsdc: number) {
  return levels.reduce((sum, level) => sum + level.size, 0) * unitUsdc;
}
