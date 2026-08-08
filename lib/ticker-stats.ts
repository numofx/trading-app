import type { Candle, TradePrint } from "@/lib/trading.types";

export function formatCompactVolume(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M USDC`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K USDC`;
  }

  return `${Math.round(value).toLocaleString("en-US")} USDC`;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The venue's own last traded price.
 *
 * Deliberately not the external NGN/USD reference: that is an oracle rate, not something that
 * traded here, and it drifts away from the book. Showing it as "last price" put a figure below
 * the best bid — impossible for a real trade — and pre-filled the order form with a limit that
 * could never cross.
 */
export function getVenueLastPrice(trades: TradePrint[], candles: Candle[], mark: number | null) {
  const lastTrade = trades[0]?.price;
  if (Number.isFinite(lastTrade) && (lastTrade ?? 0) > 0) {
    return lastTrade as number;
  }

  const lastClose = candles.at(-1)?.close;
  if (Number.isFinite(lastClose) && (lastClose ?? 0) > 0) {
    return lastClose as number;
  }

  return mark;
}

/**
 * Stats over the trailing 24 hours.
 *
 * Previously this spanned every candle it was given, so "24H volume" was really all-time — on a
 * market this quiet that meant a figure five times the real one.
 */
export function get24hStats(candles: Candle[], lastPrice: number | null, nowMs: number) {
  const recent = candles.filter((candle) => nowMs - candle.bucketStartMs <= DAY_MS);
  const firstCandle = recent[0];

  if (!firstCandle) {
    // Nothing traded in the window. A change would be invented, but the last price is still
    // real, so report it and leave the rest blank.
    return { changePercent: null, volumeLabel: "—" };
  }

  const resolvedLast = lastPrice ?? recent.at(-1)?.close ?? firstCandle.close;

  return {
    changePercent:
      firstCandle.open > 0 ? ((resolvedLast - firstCandle.open) / firstCandle.open) * 100 : null,
    volumeLabel: formatCompactVolume(recent.reduce((sum, candle) => sum + candle.volume, 0)),
  };
}
