import type {
  BookSnapshotData,
  BookUpdateData,
  MarketStreamPresenter,
  StreamTrade,
} from "@/lib/market-stream.types";
import type { OrderBookLevel, TradePrint } from "@/lib/trading.types";

/** markets-service presents amounts and prices as fixed-point integer strings scaled by 18
 * decimals (matching the REST `/v1/book` fields the app already parses this way). */
const ATOMIC_DECIMALS = 18;

/** A resting order tracked in the client-side book, keyed by `order_id`. Prices and amounts are
 * held in engine units; presentation into UI units happens per market at render time. */
export type RestingOrder = {
  side: "buy" | "sell";
  price: number;
  open: number;
};

export type BookState = Map<string, RestingOrder>;

/**
 * Converts a fixed-point integer string (18 decimals) into a full-precision number. Unlike a
 * truncating parser, this keeps enough fraction digits for spot's sub-cent engine prices
 * (~0.000625 USDC per cNGN), which the UI later inverts back to ~1600 cNGN per USDC.
 */
export function parseAtomic(value: string | null | undefined, decimals = ATOMIC_DECIMALS): number {
  const normalized = (value ?? "").trim();

  if (!normalized) {
    return 0;
  }

  const negative = normalized.startsWith("-");
  const digits = (negative ? normalized.slice(1) : normalized).replace(/\D/g, "");

  if (!digits) {
    return 0;
  }

  const padded = digits.padStart(decimals + 1, "0");
  const whole = padded.slice(0, padded.length - decimals);
  const fraction = padded.slice(padded.length - decimals);
  const parsed = Number(`${whole}.${fraction}`);

  return negative ? -parsed : parsed;
}

/** Rebuilds book state from a `snapshot` frame, replacing any prior state. */
export function applyBookSnapshot(snapshot: BookSnapshotData): BookState {
  const state: BookState = new Map();
  const orders = [...(snapshot.bids ?? []), ...(snapshot.asks ?? [])];

  for (const order of orders) {
    const open = parseAtomic(order.desired_amount) - parseAtomic(order.filled_amount);

    if (open > 0) {
      state.set(order.order_id, {
        open,
        price: parseAtomic(order.limit_price),
        side: order.side,
      });
    }
  }

  return state;
}

/** Applies one `book` update (a per-order resting-size delta) in place. */
export function applyBookDelta(state: BookState, delta: BookUpdateData): void {
  const open = parseAtomic(delta.order_open);

  if (open <= 0) {
    state.delete(delta.order_id);
    return;
  }

  state.set(delta.order_id, {
    open,
    price: parseAtomic(delta.limit_price),
    side: delta.side,
  });
}

/**
 * Translates an engine price/amount pair into the UI's display convention.
 *
 * - **Future** (`DisplayPriceDirect`): price is shown as-is; size is contracts × multiplier.
 * - **Spot** (`usdc_cngn_spot_v1`): UI price is cNGN-per-USDC = 1 / engine price, and UI size is
 *   USDC notional = engine cNGN amount × engine price (the inverse of the documented
 *   `engine_amount = ui_size * ui_price` contract).
 */
function presentQuote(enginePrice: number, engineAmount: number, presenter: MarketStreamPresenter) {
  if (presenter.type === "spot") {
    if (enginePrice <= 0) {
      return { price: 0, size: 0 };
    }

    return { price: 1 / enginePrice, size: engineAmount * enginePrice };
  }

  return { price: enginePrice, size: engineAmount * presenter.contractMultiplier };
}

/** Aggregation key so orders at the same displayed (2-dp) price collapse into one ladder level. */
function priceKey(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * Builds one side of the display ladder from book state: presents each resting order, aggregates
 * by displayed price, sorts, and computes cumulative depth. Cumulative-total conventions mirror
 * the existing REST book mapper so bar widths render identically.
 */
export function buildBookSide(
  state: BookState,
  side: "ask" | "bid",
  presenter: MarketStreamPresenter,
): OrderBookLevel[] {
  const bookSide = side === "ask" ? "sell" : "buy";
  const sizeByPrice = new Map<number, number>();

  for (const order of state.values()) {
    if (order.side !== bookSide) {
      continue;
    }

    const { price, size } = presentQuote(order.price, order.open, presenter);

    if (!(Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0)) {
      continue;
    }

    const key = priceKey(price);
    sizeByPrice.set(key, (sizeByPrice.get(key) ?? 0) + size);
  }

  const ordered = [...sizeByPrice.entries()]
    .map(([price, size]) => ({ price, size, total: 0 }))
    .sort((left, right) => (side === "ask" ? left.price - right.price : right.price - left.price));

  if (side === "ask") {
    let runningTotal = 0;
    for (let index = ordered.length - 1; index >= 0; index -= 1) {
      const level = ordered[index];
      if (level) {
        runningTotal += level.size;
        level.size = Math.round(level.size);
        level.total = Math.round(runningTotal);
      }
    }
  } else {
    let runningTotal = 0;
    for (const level of ordered) {
      runningTotal += level.size;
      level.size = Math.round(level.size);
      level.total = Math.round(runningTotal);
    }
  }

  return ordered;
}

/** Presents a stream trade into the UI `TradePrint` shape. */
export function presentStreamTrade(
  trade: StreamTrade,
  presenter: MarketStreamPresenter,
): TradePrint | null {
  const { price, size } = presentQuote(parseAtomic(trade.price), parseAtomic(trade.size), presenter);

  if (!(Number.isFinite(price) && price > 0 && Number.isFinite(size) && size > 0)) {
    return null;
  }

  const time = trade.created_at
    ? new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        timeZone: "UTC",
      }).format(new Date(trade.created_at))
    : "";

  return { price, side: trade.aggressor_side, size: Math.round(size), time };
}
