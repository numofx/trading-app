import type { Candle, Stats24h, TradePrint } from "@/lib/trading.types";

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

/**
 * How stale the venue's last trade is, as a short suffix for the header — or null when it is
 * recent enough that the figure speaks for itself.
 *
 * The header labels this figure and a trader reads it as the current price. On a liquid venue that
 * is fair. On one that has printed eight trades in its lifetime it is not: a fill from two days ago
 * sat beside a live book quoting fourteen naira away, with nothing on screen saying so, and
 * `TradePrint.time` is HH:MM with no date, so the tape did not disambiguate it either.
 *
 * Deliberately not a fallback to the mid. A mid is not something that traded here, and showing it
 * as the last price previously put a figure below the best bid and pre-filled the ticket with a
 * limit that could never cross. The figure stays truthful; its age becomes visible.
 */
export function lastTradeAgeLabel(
  trades: readonly TradePrint[],
  now: Date = new Date(),
  staleAfterMs: number = 60 * 60 * 1000
) {
  const timestamp = trades[0]?.timestamp;
  if (!timestamp) {
    return null;
  }
  const traded = new Date(timestamp).getTime();
  if (!Number.isFinite(traded)) {
    return null;
  }
  const ageMs = now.getTime() - traded;
  // A clock skewed a little ahead of the venue must not render "in 3 minutes".
  if (ageMs < staleAfterMs) {
    return null;
  }

  const minutes = Math.floor(ageMs / 60_000);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days >= 1) {
    return `${days}d ago`;
  }
  return `${hours}h ago`;
}
