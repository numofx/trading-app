import { PRICE_DECIMALS } from "@/lib/market-formatting";
import type { BookResponse, PresentedTrade, TradeStats24h } from "@/lib/markets-service";
import type {
  Candle,
  OrderBookLevel,
  SpotMarket,
  SpotOpenOrder,
  Stats24h,
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
 * The largest order, in cNGN, the trading account can currently fund.
 *
 * A buy spends USDC, so the ceiling is the USDC balance converted at the order's price; a sell
 * spends the cNGN directly. Null whenever the balance is unknown or there is no price to convert at —
 * the ticket's size slider goes inert rather than sliding against a guessed ceiling.
 */
export function getMaxOrderSize({
  availableCngn,
  availableUsdc,
  feeRate = 0,
  isBuy,
  price,
}: {
  availableCngn: number | null;
  availableUsdc: number | null;
  /**
   * The fee ceiling the order is signed with, as a fraction of its USDC notional. A buy pays its
   * fee in the USDC it is also spending, so the ceiling leaves that much of the balance unspent:
   * a 100% buy sized to the whole balance would have nothing left for the fee. A sell pays its
   * fee out of the USDC it receives, so its ceiling is unaffected.
   */
  feeRate?: number;
  isBuy: boolean;
  price: number | null;
}) {
  if (!isBuy) {
    return availableCngn;
  }

  if (availableUsdc === null || price === null || !Number.isFinite(price) || price <= 0) {
    return null;
  }

  return availableUsdc / (price * (1 + Math.max(0, feeRate)));
}

/**
 * What an order takes out of the account if it fills: USDC for a buy, cNGN for a sell.
 *
 * Null when either input is unusable — an unknown cost must not read as a free order.
 */
export function getOrderCost(side: "buy" | "sell", price: number | null, size: number) {
  if (!Number.isFinite(size) || size <= 0) {
    return null;
  }
  if (side === "sell") {
    return { amount: size, currency: "cNGN" as const };
  }
  if (price === null || !Number.isFinite(price) || price <= 0) {
    return null;
  }
  return { amount: size * price, currency: "USDC" as const };
}

/**
 * The orders still working at `nowMs`, dropping any the venue has already expired.
 *
 * The book arrives as a server-rendered snapshot and orders leave it on a timer, so a page that
 * does not re-render keeps counting dead orders — which held `Available` down by the cost of an
 * order that had already expired. `nowMs` of 0 means "not yet known" (the first client render,
 * before an effect supplies the clock) and ages nothing out, so hydration matches the server.
 */
export function getWorkingOrders(openOrders: SpotOpenOrder[], nowMs: number) {
  if (nowMs <= 0) {
    return openOrders;
  }

  return openOrders.filter((order) => order.expiresAtMs === null || order.expiresAtMs > nowMs);
}

/**
 * Drops orders the trader has just cancelled but the server snapshot has not caught up to yet.
 *
 * A cancel takes effect on the venue the moment it is accepted, but `openOrders` is a
 * server-rendered snapshot that only changes on the next render. The `router.refresh()` fired right
 * after a cancel can race the venue's own book update and return still listing the order, and
 * nothing retries — so without this overlay the order's cost stayed reserved against `Available`,
 * and its row stayed in Open Orders, until it aged out at `expiresAtMs`. Applying it before both
 * the balance and the Open Orders computation makes `Available` recover and the row disappear at
 * once. `cancelledNonces` is reconciled away by the caller once the snapshot stops listing the
 * nonce, so the overlay is a no-op again as soon as the server agrees.
 */
export function withoutCancelledOrders(
  openOrders: SpotOpenOrder[],
  cancelledNonces: ReadonlySet<string>
) {
  if (cancelledNonces.size === 0) {
    return openOrders;
  }
  return openOrders.filter((order) => !cancelledNonces.has(order.nonce));
}

/** When the soonest of these orders expires, so a caller can re-render exactly then. */
export function getNextExpiryMs(openOrders: SpotOpenOrder[]) {
  const expiries = openOrders
    .map((order) => order.expiresAtMs)
    .filter((expiry): expiry is number => expiry !== null);

  return expiries.length === 0 ? null : Math.min(...expiries);
}

/**
 * What this trader's own resting orders already lay claim to.
 *
 * A balance that ignores working orders overstates what a new order can spend: an account holding
 * 1,300 cNGN with 1,382 already committed can fund nothing, but reads as fully available.
 */
export function getCommittedBalances(openOrders: SpotOpenOrder[], walletAddress: string | null) {
  const owned =
    walletAddress === null
      ? []
      : openOrders.filter(
          (order) => order.ownerAddress.toLowerCase() === walletAddress.toLowerCase()
        );

  let cngn = 0;
  let usdc = 0;
  for (const order of owned) {
    const remaining = Math.max(0, order.size - order.filled);
    const cost = getOrderCost(order.side, order.price, remaining);
    if (cost?.currency === "cNGN") {
      cngn += cost.amount;
    } else if (cost?.currency === "USDC") {
      usdc += cost.amount;
    }
  }

  return { cngn, usdc };
}

/**
 * The price a market order crosses at: the opposing touch. A buy of cNGN lifts the best ask, a
 * sell hits the best bid. Null when that side is empty — there is nothing to cross.
 */
/**
 * How far through the touch a market order is priced. 0.5%.
 *
 * Not slippage the trader pays: this venue fills at the resting maker's price, so a buy signed at
 * ask + 0.5% still executes at the ask. It is the room the order has to still cross if the book
 * moves between the price being read and the engine matching.
 */
export const SPOT_MARKET_SLIPPAGE = 0.005;

/**
 * The price a market order's USDC-denominated entry is converted to cNGN at: where it is expected
 * to fill, held inside the signed limit.
 *
 * The order is sized in cNGN, so a trader who types a USDC amount only spends that much if the
 * conversion uses the fill price. Converted at the signed limit — the touch plus slippage room —
 * the order would be sized for the slippage room too. Held at the limit because a size converted
 * past it is exactly that inflated amount. Null when either price is unusable, rather than falling
 * back to the limit.
 */
export function getMarketSizingPrice(
  side: "buy" | "sell",
  expectedPrice: number | null,
  limitPrice: number | null
) {
  if (limitPrice === null || !Number.isFinite(limitPrice) || limitPrice <= 0) {
    return null;
  }
  if (expectedPrice === null || !Number.isFinite(expectedPrice) || expectedPrice <= 0) {
    return null;
  }

  return side === "buy" ? Math.min(expectedPrice, limitPrice) : Math.max(expectedPrice, limitPrice);
}

/**
 * The trader's own resting order that an order about to be signed would trade against, if any.
 *
 * The venue cannot settle a trade between two orders on one account — SubAccounts refuses to move an
 * asset from an account to itself (`AC_CannotTransferAssetToOneself`) — and until the matcher skips
 * such a pair (numofx/exchange#50) it retries it every five minutes while both orders lock the top of
 * the book. That happened on 2026-09-13 with a 1,346.18 buy and sell on one account.
 *
 * Judged at the price the order is signed at, which is where the matcher would cross it: a buy
 * crosses a resting sell at or below it, a sell a resting buy at or above it. Returns the nearest
 * such order — the one that would be hit first.
 */
export function findOwnCrossingOrder({
  ownOrders,
  side,
  signedPrice,
}: {
  /** The connected wallet's own working orders, already filtered to its owner address. */
  ownOrders: readonly SpotOpenOrder[];
  side: "buy" | "sell";
  signedPrice: number | null;
}) {
  if (signedPrice === null || !Number.isFinite(signedPrice) || signedPrice <= 0) {
    return null;
  }

  let nearest: SpotOpenOrder | null = null;
  for (const order of ownOrders) {
    if (order.side === side || !Number.isFinite(order.price)) {
      continue;
    }
    const crosses = side === "buy" ? order.price <= signedPrice : order.price >= signedPrice;
    if (!crosses) {
      continue;
    }
    const nearer =
      nearest === null ||
      (side === "buy" ? order.price < nearest.price : order.price > nearest.price);
    if (nearer) {
      nearest = order;
    }
  }
  return nearest;
}

/**
 * The limit price a market order is signed at: through the opposing touch, not at it.
 *
 * Priced exactly at the touch, a market order stops being marketable the moment the quote moves —
 * it rests as an ordinary limit and expires unfilled, which is what happened to a market sell
 * signed at a bid of 1374.02 that the maker had already left. Pricing through the book is how a
 * marketable order works on a limit-order-book engine.
 */
export function getMarketableLimitPrice(
  side: "buy" | "sell",
  bestAsk: number | null,
  bestBid: number | null,
  tolerance: number = SPOT_MARKET_SLIPPAGE
) {
  const touch = getCrossingPrice(side, bestAsk, bestBid);

  if (touch === null || !Number.isFinite(touch) || touch <= 0) {
    return null;
  }

  const priced = side === "buy" ? touch * (1 + tolerance) : touch * (1 - tolerance);
  return Number(priced.toFixed(PRICE_DECIMALS));
}

export function getCrossingPrice(
  side: "buy" | "sell",
  bestAsk: number | null,
  bestBid: number | null
) {
  return side === "buy" ? bestAsk : bestBid;
}

/**
 * What a market order of `size` cNGN would actually fill at, walked level by level through the
 * depth on screen.
 *
 * A market order does not trade at the touch — it trades at the touch and then at every level
 * behind it until it is filled, so on a thin book the price a trader gets can sit well past the
 * one the ticket quoted. The touch alone understates that, which is exactly the case where the
 * trader most needs to know.
 *
 * `averagePrice` is the size-weighted mean over the levels the order would consume, and is null
 * when nothing on that side can fill. `filledSize` is how much of the order the resting depth
 * covers: less than `size` means the remainder rests as a limit at the marketable price rather
 * than filling, which is the venue's behaviour and not an error.
 */
export function getMarketFill(
  side: "buy" | "sell",
  asks: OrderBookLevel[],
  bids: OrderBookLevel[],
  size: number
) {
  // A buy lifts the asks, a sell hits the bids. Both arrays run from the touch outward, so the
  // walk is in array order on either side.
  const levels = side === "buy" ? asks : bids;

  if (!Number.isFinite(size) || size <= 0) {
    return { averagePrice: null, filledSize: 0, isFullyFilled: false };
  }

  let remaining = size;
  let filledSize = 0;
  let cost = 0;

  for (const level of levels) {
    const taken = Math.min(remaining, level.size);
    cost += taken * level.price;
    filledSize += taken;
    remaining -= taken;
    if (remaining <= 0) {
      break;
    }
  }

  return {
    averagePrice: filledSize > 0 ? cost / filledSize : null,
    filledSize,
    isFullyFilled: filledSize >= size,
  };
}

/**
 * An order's size in cNGN, whichever currency the trader entered it in.
 *
 * The Size field can be denominated in either leg — cNGN, the amount the order is signed for, or
 * USDC, what the trader is spending or receiving. Only the cNGN figure is submittable, so a USDC
 * entry is converted at the price the order would cross at. NaN when there is no price to convert
 * with, rather than a size derived from a guess.
 */
export function toOrderSizeCngn(amount: number, unit: "USDC" | "cNGN", price: number | null) {
  if (!Number.isFinite(amount)) {
    return Number.NaN;
  }
  if (unit === "cNGN") {
    return amount;
  }
  return price === null || price <= 0 ? Number.NaN : amount / price;
}

export type LiveSpotRuntime = {
  book: BookResponse | null;
  /** Real OHLCV from markets-service; empty when the market has not traded yet. */
  candles?: Candle[];
  /** markets-service's trailing-24h `stats_24h`. Null when the service did not report stats. */
  stats24h?: TradeStats24h | null;
  trades: PresentedTrade[];
  /** The market's asset and TradeModule as `/v1/markets` serves them; see SpotMarket.orderStack. */
  orderStack?: SpotMarket["orderStack"];
};

/** A market the venue serves no data for. Rendered as empty panels, never as sample depth. */
const EMPTY_SPOT_MARKET: SpotMarket = {
  candles: [],
  mark: null,
  openOrders: [],
  orderBookAsks: [],
  orderBookBids: [],
  orderEntrySpec: null,
  orderStack: null,
  stats24h: null,
  takerFeeBps: null,
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
      if (intent === undefined) {
        // Every field below would otherwise be an engine value wearing a UI label: the price
        // rendered as ₦0.0007 instead of ₦1,374, the size as 1,374 USDC instead of 1. The old
        // fallback read the engine fields and presented them as though they were UI ones, which is
        // a wrong number rather than a missing row. No spot order has ever arrived without this
        // presentation, so dropping it costs nothing real — but it must not do so quietly.
        console.warn("dropping an open order with no ui_intent presentation", {
          nonce: order.nonce,
          orderId: order.order_id,
        });
        return null;
      }
      const expiry = Number(order.expiry);
      // filled_amount is engine cNGN, the same unit as `size`: what `size - filled` reserves and
      // what the Filled cell prints.
      const filledEngine = Number(order.filled_amount ?? "0");
      const filled = Number.isFinite(filledEngine) ? filledEngine : 0;
      return {
        expiresAtMs: Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : null,
        filled,
        nonce: order.nonce ?? "",
        orderId: order.order_id ?? "",
        ownerAddress: order.owner_address ?? "",
        price: Number(intent.price),
        side: intent.side,
        size: Number(intent.size),
      };
    })
    .filter((order): order is SpotOpenOrder => order !== null)
    .filter(
      (order) =>
        order.ownerAddress !== "" &&
        order.nonce !== "" &&
        Number.isFinite(order.price) &&
        Number.isFinite(order.size)
    );
}

/**
 * Sizes are cNGN. The engine rests whole cNGN, but the venue presents what a partly filled order
 * has left to three decimals, so the ladder keeps those rather than rounding a sub-unit remainder
 * to "0".
 */
function roundSize(value: number) {
  return Math.round(value * 1000) / 1000;
}

function buildLiveBookSide(items: NonNullable<BookResponse["asks"]>, side: "ask" | "bid") {
  const levels = items
    .map((item) => ({
      // markets-service presents prices/amounts as plain human decimals (e.g. "0.00073", "28"),
      // not fixed-point atomic. Levels carry a `spot_contract.ui_intent` presentation, which under
      // the identity contract equals the engine fields; those are the fallback.
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

  // Cumulative depth runs from the touch outward on both sides, so a level's `total` is what a
  // marketable order sweeping to that price would take. Asks used to accumulate from the far end,
  // which put the whole side's depth on the best ask and its own size on the worst.
  let runningTotal = 0;
  for (const level of ordered) {
    runningTotal += level.size;
    level.size = roundSize(level.size);
    (level as { total?: number }).total = roundSize(runningTotal);
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
      atMs: Date.parse(trade.created_at),
      id: trade.trade_id,
      ...(trade.tx_hash ? { txHash: trade.tx_hash } : {}),
      price: Number(trade.spot_contract?.ui_intent.price ?? trade.price),
      side: trade.spot_contract?.ui_intent.side ?? trade.aggressor_side,
      // Sizes are cNGN; a partial fill can be fractional, so they keep 3 decimals.
      size: Number(Number(trade.spot_contract?.ui_intent.size ?? trade.size).toFixed(3)),
      time: new Intl.DateTimeFormat("en-US", {
        hour: "2-digit",
        hour12: false,
        minute: "2-digit",
        second: "2-digit",
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

/** A positive decimal, or null for anything else — an empty field is "nothing traded", not zero. */
function positiveDecimal(value: string | undefined) {
  if (value === undefined || value.trim() === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function positiveOrNull(value: number | null) {
  return value !== null && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * markets-service's `stats_24h` in the terms the header shows.
 *
 * The venue reports engine prices (USDC per cNGN, the orientation shown) and a change (last minus
 * the window's first price). The window's first price is recovered as last minus change. Volume is
 * the quote-asset notional (USDC), never the cNGN size sum.
 */
export function presentStats24h(stats: LiveSpotRuntime["stats24h"]): Stats24h | null {
  if (!stats) {
    return null;
  }
  const last = positiveDecimal(stats.last);
  const change =
    stats.change === undefined || stats.change.trim() === "" ? Number.NaN : Number(stats.change);
  const first = last !== null && Number.isFinite(change) ? last - change : null;

  return {
    firstPrice: positiveOrNull(first),
    high: positiveDecimal(stats.high),
    low: positiveDecimal(stats.low),
    quoteVolume: positiveDecimal(stats.quote_volume),
  };
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

  // The book is shown as the engine rests it: cNGN bids and asks at USDC per cNGN.
  const orderBookBids = buildLiveBookSide(liveSpot.book?.bids ?? [], "bid");
  const orderBookAsks = buildLiveBookSide(liveSpot.book?.asks ?? [], "ask");
  const trades = presentTrades(liveSpot.trades);

  return {
    candles: liveSpot.candles ?? [],
    mark: deriveMarkFromBook(orderBookAsks, orderBookBids) ?? trades[0]?.price ?? null,
    openOrders: collectOpenOrders(liveSpot.book),
    orderBookAsks,
    orderBookBids,
    // Taken from the venue rather than assumed: every order is signed under it.
    orderEntrySpec: liveSpot.book?.market_presentation?.order_entry_spec ?? null,
    orderStack: liveSpot.orderStack ?? null,
    stats24h: presentStats24h(liveSpot.stats24h),
    takerFeeBps: liveSpot.book?.market_presentation?.taker_fee_bps ?? null,
    trades,
  };
}
