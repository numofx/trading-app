import type { BookResponse, PresentedTrade } from "@/lib/markets-service";
import type {
  Candle,
  OrderBookLevel,
  SpotMarket,
  SpotOpenOrder,
  TradePrint,
} from "@/lib/trading.types";

/**
 * The touch: the best price resting on each side of the ladder the trader is looking at.
 *
 * Everything that needs a price — the spread row, the limit prefill, a market order's cost
 * estimate, and the price a market order is actually submitted at — derives from this one pair,
 * so the terminal cannot quote one number and trade at another.
 */
export function getBestPrices(asks: OrderBookLevel[], bids: OrderBookLevel[]) {
  return {
    bestAsk: asks[0]?.price ?? null,
    bestBid: bids[0]?.price ?? null,
  };
}

/**
 * The price the book is centred on: the mid of the two resting sides, else the single resting
 * side, else the last trade.
 *
 * The mid is the only value guaranteed to sit between the touches, so seeding a limit ticket with
 * it cannot cross on either side. The last trade is the fallback of last resort — on a quiet
 * market it is routinely days old and can rest outside the current spread.
 */
export function getAnchorPrice(
  bestAsk: number | null,
  bestBid: number | null,
  lastPrice: number | null = null
) {
  if (bestAsk !== null && bestBid !== null) {
    return (bestAsk + bestBid) / 2;
  }

  return bestAsk ?? bestBid ?? lastPrice;
}

/**
 * The largest USDC order the trading account can currently fund.
 *
 * A buy spends cNGN, so the ceiling is the cNGN balance converted at the order's price; a sell
 * spends USDC directly. Null whenever the balance is unknown or there is no price to convert at —
 * the ticket's size slider goes inert rather than sliding against a guessed ceiling.
 */
export function getMaxOrderSize({
  availableCngn,
  availableUsdc,
  isBuy,
  price,
}: {
  availableCngn: number | null;
  availableUsdc: number | null;
  isBuy: boolean;
  price: number | null;
}) {
  if (!isBuy) {
    return availableUsdc;
  }

  if (availableCngn === null || price === null || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  return availableCngn / price;
}

/**
 * The price a market order crosses at: the opposing touch. A UI BUY of USDC lifts the best ask,
 * a UI SELL hits the best bid. Null when that side is empty — there is nothing to cross.
 */
export function getCrossingPrice(
  side: "buy" | "sell",
  bestAsk: number | null,
  bestBid: number | null
) {
  return side === "buy" ? bestAsk : bestBid;
}

export type LiveSpotRuntime = {
  book: BookResponse | null;
  /** Real OHLCV from markets-service; empty when the market has not traded yet. */
  candles?: Candle[];
  trades: PresentedTrade[];
};

/** A market the venue serves no data for. Rendered as empty panels, never as sample depth. */
const EMPTY_SPOT_MARKET: SpotMarket = {
  candles: [],
  mark: null,
  openOrders: [],
  orderBookAsks: [],
  orderBookBids: [],
  orderEntrySpec: null,
  trades: [],
};

/**
 * Resting orders in trader-facing terms, keeping the identity a cancel needs.
 *
 * Orders without both an owner and a nonce are dropped rather than listed: a row that cannot be
 * cancelled is worse than no row, since the only reason to show it is to act on it.
 */
export function collectOpenOrders(book: BookResponse | null): SpotOpenOrder[] {
  return [...(book?.bids ?? []), ...(book?.asks ?? [])]
    .map((order) => {
      const intent = order.spot_contract?.ui_intent;
      return {
        filled: Number(order.filled_amount ?? "0"),
        nonce: order.nonce ?? "",
        orderId: order.order_id ?? "",
        ownerAddress: order.owner_address ?? "",
        price: Number(intent?.price ?? Number(order.limit_price)),
        side: intent?.side ?? order.side,
        size: Number(intent?.size ?? order.desired_amount),
      };
    })
    .filter(
      (order) =>
        order.ownerAddress !== "" &&
        order.nonce !== "" &&
        Number.isFinite(order.price) &&
        Number.isFinite(order.size)
    );
}

/**
 * Spot depth is USDC notional and routinely fractional — a 0.4 USDC order is real resting depth.
 * Sizes keep 3 decimals (the venue's amount step) rather than being rounded to whole units, which
 * displayed sub-unit levels as "0".
 */
function roundSize(value: number) {
  return Math.round(value * 1000) / 1000;
}

function buildLiveBookSide(items: NonNullable<BookResponse["asks"]>, side: "ask" | "bid") {
  const levels = items
    .map((item) => ({
      // markets-service presents prices/amounts as plain human decimals (e.g. "1377", "28"),
      // not fixed-point atomic. Spot levels carry a `spot_contract.ui_intent` presentation;
      // the raw engine fields are the fallback.
      price: Number(item.spot_contract?.ui_intent.price ?? Number(item.limit_price)),
      size: Number(item.spot_contract?.ui_intent.size ?? Number(item.desired_amount)),
    }))
    .filter(
      (level) =>
        Number.isFinite(level.price) &&
        level.price > 0 &&
        Number.isFinite(level.size) &&
        level.size > 0
    );

  const ordered = [...levels].sort((left, right) => {
    return side === "ask" ? left.price - right.price : right.price - left.price;
  });

  if (side === "ask") {
    let runningTotal = 0;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      runningTotal += ordered[index]?.size ?? 0;
      if (ordered[index]) {
        ordered[index].size = roundSize(ordered[index].size);
        (ordered[index] as { total?: number }).total = roundSize(runningTotal);
      }
    }
  } else {
    let runningTotal = 0;
    for (const level of ordered) {
      runningTotal += level.size;
      level.size = roundSize(level.size);
      (level as { total?: number }).total = roundSize(runningTotal);
    }
  }

  return ordered.map((level) => ({
    price: level.price,
    size: level.size,
    total: (level as { total?: number }).total ?? level.size,
  }));
}

function deriveMarkFromBook(asks: { price: number }[], bids: { price: number }[]) {
  const bestAsk = asks[0]?.price ?? null;
  const bestBid = bids[0]?.price ?? null;

  if (bestAsk !== null && bestBid !== null) {
    return (bestAsk + bestBid) / 2;
  }

  return bestAsk ?? bestBid;
}

function presentTrades(trades: PresentedTrade[]) {
  return trades
    .map((trade) => ({
      price: Number(trade.spot_contract?.ui_intent.price ?? trade.price),
      side: trade.spot_contract?.ui_intent.side ?? trade.aggressor_side,
      // Spot sizes are USDC notional and can be fractional (e.g. a 0.073 USDC smoke trade),
      // so they keep 3 decimals rather than being rounded to whole units.
      size: Number(Number(trade.spot_contract?.ui_intent.size ?? trade.size).toFixed(3)),
      time: new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        timeZone: "UTC",
      }).format(new Date(trade.created_at)),
    }))
    .filter(
      (trade) =>
        Number.isFinite(trade.price) &&
        trade.price > 0 &&
        Number.isFinite(trade.size) &&
        trade.size > 0
    ) satisfies TradePrint[];
}

/**
 * The spot market the terminal renders, built entirely from what markets-service served.
 *
 * There is no preview or sample fallback: when the venue is unreachable or has no resting orders,
 * every panel renders its empty state. Substituting invented depth here is worse than an empty
 * book — a trader cannot tell the difference, and the prices would be ones nothing can fill at.
 */
export function buildSpotMarket(liveSpot: LiveSpotRuntime | null): SpotMarket {
  if (!liveSpot) {
    return EMPTY_SPOT_MARKET;
  }

  // Spot presents in UI orientation (cNGN per USDC price, USDC size) while the engine
  // book rests inverted (USDC per cNGN, cNGN amounts). A resting engine ASK (sell cNGN)
  // is a UI BUY of USDC, so the engine book's asks are the UI bids and vice versa;
  // buildLiveBookSide already reads the spot_contract.ui_intent presentation.
  const orderBookBids = buildLiveBookSide(liveSpot.book?.asks ?? [], "bid");
  const orderBookAsks = buildLiveBookSide(liveSpot.book?.bids ?? [], "ask");
  const trades = presentTrades(liveSpot.trades);

  return {
    candles: liveSpot.candles ?? [],
    mark: deriveMarkFromBook(orderBookAsks, orderBookBids) ?? trades[0]?.price ?? null,
    openOrders: collectOpenOrders(liveSpot.book),
    orderBookAsks,
    orderBookBids,
    // Taken from the venue rather than assumed: it is what tells the stream to invert engine values.
    orderEntrySpec: liveSpot.book?.market_presentation?.order_entry_spec ?? null,
    trades,
  };
}
