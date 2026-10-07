import type { Candle, Stats24h, TradePrint } from "@/lib/trading.types";

export function formatCompactVolume(value: number) {
  const compact = formatCompactNumber(value, 0);
  return compact === "—" ? compact : `${compact} USDC`;
}

/**
 * The same compact figure read as dollars, where the unit goes in front: "$73.42", "$7.2K"; "—"
 * for none. Under a thousand it keeps its cents, as a dollar figure is expected to.
 */
export function formatCompactUsd(value: number) {
  const compact = formatCompactNumber(value, 2);
  return compact === "—" ? compact : `$${compact}`;
}

/** @param smallDigits decimals shown under a thousand; K and M always take one. */
function formatCompactNumber(value: number, smallDigits: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return "—";
  }

  if (value >= 1_000_000) {
    return `${(value / 1_000_000).toFixed(1)}M`;
  }

  if (value >= 1000) {
    return `${(value / 1000).toFixed(1)}K`;
  }

  return value.toLocaleString("en-US", {
    maximumFractionDigits: smallDigits,
    minimumFractionDigits: smallDigits,
  });
}

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
 * The header's 24h change, high, low and volume, from the venue's own trailing-24h stats.
 *
 * These used to come from daily candles, keeping any candle that had started within the last 24
 * hours. At 00:00Z the day's candle aged out, so every figure blanked while the day's trades were
 * still inside the window — at 2026-09-14 00:13Z, six trades from the previous 7.5 hours all read
 * "—". The venue computes its window from the fills themselves, so it holds at any hour.
 *
 * Change is measured to the live last price, so a trade streamed after the page rendered still
 * moves it. High, low and volume are as of the render. With no stats, or nothing traded in the
 * window, each figure is blank rather than guessed; the last price is reported separately.
 */
export function get24hStats(stats: Stats24h | null, lastPrice: number | null) {
  const firstPrice = stats?.firstPrice ?? null;

  return {
    changePercent:
      firstPrice !== null && lastPrice !== null
        ? ((lastPrice - firstPrice) / firstPrice) * 100
        : null,
    high: stats?.high ?? null,
    low: stats?.low ?? null,
    volumeLabel: formatCompactVolume(stats?.quoteVolume ?? Number.NaN),
  };
}
