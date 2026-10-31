/**
 * What a taker order actually paid, for the `order_filled` analytics event: its fills, read from the
 * venue's public trades by `taker_order_id`, against the price the ticket expected (the touch on the
 * side it crossed when it was submitted).
 *
 * The order-status endpoint reports amounts but no price, so the trades are the only source of the
 * execution price. A market order fills in the block it is matched in, well inside the last 100 trades.
 */

/** The fields of a `/v1/trades` row this reads. Prices and sizes are in venue units, as listed. */
export type TakerTrade = { price: string; size: string; taker_order_id?: string };

/** The order's fills as one: venue units filled and their size-weighted average price. */
export function summarizeTakerFill(trades: readonly TakerTrade[], orderId: string) {
  let units = 0;
  let quote = 0;
  for (const trade of trades) {
    if (trade.taker_order_id !== orderId) {
      continue;
    }
    const size = Number(trade.size);
    const price = Number(trade.price);
    if (Number.isFinite(size) && Number.isFinite(price) && size > 0) {
      units += size;
      quote += size * price;
    }
  }
  return units > 0 ? { averagePrice: quote / units, filledUnits: units } : null;
}

/**
 * How much worse than expected the order filled, in basis points of the expected price: positive
 * when a buy paid more or a sell received less, negative when it did better. Null without an
 * expected price.
 */
export function slippageBps(side: "buy" | "sell", expectedPrice: number | null, fillPrice: number) {
  if (expectedPrice === null || !(expectedPrice > 0)) {
    return null;
  }
  const worse = side === "buy" ? fillPrice - expectedPrice : expectedPrice - fillPrice;
  return (worse / expectedPrice) * 10_000;
}

/** The touch an order on `side` crosses: the best ask for a buy, the best bid for a sell. */
export function expectedTakerPrice(
  side: "buy" | "sell",
  touch: { bestAsk: number | null; bestBid: number | null }
) {
  return side === "buy" ? touch.bestAsk : touch.bestBid;
}

/** The order's fills on `symbol`, or null when the trades cannot be read or hold none of it. */
export async function readTakerFill(symbol: string, orderId: string) {
  try {
    const response = await fetch(`/api/trades?symbol=${encodeURIComponent(symbol)}`, {
      cache: "no-store",
    });
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as { trades?: TakerTrade[] } | TakerTrade[];
    return summarizeTakerFill(Array.isArray(body) ? body : (body.trades ?? []), orderId);
  } catch {
    return null;
  }
}
