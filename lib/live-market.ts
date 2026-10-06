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
 * The newest fill the server rendered with, by the venue's trade id. Ids are assigned in execution
 * order, so a streamed trade with a higher id is one the server's candles and 24h stats have not
 * counted. Timestamps cannot tell two fills in the same second apart; ids can.
 */
export function latestTradeId(trades: readonly TradePrint[]): number {
  return trades.reduce((latest, trade) => Math.max(latest, trade.id ?? 0), 0);
}

/** The streamed trades the server has not seen, in execution order; trades without an id cannot be told apart and are left out. */
export function tradesSince(trades: readonly TradePrint[], watermarkId: number): TradePrint[] {
  return trades
    .filter((trade): trade is TradePrint & { id: number } => (trade.id ?? -1) > watermarkId)
    .sort((a, b) => a.id - b.id);
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

/**
 * A fill's stamp for the trade tape, in the viewer's zone: the time to the second, and a short
 * date before it when the fill is from another day, so a tape spanning days reads in order.
 */
export function formatTradeStamp(
  atMs: number,
  { nowMs, timeZone }: { nowMs: number; timeZone: string }
): { date: string | null; time: string } {
  const dayOf = new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "numeric",
    timeZone,
    year: "numeric",
  });
  const sameDay = dayOf.format(new Date(atMs)) === dayOf.format(new Date(nowMs));
  return {
    date: sameDay
      ? null
      : new Intl.DateTimeFormat("en-US", { day: "numeric", month: "short", timeZone }).format(
          new Date(atMs)
        ),
    time: new Intl.DateTimeFormat("en-US", {
      hour: "2-digit",
      hour12: false,
      minute: "2-digit",
      second: "2-digit",
      timeZone,
    }).format(new Date(atMs)),
  };
}
