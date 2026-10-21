import { formatMarketPrice } from "@/lib/market-formatting";
import type { PerpHeaderMetric } from "@/lib/perp-market.types";
import type { SpotPair } from "@/lib/spot-pairs";
import { SPOT_PAIRS } from "@/lib/spot-pairs";
import type {
  Candle,
  OrderBookLevel,
  SpotOpenOrder,
  Stats24h,
  TradePrint,
} from "@/lib/trading.types";

/**
 * Spot as the trader sees it: USDC-cNGN, quoted the way the future is, in cNGN per USDC (about
 * 1,362), sized in USDC, and a buy is a buy of USDC. The engine trades the same market the other
 * way up: cNGN is its base, priced in USDC per cNGN, and an engine buy is a buy of cNGN. Everything
 * the venue serves (book, trades, candles, stats, orders) is in the engine's terms; this file turns
 * it the trader's way up, once, for display. Orders go the other way through `engineLimitPrice`.
 *
 * Under the inversion an engine ask (selling cNGN for USDC) is a bid for USDC, so the two sides of
 * the book swap, a trade's side flips, and a candle's high is the engine's low inverted.
 */

/** The trader's side as the engine's: a buy of USDC is the engine's sell of cNGN. */
export function engineSide(side: "buy" | "sell"): "buy" | "sell" {
  return side === "buy" ? "sell" : "buy";
}

/** A price the other way up; null for a missing or non-positive one. */
export function invertPrice(price: number | null): number | null {
  return price !== null && Number.isFinite(price) && price > 0 ? 1 / price : null;
}

/** One side of the ladder in the trader's terms, from the engine's opposite side, totals summed again. */
function toUsdcLevels(engineLevels: readonly OrderBookLevel[]): OrderBookLevel[] {
  let total = 0;
  return engineLevels
    .filter((level) => level.price > 0)
    .map((level) => ({ price: 1 / level.price, size: level.size * level.price }))
    .sort((a, b) => b.price - a.price)
    .map((level) => {
      total += level.size;
      return { ...level, total };
    });
}

/**
 * The ladder in cNGN per USDC, sized in USDC. The engine's asks become the bids (best first, so the
 * highest cNGN per USDC first) and its bids become the asks (best, the lowest, first).
 */
export function toUsdcCngnBook(engine: {
  asks: readonly OrderBookLevel[];
  bids: readonly OrderBookLevel[];
}) {
  const bids = toUsdcLevels(engine.asks);
  let total = 0;
  const asks = toUsdcLevels(engine.bids)
    .reverse()
    .map((level) => {
      total += level.size;
      return { ...level, total };
    });
  return { asks, bids };
}

/** The tape in the trader's terms: price inverted, size in USDC, the aggressor's side flipped. */
export function toUsdcCngnTrades(trades: readonly TradePrint[]): TradePrint[] {
  return trades
    .filter((trade) => trade.price > 0)
    .map((trade) => ({
      ...trade,
      price: 1 / trade.price,
      side: engineSide(trade.side),
      size: trade.size * trade.price,
    }));
}

/** A candle inverted: its high is the engine's low the other way up, and its low the engine's high. */
export function toUsdcCngnCandles(candles: readonly Candle[]): Candle[] {
  return candles
    .filter((candle) => candle.open > 0 && candle.close > 0 && candle.high > 0 && candle.low > 0)
    .map((candle) => ({
      ...candle,
      close: 1 / candle.close,
      high: 1 / candle.low,
      low: 1 / candle.high,
      open: 1 / candle.open,
    }));
}

/** The trailing-24h stats inverted; volume stays the USDC traded, now the base leg. */
export function toUsdcCngnStats(stats: Stats24h | null): Stats24h | null {
  if (stats === null) {
    return null;
  }
  return {
    firstPrice: invertPrice(stats.firstPrice),
    high: invertPrice(stats.low),
    low: invertPrice(stats.high),
    quoteVolume: stats.quoteVolume,
  };
}

/** A resting order in the trader's terms: side flipped, price inverted, size and fill in USDC. */
export function toUsdcCngnOrder(order: SpotOpenOrder): SpotOpenOrder {
  if (!(order.price > 0)) {
    return order;
  }
  return {
    ...order,
    filled: order.filled * order.price,
    price: 1 / order.price,
    side: engineSide(order.side),
    size: order.size * order.price,
  };
}

const ENGINE_DECIMALS = 18n;
const DECIMAL_PATTERN = /^(\d+)(?:\.(\d+))?$/;
const TRAILING_ZEROS = /0+$/;

/**
 * The engine limit (USDC per cNGN, an 18-decimal string) for a limit the trader typed in cNGN per
 * USDC, rounded so the signed order can never trade beyond it. A buy of USDC pays at most P cNGN per
 * USDC, which is an engine sell of cNGN for at least 1/P USDC each: rounded up. A sell of USDC takes
 * at least P, an engine buy of cNGN for at most 1/P: rounded down. Null for anything but a positive
 * decimal.
 */
export function engineLimitPrice(cngnPerUsdc: string, side: "buy" | "sell"): string | null {
  const match = DECIMAL_PATTERN.exec(cngnPerUsdc.replaceAll(",", "").trim());
  if (match === null) {
    return null;
  }
  const fraction = match[2] ?? "";
  const numerator = BigInt(match[1] + fraction);
  const denominator = 10n ** BigInt(fraction.length);
  if (numerator === 0n) {
    return null;
  }
  // 1/P in 18-decimal units: denominator x 10^18 / numerator
  const scaled = denominator * 10n ** ENGINE_DECIMALS;
  let units = scaled / numerator;
  if (side === "buy" && scaled % numerator !== 0n) {
    units += 1n;
  }
  if (units === 0n) {
    return null;
  }
  const digits = units.toString().padStart(Number(ENGINE_DECIMALS) + 1, "0");
  const whole = digits.slice(0, -Number(ENGINE_DECIMALS));
  const decimals = digits.slice(-Number(ENGINE_DECIMALS)).replace(TRAILING_ZEROS, "");
  return decimals === "" ? whole : `${whole}.${decimals}`;
}

/**
 * A typed limit as the engine signs it on a pair shown the way it trades: the decimal itself,
 * commas dropped. Null for anything but a positive decimal.
 */
export function directLimitPrice(price: string): string | null {
  const trimmed = price.replaceAll(",", "").trim();
  const match = DECIMAL_PATTERN.exec(trimmed);
  if (match === null || BigInt(match[1] + (match[2] ?? "")) === 0n) {
    return null;
  }
  return trimmed;
}

/**
 * How one spot pair's venue data reaches the screen, and the trader's order reaches the engine.
 * USDC-cNGN turns everything over; EURC-USDC passes it through as served.
 */
export type SpotOrientation = {
  book: typeof toUsdcCngnBook;
  trades: typeof toUsdcCngnTrades;
  candles: typeof toUsdcCngnCandles;
  stats: typeof toUsdcCngnStats;
  order: typeof toUsdcCngnOrder;
  /** An engine price the trader's way up. */
  price: typeof invertPrice;
  /** The trader's side as the engine's, and back: the two are the same mapping. */
  side: typeof engineSide;
  /** The engine limit for a limit typed in the trader's terms, rounded never to trade past it. */
  limit: typeof engineLimitPrice;
};

const INVERTED: SpotOrientation = {
  book: toUsdcCngnBook,
  candles: toUsdcCngnCandles,
  limit: engineLimitPrice,
  order: toUsdcCngnOrder,
  price: invertPrice,
  side: engineSide,
  stats: toUsdcCngnStats,
  trades: toUsdcCngnTrades,
};

const DIRECT: SpotOrientation = {
  book: (engine) => ({ asks: [...engine.asks], bids: [...engine.bids] }),
  candles: (candles) => [...candles],
  limit: (price) => directLimitPrice(price),
  order: (order) => order,
  price: (price) => (price !== null && Number.isFinite(price) && price > 0 ? price : null),
  side: (side) => side,
  stats: (stats) => stats,
  trades: (trades) => [...trades],
};

/** The orientation `pair` is shown in. */
export function spotOrientation(pair: SpotPair): SpotOrientation {
  return pair.inverted ? INVERTED : DIRECT;
}

/** A displayed price with its pair's prefix: "₦1,361.98", "$1.17234"; an em dash when unknown. */
export function formatSpotPairPrice(pair: SpotPair, price: number | null) {
  return price === null || !Number.isFinite(price)
    ? "—"
    : `${pair.pricePrefix}${formatMarketPrice(price, pair.priceDecimals)}`;
}

/** A cNGN-per-USDC price for the header and the selector: "₦1,361.98"; an em dash when unknown. */
export function formatSpotNairaPrice(cngnPerUsdc: number | null) {
  return formatSpotPairPrice(SPOT_PAIRS.spot, cngnPerUsdc);
}

/** A change that rounds to 0.00% is no move: neutral, unsigned. */
function roundsToZero(changePercent: number) {
  return Number(changePercent.toFixed(2)) === 0;
}

function changeTone(changePercent: number | null): PerpHeaderMetric["tone"] {
  if (changePercent === null || !Number.isFinite(changePercent) || roundsToZero(changePercent)) {
    return null;
  }
  return changePercent > 0 ? "up" : "down";
}

function formatChange(changePercent: number | null) {
  if (changePercent === null || !Number.isFinite(changePercent)) {
    return "—";
  }
  if (roundsToZero(changePercent)) {
    return "0.00%";
  }
  return `${changePercent > 0 ? "+" : ""}${changePercent.toFixed(2)}%`;
}

/**
 * A spot pair's header figures in the trader's terms: the price (the book's mid, else a side, else
 * the last trade; cNGN per USDC on USDC-cNGN), the 24h change of that price, the USDC traded, and
 * the window's high and low the same way up.
 */
export function buildSpotHeaderMetrics(
  pair: SpotPair,
  figures: {
    changePercent: number | null;
    high: number | null;
    low: number | null;
    price: number | null;
    volumeLabel: string;
  }
): PerpHeaderMetric[] {
  return [
    {
      label: "Price",
      tone: null,
      tooltip: `${pair.displayQuote} per ${pair.displayBase}`,
      value: formatSpotPairPrice(pair, figures.price),
    },
    {
      label: "24h Change",
      tone: changeTone(figures.changePercent),
      value: formatChange(figures.changePercent),
    },
    { label: "24h Volume", tone: null, tooltip: "USDC traded", value: figures.volumeLabel },
    { label: "24h High", tone: null, value: formatSpotPairPrice(pair, figures.high) },
    { label: "24h Low", tone: null, value: formatSpotPairPrice(pair, figures.low) },
  ];
}
