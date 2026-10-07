import { PRICE_DECIMALS } from "@/lib/market-formatting";
import type {
  BookSnapshotData,
  BookUpdateData,
  StreamBookOrder,
  StreamTrade,
} from "@/lib/market-stream.types";
import type { OrderBookLevel, TradePrint } from "@/lib/trading.types";

/**
 * A resting order in the client book, keyed by `order_id`, in the units the terminal shows, which
 * are the engine's own: USDC per cNGN, sized in cNGN. Snapshot and delta frames are both
 * normalized to this shape at ingestion so aggregation stays market-agnostic.
 */
export type RestingOrder = {
  side: "buy" | "sell";
  price: number;
  size: number;
};

export type BookState = Map<string, RestingOrder>;

/**
 * markets-service presents prices and amounts as plain human-readable decimal strings (e.g.
 * `limit_price:"1377"`, `desired_amount:"28"`), not fixed-point atomic integers — the presenter
 * applies the instrument's tick/step, so no client-side rescaling is needed.
 */
export function parseDecimal(value: string | null | undefined): number {
  const parsed = Number((value ?? "").trim().replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Normalizes a snapshot order into a resting order: the engine's price and what is left of its
 * amount. Returns null if the order has no positive price/size.
 */
function presentSnapshotOrder(order: StreamBookOrder): RestingOrder | null {
  const price = parseDecimal(order.limit_price);
  const size = parseDecimal(order.desired_amount) - parseDecimal(order.filled_amount);

  if (!(price > 0 && size > 0)) {
    return null;
  }

  return { price, side: order.side, size };
}

/** Rebuilds book state from a `snapshot` frame, replacing any prior state. */
export function applyBookSnapshot(snapshot: BookSnapshotData): BookState {
  const state: BookState = new Map();

  for (const order of [...(snapshot.bids ?? []), ...(snapshot.asks ?? [])]) {
    const resting = presentSnapshotOrder(order);
    if (resting) {
      state.set(order.order_id, resting);
    }
  }

  return state;
}

/** Applies one `book` update (a per-order resting-size delta) in place. */
export function applyBookDelta(state: BookState, delta: BookUpdateData): void {
  const size = parseDecimal(delta.order_open);
  const price = parseDecimal(delta.limit_price);

  if (!(size > 0 && price > 0)) {
    state.delete(delta.order_id);
    return;
  }

  state.set(delta.order_id, { price, side: delta.side, size });
}

const PRICE_KEY_SCALE = 10 ** PRICE_DECIMALS;

/** Aggregation key so orders at the same displayed price collapse into one ladder level. */
function priceKey(price: number): number {
  return Math.round(price * PRICE_KEY_SCALE) / PRICE_KEY_SCALE;
}

/**
 * Sizes are cNGN. A partly filled order's remainder can be fractional, so sizes keep 3 decimals
 * rather than being rounded to whole units, which displayed sub-unit levels as "0".
 */
function roundSize(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * Builds one side of the display ladder from book state: aggregates by displayed price, sorts, and
 * computes cumulative depth from the touch outward. Cumulative-total conventions mirror the REST
 * book mapper so bar widths render identically.
 */
export function buildBookSide(state: BookState, side: "ask" | "bid"): OrderBookLevel[] {
  const bookSide = side === "ask" ? "sell" : "buy";
  const sizeByPrice = new Map<number, number>();

  for (const order of state.values()) {
    if (order.side !== bookSide) {
      continue;
    }
    const key = priceKey(order.price);
    sizeByPrice.set(key, (sizeByPrice.get(key) ?? 0) + order.size);
  }

  const ordered = [...sizeByPrice.entries()]
    .map(([price, size]) => ({ price, size, total: 0 }))
    .sort((left, right) => (side === "ask" ? left.price - right.price : right.price - left.price));

  let runningTotal = 0;
  for (const level of ordered) {
    runningTotal += level.size;
    level.size = roundSize(level.size);
    level.total = roundSize(runningTotal);
  }

  return ordered;
}

/** Presents a stream trade into the UI `TradePrint` shape: the engine's price, side and cNGN size. */
export function presentStreamTrade(trade: StreamTrade): TradePrint | null {
  const price = parseDecimal(trade.price);
  const size = parseDecimal(trade.size);

  if (!(price > 0 && size > 0)) {
    return null;
  }

  const time = trade.created_at
    ? new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        second: "2-digit",
        timeZone: "UTC",
      }).format(new Date(trade.created_at))
    : "";
  const atMs = trade.created_at ? Date.parse(trade.created_at) : Number.NaN;

  return {
    ...(Number.isFinite(atMs) ? { atMs } : {}),
    ...(trade.tx_hash ? { txHash: trade.tx_hash } : {}),
    id: trade.trade_id,
    price,
    side: trade.aggressor_side,
    // Three decimals on every market, as the REST trade mapper and the order book print sizes.
    size: Number(size.toFixed(3)),
    time,
  };
}
