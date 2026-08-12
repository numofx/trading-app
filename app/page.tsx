import { toUiCandles } from "@/lib/market-candles";
import type { BookResponse, CandleInterval, PresentedTrade } from "@/lib/markets-service";
import {
  getLiveSpotMarket,
  getMarketBook,
  getMarketCandles,
  getMarketTrades,
} from "@/lib/markets-service";
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

export default async function Home() {
  let liveSpot: { book: BookResponse | null; candles: Candle[]; trades: PresentedTrade[] } | null =
    null;

  try {
    const spotMarket = await getLiveSpotMarket();

    if (spotMarket?.asset_address && spotMarket.sub_id != null) {
      let book: BookResponse | null = null;
      let candles: Candle[] = [];
      let trades: PresentedTrade[] = [];

      try {
        book = await getMarketBook(spotMarket.asset_address, spotMarket.sub_id);
      } catch {
        book = null;
      }

      try {
        candles = toUiCandles(
          await getMarketCandles(
            spotMarket.asset_address,
            spotMarket.sub_id,
            CHART_CANDLE_INTERVAL,
            CHART_CANDLE_LIMIT
          ),
          "spot",
          CHART_CANDLE_INTERVAL
        );
      } catch {
        candles = [];
      }

      try {
        trades = await getMarketTrades(spotMarket.asset_address, spotMarket.sub_id);
      } catch {
        trades = [];
      }

      liveSpot = { book, candles, trades };
    }
  } catch {
    liveSpot = null;
  }

  return <OrderBookTradingTerminal spotMarket={buildSpotMarket(liveSpot)} />;
}
