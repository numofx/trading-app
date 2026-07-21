import type {
  BookSnapshotData,
  BookUpdateData,
  MarketStreamPresenter,
  StreamBookOrder,
  StreamTrade,
} from "@/lib/market-stream.types";
import type { OrderBookLevel, TradePrint } from "@/lib/trading.types";

/**
 * A resting order in the client book, keyed by `order_id`, already translated into the UI's
 * display units (cNGN-per-USDC price, USDC-notional size). Snapshot and delta frames are both
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
 * Translates an engine limit price + resting amount into the UI's display convention.
 *
 * - **Future** (`DisplayPriceDirect`): price shown as-is; size is contracts × multiplier.
 * - **Spot**: UI price is cNGN-per-USDC = 1 / engine price, and UI size is USDC notional = engine
 *   cNGN amount × engine price (inverse of the documented `engine_amount = ui_size * ui_price`).
 */
function toUiQuote(
  engineLimitPrice: number,
  restingAmount: number,
  presenter: MarketStreamPresenter,
): { price: number; size: number } | null {
  if (presenter.type === "spot") {
    if (engineLimitPrice <= 0) {
      return null;
    }
    return { price: 1 / engineLimitPrice, size: restingAmount * engineLimitPrice };
  }

  return { price: engineLimitPrice, size: restingAmount * presenter.contractMultiplier };
}

/** Normalizes a snapshot order into a UI resting order, preferring spot's server-computed
 * `ui_intent` when present. Returns null if the order has no positive price/size. */
function presentSnapshotOrder(
  order: StreamBookOrder,
  presenter: MarketStreamPresenter,
): RestingOrder | null {
  const uiIntent = presenter.type === "spot" ? order.spot_contract?.ui_intent : undefined;
  const quote = uiIntent
    ? { price: parseDecimal(uiIntent.price), size: parseDecimal(uiIntent.size) }
    : toUiQuote(
        parseDecimal(order.limit_price),
        parseDecimal(order.desired_amount) - parseDecimal(order.filled_amount),
        presenter,
      );

  if (!(quote && quote.price > 0 && quote.size > 0)) {
    return null;
  }

  return { price: quote.price, side: order.side, size: quote.size };
}

/** Rebuilds book state from a `snapshot` frame, replacing any prior state. */
export function applyBookSnapshot(
  snapshot: BookSnapshotData,
  presenter: MarketStreamPresenter,
): BookState {
  const state: BookState = new Map();

  for (const order of [...(snapshot.bids ?? []), ...(snapshot.asks ?? [])]) {
    const resting = presentSnapshotOrder(order, presenter);
    if (resting) {
      state.set(order.order_id, resting);
    }
  }

  return state;
}

/** Applies one `book` update (a per-order resting-size delta) in place. */
export function applyBookDelta(
  state: BookState,
  delta: BookUpdateData,
  presenter: MarketStreamPresenter,
): void {
  const resting = parseDecimal(delta.order_open);
  const quote = resting > 0 ? toUiQuote(parseDecimal(delta.limit_price), resting, presenter) : null;

  if (!(quote && quote.price > 0 && quote.size > 0)) {
    state.delete(delta.order_id);
    return;
  }

  state.set(delta.order_id, { price: quote.price, side: delta.side, size: quote.size });
}

/** Aggregation key so orders at the same displayed (2-dp) price collapse into one ladder level. */
function priceKey(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * Builds one side of the display ladder from book state: aggregates by displayed price, sorts, and
 * computes cumulative depth. Cumulative-total conventions mirror the REST book mapper so bar widths
 * render identically.
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
  const quote = toUiQuote(parseDecimal(trade.price), parseDecimal(trade.size), presenter);

  if (!(quote && quote.price > 0 && quote.size > 0)) {
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

  return { price: quote.price, side: trade.aggressor_side, size: Math.round(quote.size), time };
}
