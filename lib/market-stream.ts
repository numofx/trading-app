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
 * The one order-entry contract whose engine values are inverted relative to the UI. markets-service
 * sets `order_entry_spec` only for this contract; every other market presents engine values directly.
 */
const SPOT_TRANSLATION_SPEC = "usdc_cngn_spot_v1";

/**
 * Whether this market's engine values need the USDC/cNGN inversion.
 *
 * Keyed on the spec rather than `type === "spot"` deliberately. The inversion is a property of
 * `usdc_cngn_spot_v1`, not of spot as a class — applying it to a normally-oriented spot market
 * would file every order into the wrong ladder and read as a crossed book, which fails silently.
 */
function usesSpotTranslation(presenter: MarketStreamPresenter) {
  return presenter.orderEntrySpec === SPOT_TRANSLATION_SPEC;
}

/**
 * Translates an engine limit price + resting amount into the UI's display convention.
 *
 * - **`usdc_cngn_spot_v1`**: UI price is cNGN-per-USDC = 1 / engine price, and UI size is USDC
 *   notional = engine cNGN amount × engine price (inverse of `engine_amount = ui_size * ui_price`).
 * - **Everything else**: price shown as-is; size is the resting contract count.
 */
function toUiQuote(
  engineLimitPrice: number,
  restingAmount: number,
  presenter: MarketStreamPresenter
): { price: number; size: number } | null {
  if (usesSpotTranslation(presenter)) {
    if (engineLimitPrice <= 0) {
      return null;
    }
    return { price: 1 / engineLimitPrice, size: restingAmount * engineLimitPrice };
  }

  return { price: engineLimitPrice, size: restingAmount };
}

/**
 * Translates an engine order side into the UI's side.
 *
 * Under `usdc_cngn_spot_v1` the book rests inverted: the engine trades WRAPPED_CNGN against
 * internal USDC cash, so an engine BUY of cNGN is a UI SELL of USDC. Every other market displays
 * the engine side directly.
 *
 * This has to stay in step with the price/size inversion in `toUiQuote` — translating one without
 * the other files UI-priced orders into the wrong ladder, which reads as a crossed book.
 */
function toUiSide(engineSide: "buy" | "sell", presenter: MarketStreamPresenter): "buy" | "sell" {
  if (!usesSpotTranslation(presenter)) {
    return engineSide;
  }
  return engineSide === "buy" ? "sell" : "buy";
}

/** Normalizes a snapshot order into a UI resting order, preferring spot's server-computed
 * `ui_intent` when present. Returns null if the order has no positive price/size. */
function presentSnapshotOrder(
  order: StreamBookOrder,
  presenter: MarketStreamPresenter
): RestingOrder | null {
  const uiIntent = usesSpotTranslation(presenter) ? order.spot_contract?.ui_intent : undefined;
  const quote = uiIntent
    ? { price: parseDecimal(uiIntent.price), size: parseDecimal(uiIntent.size) }
    : toUiQuote(
        parseDecimal(order.limit_price),
        parseDecimal(order.desired_amount) - parseDecimal(order.filled_amount),
        presenter
      );

  if (!(quote && quote.price > 0 && quote.size > 0)) {
    return null;
  }

  return {
    price: quote.price,
    side: uiIntent?.side ?? toUiSide(order.side, presenter),
    size: quote.size,
  };
}

/** Rebuilds book state from a `snapshot` frame, replacing any prior state. */
export function applyBookSnapshot(
  snapshot: BookSnapshotData,
  presenter: MarketStreamPresenter
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
  presenter: MarketStreamPresenter
): void {
  const resting = parseDecimal(delta.order_open);
  const quote = resting > 0 ? toUiQuote(parseDecimal(delta.limit_price), resting, presenter) : null;

  if (!(quote && quote.price > 0 && quote.size > 0)) {
    state.delete(delta.order_id);
    return;
  }

  // Delta frames carry no `spot_contract`, so the side has to be inverted here rather than read
  // off a server-computed `ui_intent`.
  state.set(delta.order_id, {
    price: quote.price,
    side: toUiSide(delta.side, presenter),
    size: quote.size,
  });
}

/** Aggregation key so orders at the same displayed (2-dp) price collapse into one ladder level. */
function priceKey(price: number): number {
  return Math.round(price * 100) / 100;
}

/**
 * Spot depth is USDC notional and routinely fractional — a 0.4 USDC order is real resting depth.
 * Sizes keep 3 decimals (the venue's amount step) rather than being rounded to whole units, which
 * displayed sub-unit levels as "0".
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

/** Presents a stream trade into the UI `TradePrint` shape. */
export function presentStreamTrade(
  trade: StreamTrade,
  presenter: MarketStreamPresenter
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

  return {
    price: quote.price,
    side: toUiSide(trade.aggressor_side, presenter),
    // Keyed on `type`, not the spec: this is display precision, not the inversion. Any spot market
    // quotes a notional size that can be fractional (a 0.073 USDC trade rounds to 0), whereas
    // futures sizes are contract counts. Mirrors the REST trade mapper.
    size: presenter.type === "spot" ? Number(quote.size.toFixed(3)) : Math.round(quote.size),
    time,
  };
}
