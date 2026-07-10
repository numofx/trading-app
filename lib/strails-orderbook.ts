import type { StrailsBookStatus, StrailsLpOrder, StrailsOrderBookData } from "@/lib/strails.types";
import type { OrderBookLevel } from "@/lib/trading.types";

/** Strails' realtime (and occasionally REST) payloads scale numbers by 10^6. */
const WEI_SCALE = 1_000_000;

// A genuine cNGN-per-USDC price sits in the hundreds-to-thousands range, so a value
// above this threshold can only be a 10^6-scaled quote (e.g. "1350000000" = 1350).
const SCALED_PRICE_THRESHOLD = 100_000;

// Plausibility bounds for cNGN per USDC. An inverted quote (USDC per cNGN, ~0.0006)
// or an unexpected unit falls outside and must not be rendered as a real book.
const MIN_PLAUSIBLE_PRICE = 100;
const MAX_PLAUSIBLE_PRICE = 100_000;

function parseStrailsNumber(value: string | undefined) {
  if (value === undefined) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Converts one side of strails' LP quote board into displayable book levels.
 *
 * Strails quotes carry `availableLiquidity` instead of an order size: cNGN-denominated
 * on buy orders and stablecoin-denominated on sell orders. Both are normalized to a
 * USDC size, aggregated per price, and given cumulative totals.
 */
function toBookLevels(orders: StrailsLpOrder[] | undefined, side: "buy" | "sell") {
  const sizeByPrice = new Map<number, number>();

  for (const order of orders ?? []) {
    if (order.status !== undefined && order.status !== "active") {
      continue;
    }

    let price = parseStrailsNumber(order.price);
    let liquidity = parseStrailsNumber(order.availableLiquidity);

    if (price === null || liquidity === null || price <= 0 || liquidity <= 0) {
      continue;
    }

    if (price > SCALED_PRICE_THRESHOLD) {
      price /= WEI_SCALE;
      liquidity /= WEI_SCALE;
    }

    const sizeUsdc = side === "buy" ? liquidity / price : liquidity;
    sizeByPrice.set(price, (sizeByPrice.get(price) ?? 0) + sizeUsdc);
  }

  const sortedLevels = [...sizeByPrice.entries()].sort(([leftPrice], [rightPrice]) =>
    side === "buy" ? rightPrice - leftPrice : leftPrice - rightPrice
  );

  let runningTotal = 0;
  return sortedLevels.map(([price, size]) => {
    runningTotal += size;
    return { price, size, total: runningTotal } satisfies OrderBookLevel;
  });
}

/**
 * Maps a strails orderbook response into the app's bid/ask levels, classifying
 * anything that must not render as a real spread (empty side, implausible prices,
 * crossed quotes) so callers can fall back to the preview book.
 */
export function buildStrailsBook(data: StrailsOrderBookData): {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  status: StrailsBookStatus;
} {
  const bids = toBookLevels(data.buyOrders, "buy");
  const asks = toBookLevels(data.sellOrders, "sell");

  const bestBid = bids[0]?.price;
  const bestAsk = asks[0]?.price;

  if (bestBid === undefined || bestAsk === undefined) {
    return { asks, bids, status: "empty" };
  }

  const pricesArePlausible = [bestBid, bestAsk, bids.at(-1)?.price ?? bestBid, asks.at(-1)?.price ?? bestAsk].every(
    (price) => price >= MIN_PLAUSIBLE_PRICE && price <= MAX_PLAUSIBLE_PRICE
  );

  if (!pricesArePlausible) {
    return { asks, bids, status: "implausible" };
  }

  if (bestBid >= bestAsk) {
    return { asks, bids, status: "crossed" };
  }

  return { asks, bids, status: "ok" };
}
