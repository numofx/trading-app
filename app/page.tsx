import { toUiCandles } from "@/lib/market-candles";
import type { BookResponse, CandleInterval } from "@/lib/markets-service";
import {
  getLiveSpotMarket,
  getMarketBook,
  getMarketCandles,
  getMarketTrades,
} from "@/lib/markets-service";
import type { LiveSpotRuntime } from "@/lib/spot-market";
import { buildSpotMarket } from "@/lib/spot-market";
import type { Candle } from "@/lib/trading.types";
import { OrderBookTradingTerminal } from "@/ui/trading-terminal/OrderBookTradingTerminal";

const CHART_CANDLE_INTERVAL: CandleInterval = "1d";
const CHART_CANDLE_LIMIT = 120;

/**
 * The book, trades and candles below are per-request state. The page used to read `searchParams`
 * for the market selector, which opted it into dynamic rendering; with one market and no params
 * left, Next would otherwise prerender a build-time snapshot of the venue and serve that forever.
 */
export const dynamic = "force-dynamic";

/** Converts served candles for the chart; a payload it cannot read renders no candles, as before. */
function presentCandles(candles: Awaited<ReturnType<typeof getMarketCandles>>): Candle[] {
  try {
    return toUiCandles(candles, "spot", CHART_CANDLE_INTERVAL);
  } catch {
    return [];
  }
}

export default async function Home() {
  let liveSpot: LiveSpotRuntime | null = null;

  try {
    const spotMarket = await getLiveSpotMarket();

    if (spotMarket?.asset_address && spotMarket.sub_id != null) {
      const { asset_address: assetAddress, sub_id: subId } = spotMarket;
      // Independent reads, so they run together: the page waits on the slowest, not the sum. Each
      // settles on its own, so one failing still renders the others' data.
      const [bookResult, candlesResult, tradesResult] = await Promise.allSettled([
        getMarketBook(assetAddress, subId),
        getMarketCandles(assetAddress, subId, CHART_CANDLE_INTERVAL, CHART_CANDLE_LIMIT),
        getMarketTrades(assetAddress, subId),
      ]);

      const book: BookResponse | null = bookResult.status === "fulfilled" ? bookResult.value : null;
      const candles =
        candlesResult.status === "fulfilled" ? presentCandles(candlesResult.value) : [];
      const { stats24h, trades }: Pick<LiveSpotRuntime, "stats24h" | "trades"> =
        tradesResult.status === "fulfilled" ? tradesResult.value : { stats24h: null, trades: [] };

      liveSpot = { book, candles, stats24h, trades };
    }
  } catch {
    liveSpot = null;
  }

  return <OrderBookTradingTerminal spotMarket={buildSpotMarket(liveSpot)} />;
}
