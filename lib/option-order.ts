import type { OptionOverviewRow } from "@/lib/option-chain";

/**
 * An option order in the venue's terms. The price is the premium in USDC per cNGN; the size is cNGN, in whole
 * venue units (`unitBase`, 1,000 cNGN), each signed as `amount_scale`. A buyer pays premium and fee in cash; the
 * ticket sells only to close, since the venue takes no reduce-only order on an option and would let an oversized
 * sell write one, margined by the engine.
 */
export type OptionSide = "buy" | "sell";

/** How far through the touch a market order is signed. A premium moves further than its underlying. */
export const OPTION_DEFAULT_SLIPPAGE = 0.02;

/** The signed fee ceiling's room over the venue's rate, as the maker signs it. */
const FEE_CEILING_EXTRA_BPS = 5;

const BPS = 10_000;

export function optionTouch(row: Pick<OptionOverviewRow, "ask" | "bid">, side: OptionSide) {
  return side === "buy" ? row.ask : row.bid;
}

/**
 * The limit a market order is signed at, through the touch by `slippage`. Not `getMarketableLimitPrice`, whose
 * rounding suits a spot price: a premium's precision is in its last places.
 */
export function optionMarketLimit(
  row: Pick<OptionOverviewRow, "ask" | "bid">,
  side: OptionSide,
  slippage: number
) {
  const touch = optionTouch(row, side);
  if (touch === null || !(touch > 0)) {
    return null;
  }
  return side === "buy" ? touch * (1 + slippage) : touch * (1 - slippage);
}

/** A premium as the decimal string an order is signed from: never exponent notation. */
export function optionPriceString(price: number) {
  return price.toFixed(12);
}

/**
 * The fee ceiling signed into an order, 18 decimals per base unit. The TradeModule compares it with fee / amount,
 * and the fee is charged on the fill's premium. A buy fills at or under its limit; a sell can fill above its limit,
 * at a bid higher than it, so its ceiling is taken at the higher of the two.
 */
export function optionWorstFeeUnits({
  bestBid,
  limit,
  side,
  takerFeeBps,
}: {
  bestBid: number | null;
  limit: number;
  side: OptionSide;
  takerFeeBps: number;
}) {
  const ceiling = side === "sell" ? Math.max(limit, bestBid ?? 0) : limit;
  return BigInt(Math.ceil((ceiling * (takerFeeBps + FEE_CEILING_EXTRA_BPS) * 1e18) / BPS));
}

/** A size in cNGN as whole venue units, or null unless it is a positive whole number of them. */
export function optionOrderUnits(size: number, unitBase: number | null) {
  if (unitBase === null || !Number.isFinite(size) || size <= 0) {
    return null;
  }
  const units = size / unitBase;
  const whole = Math.round(units);
  return whole >= 1 && Math.abs(units - whole) < 1e-9 ? whole : null;
}

/** Why no order can be placed on this strike now, or null when one can. */
export function optionTradingBlock(row: OptionOverviewRow, nowMs: number) {
  if (row.lastTradeAtMs !== null && nowMs >= row.lastTradeAtMs) {
    return "Past the last trade time: the venue takes no new orders on this series.";
  }
  if (!row.tradingOpen) {
    return "The venue is not matching this series right now.";
  }
  return null;
}

/** Why a typed limit cannot be signed, or null. A put can never pay more than its strike. */
export function optionLimitError(row: OptionOverviewRow, limit: number | null) {
  if (limit === null) {
    return null;
  }
  return row.optionType === "put" && limit > row.strike
    ? `A put pays at most its strike, ${row.strikeLabel}.`
    : null;
}

/** The settlement price at expiry where a bought option returns `cost` per base unit. */
export function optionBreakeven(
  row: Pick<OptionOverviewRow, "optionType" | "strike">,
  cost: number
) {
  return row.optionType === "call" ? row.strike + cost : row.strike - cost;
}

function flooredToUnit(size: number, unitBase: number) {
  return Math.max(0, Math.floor(size / unitBase + 1e-9) * unitBase);
}

/** The premium, the fee on it, and what the order costs a buyer or brings a seller. */
function orderCost(
  size: number | null,
  price: number | null,
  side: OptionSide,
  takerFeeBps: number | null
) {
  if (size === null || price === null) {
    return { fee: null, premium: null, total: null };
  }
  const premium = size * price;
  const fee = takerFeeBps === null ? null : (premium * takerFeeBps) / BPS;
  return { fee, premium, total: side === "buy" ? premium + (fee ?? 0) : premium - (fee ?? 0) };
}

function maxBuySize(
  spendable: number | null,
  price: number | null,
  feeRate: number,
  unitBase: number
) {
  if (spendable === null || price === null || !(price > 0)) {
    return null;
  }
  return flooredToUnit(spendable / (price * (1 + feeRate)), unitBase);
}

/**
 * What an order does to the account, in USDC and cNGN, before it is signed. A buy needs its premium and fee in cash
 * and in initial margin surplus, the two checks the matcher makes for an account with no option to pair against. A
 * sell closes: at most the position less what already rests to sell it.
 */
export function estimateOptionOrder({
  cash,
  position,
  price,
  restingSells,
  side,
  size,
  surplus,
  takerFeeBps,
  unitBase,
}: {
  cash: number | null;
  /** Held now, signed, in cNGN. */
  position: number;
  price: number | null;
  /** Unfilled resting sells of this strike, in cNGN. */
  restingSells: number;
  side: OptionSide;
  size: number | null;
  surplus: number | null;
  takerFeeBps: number | null;
  unitBase: number | null;
}) {
  const feeRate = (takerFeeBps ?? 0) / BPS;
  const closable = Math.max(0, position - restingSells);
  const spendable = cash === null || surplus === null ? null : Math.min(cash, surplus);
  const maxBuy = maxBuySize(spendable, price, feeRate, unitBase ?? 1);
  const maxSize = side === "buy" ? maxBuy : flooredToUnit(closable, unitBase ?? 1);
  const { fee, premium, total } = orderCost(size, price, side, takerFeeBps);
  const shortfall =
    side === "buy" && total !== null && spendable !== null ? Math.max(0, total - spendable) : 0;
  return {
    closable,
    fee,
    maxSize,
    /** A sell above what the account can close would write the option. */
    oversold: side === "sell" && size !== null && size > closable + 1e-9,
    positionAfter: size === null ? position : position + (side === "buy" ? size : -size),
    premium,
    shortfall,
    total,
  };
}
