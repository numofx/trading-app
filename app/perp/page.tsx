import { toUiCandles } from "@/lib/market-candles";
import type { CandleInterval, MarketPresentation } from "@/lib/markets-service";
import {
  getLivePerpMarket,
  getMarketBook,
  getMarketCandles,
  getMarketTrades,
} from "@/lib/markets-service";
import { parsePerpStack, parsePerpState } from "@/lib/perp-market";
import type { PerpMarket } from "@/lib/perp-market.types";
import { buildSpotMarket } from "@/lib/spot-market";
import type { Candle } from "@/lib/trading.types";
import { PerpTradingTerminal } from "@/ui/trading-terminal/PerpTradingTerminal";

const CHART_CANDLE_INTERVAL: CandleInterval = "1d";
const CHART_CANDLE_LIMIT = 120;

/** Per-request venue state, like the spot page: never a build-time snapshot. */
export const dynamic = "force-dynamic";

function presentCandles(candles: Awaited<ReturnType<typeof getMarketCandles>>): Candle[] {
  try {
    return toUiCandles(candles, "perp", CHART_CANDLE_INTERVAL);
  } catch {
    return [];
  }
}

/**
 * The live perp, or null. Null covers every way the perp is not tradeable here: markets-service
 * does not list it, lists it without chain state, or lists it without a complete stack. The
 * terminal then renders its not-live state rather than guessing at any of it.
 */
async function loadPerpMarket(): Promise<PerpMarket | null> {
  let presentation: MarketPresentation | null;
  try {
    presentation = await getLivePerpMarket();
  } catch {
    return null;
  }
  if (!presentation?.asset_address) {
    return null;
  }
  const state = parsePerpState(presentation.perp);
  const stack = parsePerpStack(presentation.asset_address, presentation.perp);
  if (state === null || stack === null) {
    return null;
  }

  const assetAddress = presentation.asset_address;
  const subId = presentation.sub_id ?? "0";
  // Independent reads, run together; one failing still renders the others.
  const [bookResult, candlesResult, tradesResult] = await Promise.allSettled([
    getMarketBook(assetAddress, subId),
    getMarketCandles(assetAddress, subId, CHART_CANDLE_INTERVAL, CHART_CANDLE_LIMIT),
    getMarketTrades(assetAddress, subId),
  ]);

  // The perp's book and trades carry the same inverted `spot_contract` echo spot's do, so spot's
  // builder presents them without change.
  const market = buildSpotMarket({
    book: bookResult.status === "fulfilled" ? bookResult.value : null,
    candles: candlesResult.status === "fulfilled" ? presentCandles(candlesResult.value) : [],
    stats24h: tradesResult.status === "fulfilled" ? tradesResult.value.stats24h : null,
    trades: tradesResult.status === "fulfilled" ? tradesResult.value.trades : [],
  });

  return { ...market, stack, state, symbol: presentation.market };
}

export default async function PerpPage() {
  return <PerpTradingTerminal market={await loadPerpMarket()} />;
}
