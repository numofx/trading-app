"use client";

import {
  applyTradesToCandles,
  applyTradesToStats,
  CANDLE_INTERVAL_MS,
  latestTradeId,
  mergeTrades,
  tradesSince,
} from "@/lib/live-market";
import type { CandleInterval } from "@/lib/markets-service";
import { getBestPrices } from "@/lib/spot-market";
import { getVenueLastPrice } from "@/lib/ticker-stats";
import type { Candle, SpotMarket } from "@/lib/trading.types";
import { useMarketOrderBook } from "@/ui/trading-terminal/useMarketOrderBook";

/**
 * One market's book, trades, candles and 24h figures as the trader sees them: the stream when it
 * is live, the server-rendered REST snapshot otherwise. Both are the venue's own depth; when the
 * venue has no resting orders both are empty and the panel says so.
 *
 * The server's fills and the stream's are one tape, each fill once: a fill the trades channel
 * delivered is the venue's own whatever the book's status, and the server's list stays while the
 * stream is still catching up. Fills the stream has seen since the server rendered are folded
 * into the chart's candles and the 24h figures on every render, so a trade on the market shows
 * without a reload; the minute's server re-read then corrects what folding cannot, like fills
 * leaving the window.
 */
export function useLiveMarketBook({
  candleInterval = "1d",
  candles,
  enabled = true,
  snapshot,
  symbol,
  type,
}: {
  /** The interval `candles` are bucketed at, which streamed fills are folded in at. */
  candleInterval?: CandleInterval;
  candles: Candle[];
  /** False while the market is not live: no socket, and every figure from the empty snapshot. */
  enabled?: boolean;
  /** The server-rendered market: the REST book, its trades, its stats and its mark. */
  snapshot: Pick<SpotMarket, "mark" | "orderBookAsks" | "orderBookBids" | "stats24h" | "trades">;
  /** The venue's symbol; markets-service resolves the stream subscription from it. */
  symbol: string;
  type: "perp" | "spot";
}) {
  const stream = useMarketOrderBook({ enabled, market: enabled ? symbol : null, type });
  const bids = stream.isLive ? stream.bids : snapshot.orderBookBids;
  const asks = stream.isLive ? stream.asks : snapshot.orderBookAsks;
  const trades = mergeTrades(snapshot.trades, stream.trades);
  const streamedFills = tradesSince(trades, latestTradeId(snapshot.trades));
  const liveCandles = applyTradesToCandles(
    candles,
    streamedFills,
    CANDLE_INTERVAL_MS[candleInterval],
    candleInterval
  );
  const stats24h = applyTradesToStats(snapshot.stats24h, streamedFills);
  const lastPrice = getVenueLastPrice(trades, liveCandles, snapshot.mark);
  // The touch the trader is actually looking at. It drives the ticket's prefill and cost estimate
  // and rides along on submission, so an order can never be priced off a book that is no longer
  // on screen — the server-rendered snapshot goes stale the moment the stream moves.
  const { bestAsk, bestBid } = getBestPrices(asks, bids);

  return { asks, bestAsk, bestBid, bids, candles: liveCandles, lastPrice, stats24h, trades };
}
