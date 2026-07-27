import type { CandleInterval, PresentedCandle } from "@/lib/markets-service";
import type { Candle, MarketType } from "@/lib/trading.types";

/**
 * Converts markets-service candles into the UI's display convention.
 *
 * markets-service returns raw engine values, matching `/v1/trades`. Futures show
 * those directly. Spot displays cNGN-per-USDC = 1 / engine price, which **reverses
 * the ordering**: the bucket's highest displayed price comes from its lowest engine
 * price. Mapping high to high there would silently invert every candle's wick.
 *
 * Volume follows the same split: futures show base volume (contract count), spot
 * shows `quote_volume` (USDC notional), which is why the server accumulates it per
 * trade rather than letting us derive it from the aggregate.
 */

function toFiniteNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** UTC label matching the existing chart axis: "HH:MM" intraday, "MM-DD" daily and up. */
export function formatCandleTimeLabel(bucketStart: string, interval: CandleInterval) {
  const date = new Date(bucketStart);

  if (Number.isNaN(date.getTime())) {
    return bucketStart;
  }

  if (interval === "1d") {
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const day = String(date.getUTCDate()).padStart(2, "0");
    return `${month}-${day}`;
  }

  const hours = String(date.getUTCHours()).padStart(2, "0");
  const minutes = String(date.getUTCMinutes()).padStart(2, "0");
  return `${hours}:${minutes}`;
}

export function toUiCandle(
  candle: PresentedCandle,
  marketType: MarketType,
  interval: CandleInterval,
): Candle | null {
  const open = toFiniteNumber(candle.open);
  const high = toFiniteNumber(candle.high);
  const low = toFiniteNumber(candle.low);
  const close = toFiniteNumber(candle.close);

  if (open === null || high === null || low === null || close === null) {
    return null;
  }

  const time = formatCandleTimeLabel(candle.bucket_start, interval);

  if (marketType === "spot") {
    // Every engine price must be positive to invert; a zero would produce Infinity.
    if (open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      return null;
    }

    return {
      close: 1 / close,
      // Inverting reverses the ordering, so high and low swap.
      high: 1 / low,
      low: 1 / high,
      open: 1 / open,
      time,
      volume: toFiniteNumber(candle.quote_volume) ?? 0,
    };
  }

  return {
    close,
    high,
    low,
    open,
    time,
    volume: toFiniteNumber(candle.volume) ?? 0,
  };
}

export function toUiCandles(
  candles: PresentedCandle[],
  marketType: MarketType,
  interval: CandleInterval,
): Candle[] {
  return candles
    .map((candle) => toUiCandle(candle, marketType, interval))
    .filter((candle): candle is Candle => candle !== null);
}
