import { formatCandleTimeLabel } from "@/lib/market-candles";
import type { CandleInterval } from "@/lib/markets-service";
import type { Candle, Stats24h, TradePrint } from "@/lib/trading.types";

/** Bucket widths for the chart intervals markets-service serves. */
export const CANDLE_INTERVAL_MS = {
  "1d": 86_400_000,
  "1h": 3_600_000,
  "1m": 60_000,
  "4h": 14_400_000,
  "5m": 300_000,
  "15m": 900_000,
} satisfies Record<CandleInterval, number>;

/**
 * The newest fill the server rendered with. Streamed trades at or before it are already in the
 * server's candles and 24h stats; anything after it is what the page has to add itself.
 */
export function latestTradeMs(trades: readonly TradePrint[]): number {
  return trades.reduce((latest, trade) => Math.max(latest, trade.atMs ?? 0), 0);
}

/** The streamed trades the server has not seen, oldest first; trades without a timestamp cannot be placed and are left out. */
export function tradesSince(trades: readonly TradePrint[], watermarkMs: number): TradePrint[] {
  return trades
    .filter((trade): trade is TradePrint & { atMs: number } => (trade.atMs ?? -1) > watermarkMs)
    .sort((a, b) => a.atMs - b.atMs);
}

/**
 * The server's candles with streamed fills folded in: each fill extends the candle its bucket
 * falls in, or opens a new candle when it is the first in a new interval. Pure, so it can run on
 * every render against the same server candles and the same stream without double counting.
 */
export function applyTradesToCandles(
  candles: readonly Candle[],
  trades: readonly TradePrint[],
  intervalMs: number,
  interval: CandleInterval
): Candle[] {
  const next = [...candles];
  for (const trade of trades) {
    if (trade.atMs === undefined) {
      continue;
    }
    const bucketStartMs = Math.floor(trade.atMs / intervalMs) * intervalMs;
    const last = next.at(-1);
    if (last !== undefined && last.bucketStartMs === bucketStartMs) {
      next[next.length - 1] = {
        ...last,
        close: trade.price,
        high: Math.max(last.high, trade.price),
        low: Math.min(last.low, trade.price),
        volume: last.volume + trade.size,
      };
      continue;
    }
    if (last !== undefined && bucketStartMs < last.bucketStartMs) {
      // Older than the chart's last bucket: the server already has it, or the chart would need
      // re-sorting; the next background read settles it either way.
      continue;
    }
    next.push({
      bucketStartMs,
      close: trade.price,
      high: trade.price,
      low: trade.price,
      open: trade.price,
      time: formatCandleTimeLabel(new Date(bucketStartMs).toISOString(), interval),
      volume: trade.size,
    });
  }
  return next;
}

/**
 * The server's 24h stats with streamed fills folded in: volume grows by each fill's USDC
 * notional and the extremes widen to each fill's price. With no server stats, the fills alone
 * make the window, and the first of them is what the change is measured from. Fills rolling out
 * of the window are the background read's job, not this one's.
 */
export function applyTradesToStats(
  stats: Stats24h | null,
  trades: readonly TradePrint[]
): Stats24h | null {
  if (trades.length === 0) {
    return stats;
  }
  const prices = trades.map((trade) => trade.price);
  const volume = trades.reduce((sum, trade) => sum + trade.size, 0);
  return {
    firstPrice: stats?.firstPrice ?? prices[0] ?? null,
    high: Math.max(stats?.high ?? Number.NEGATIVE_INFINITY, ...prices),
    low: Math.min(stats?.low ?? Number.POSITIVE_INFINITY, ...prices),
    quoteVolume: (stats?.quoteVolume ?? 0) + volume,
  };
}
