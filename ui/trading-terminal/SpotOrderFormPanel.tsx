"use client";

import { useState } from "react";
import { formatBalance, formatBalanceFigure } from "@/lib/account-balance-display";
import { formatMarketPrice, formatUsdcPrice } from "@/lib/market-formatting";
import {
  findOwnCrossingOrder,
  getCrossingPrice,
  getMarketableLimitPrice,
  getMarketFill,
  getMarketSizingPrice,
  getOrderCost,
  SPOT_MARKET_SLIPPAGE,
  toOrderSizeBase,
} from "@/lib/spot-market";
import { SPOT_TAKER_FEE_RATE } from "@/lib/spot-order-submission";
import type { SpotOrientation } from "@/lib/spot-orientation";
import { spotOrientation } from "@/lib/spot-orientation";
import type { SpotBase, SpotPair } from "@/lib/spot-pairs";
import type { OrderBookLevel, SpotOpenOrder } from "@/lib/trading.types";
import { ConfirmOrderDialog } from "@/ui/trading-terminal/ConfirmOrderDialog";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";
import { AvailableRow } from "@/ui/trading-terminal/order-form/AvailableRow";
import { FormField } from "@/ui/trading-terminal/order-form/FormField";
import { OrderFormShell } from "@/ui/trading-terminal/order-form/OrderFormShell";
import { SideToggle } from "@/ui/trading-terminal/order-form/SideToggle";
import { SubmitButton } from "@/ui/trading-terminal/order-form/SubmitButton";
import { SummaryRow } from "@/ui/trading-terminal/order-form/SummaryRow";
import { TokenUnit, TokenUnitSelect } from "@/ui/trading-terminal/order-form/TokenUnit";

/*
 * No "Stop Limit". The signed envelope this ticket produces is a plain limit action — it carries
 * a limit price, size, side, fee bound, nonce and expiry, and the `Matching` contract has no
 * trigger field to hang a stop on. The tab used to be offered anyway: the stop price was collected
 * into state that nothing read, so submitting sent an ordinary limit order at the limit price and
 * discarded the stop. A trader setting downside protection got a resting order instead.
 *
 * Nor is there a "Post only" toggle or a time-in-force selector, for the same reason: the envelope
 * has no flag for either. Every control on this ticket changes the order that gets signed.
 */
type SpotOrderType = "Limit" | "Market";
type PayCurrency = SpotBase | "USDC";

const ORDER_TYPES = ["Market", "Limit"] as const satisfies readonly SpotOrderType[];

const SIDES = [
  { label: "Buy", tone: "buy", value: "buy" },
  { label: "Sell", tone: "sell", value: "sell" },
] as const;

/**
 * The units the Size field can be counted in, the displayed base first: the base a buy receives or
 * a sell delivers (cNGN, EURC), then the USDC that pays for it.
 * Whichever it is, the engine signs and rests the pair's base.
 */
function sizeUnits(pair: SpotPair): readonly PayCurrency[] {
  return [pair.displayBase, pair.displayQuote];
}

/** A signed decimal string as a number, or null without one. */
function toNumberOrNull(value: string | null) {
  return value === null ? null : Number(value);
}

/** The base the order is signed for, whole as the engine rests it; null before a size is entered. */
function toBaseLeg(sizeBase: number) {
  return Number.isFinite(sizeBase) ? Math.floor(sizeBase) : null;
}

/** A displayed price as the ticket shows it: USDC per cNGN to eight decimals, USDC per EURC to five. */
function formatSpotPrice(price: number | null, pair: SpotPair) {
  return formatMarketPrice(price, pair.priceDecimals);
}

/** The signed ceiling as basis points, derived from the rate the order is signed with. */
const SPOT_TAKER_FEE_BPS = Number(SPOT_TAKER_FEE_RATE) * 10_000;

/** The fee the venue will actually charge, from /v1/markets. Null means the service did not say. */
function venueFee(amountUsdc: number, takerFeeBps: number | null): number | null {
  if (takerFeeBps === null || !Number.isFinite(amountUsdc)) {
    return null;
  }
  return (amountUsdc * takerFeeBps) / 10_000;
}

/**
 * A USDC-per-base price as the decimal string an envelope or a field takes: ten places hold the
 * engine's resolution for any price these pairs trade at, and `toFixed` never falls into the
 * scientific notation `String(1e-7)` produces, which the envelope's parser rejects.
 */
function toPriceString(price: number) {
  return price.toFixed(10);
}

/**
 * The price sent with the order: the entered limit, or for a market order the price its size is
 * counted at — the expected fill. The terminal signs a market order's limit through the touch
 * itself, so this is never the limit for one.
 *
 * A market order once sent the last traded price, which on a quiet market is days old and can rest
 * past the touch — a "market" order priced behind the book does not cross, so it silently rests
 * as a limit instead of filling.
 */
function resolveOrderPrice({
  limitPrice,
  orderType,
  sizingPrice,
}: {
  limitPrice: string;
  orderType: SpotOrderType;
  sizingPrice: number | null;
}) {
  if (orderType !== "Market") {
    return limitPrice;
  }

  return sizingPrice === null ? "" : toPriceString(sizingPrice);
}

function parseAmount(value: string) {
  // An empty field is "not entered", not zero: `Number("")` is 0, which rendered a total of
  // "0 USDC" for an order with no price rather than leaving the row blank.
  if (value.trim() === "") {
    return Number.NaN;
  }

  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Copy and rows for the submit confirmation, in the trader's terms: a buy of cNGN or EURC pays
 * USDC; on an inverted pair a buy of USDC pays the base for it. In the engine's terms an engine buy always pays
 * USDC for the base. Lives outside the component so its branching does not count against the
 * panel's cognitive complexity budget.
 */
function buildSpotConfirmation({
  baseLabel,
  engineSide,
  isBuy,
  pair,
  takerFeeLabel,
  venueFeeLabel,
  usdcLabel,
}: {
  /** The base leg (cNGN, EURC): what an engine sell pays, what an engine buy receives. */
  baseLabel: string;
  engineSide: "buy" | "sell";
  /** A buy of the displayed base. */
  isBuy: boolean;
  pair: SpotPair;
  takerFeeLabel: string;
  /** The charge the venue reported for this size, or null when it reported no schedule. */
  venueFeeLabel: string | null;
  /** The USDC leg: what an engine buy pays, what an engine sell receives. */
  usdcLabel: string;
}) {
  const action = isBuy ? "buy" : "sell";
  const isEngineBuy = engineSide === "buy";

  return {
    confirmLabel: `Confirm ${action}`,
    directionLabel: `${isBuy ? "Buy" : "Sell"} ${pair.displayBase}`,
    sizeLabel: pair.displayBase === "USDC" ? usdcLabel : baseLabel,
    title: `Confirm ${action}`,
    summaryRows: [
      { label: "You pay", value: isEngineBuy ? usdcLabel : baseLabel },
      { label: "You receive", value: isEngineBuy ? baseLabel : usdcLabel },
      // The charge first, the ceiling under it. The ceiling was the only row here when the venue
      // charged nothing; now that it charges, leading with it would quote a number no fill hits.
      ...(venueFeeLabel === null ? [] : [{ label: "Taker fee", value: venueFeeLabel }]),
      {
        label: venueFeeLabel === null ? `Max taker fee (${SPOT_TAKER_FEE_BPS} bps)` : "Max fee",
        value: takerFeeLabel,
      },
    ],
  };
}

/**
 * A USDC amount: the order's total (its base size at its price) and the fees charged on it. Four
 * places because a small order's fee is fractions of a cent, and two because a round figure
 * should still read as money.
 */
function formatUsdcAmount(usdc: number) {
  return `${usdc.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 })} USDC`;
}

/** Fills the price field from the book — the mid, or the touch on the side the order would rest. */
function PriceQuickFill({
  bestLabel,
  bestPrice,
  midPrice,
  onSelect,
}: {
  bestLabel: string;
  bestPrice: number | null;
  midPrice: number | null;
  onSelect: (price: number) => void;
}) {
  return (
    <span className="flex items-center gap-1 text-[11px]">
      {[
        { label: "MID", price: midPrice },
        { label: bestLabel, price: bestPrice },
      ].map((option) => (
        <button
          className="cursor-pointer rounded-sm px-1.5 py-0.5 font-semibold text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active disabled:cursor-not-allowed disabled:opacity-40"
          disabled={option.price === null}
          key={option.label}
          onClick={() => option.price !== null && onSelect(option.price)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </span>
  );
}

/**
 * The price an order's size is counted at: the entered limit for a limit order; for a market order,
 * its expected fill held inside the signed limit (see `getMarketSizingPrice`). Lives outside the
 * economics function so its branching does not count against that function's complexity budget.
 */
function resolveSizingPrice({
  crossingPrice,
  enteredPrice,
  fill,
  orderType,
  side,
  signedPrice,
}: {
  crossingPrice: number | null;
  enteredPrice: number | null;
  fill: { averagePrice: number | null } | null;
  orderType: SpotOrderType;
  side: "buy" | "sell";
  signedPrice: number | null;
}) {
  if (orderType !== "Market") {
    return enteredPrice;
  }

  return getMarketSizingPrice(side, fill?.averagePrice ?? crossingPrice, signedPrice);
}

/**
 * Everything the ticket derives from the book, the entered values and the account balance.
 *
 * A pure function outside the component: it is where all the branching lives, and keeping it here
 * means the panel reads as layout rather than arithmetic.
 */
function deriveOrderEconomics({
  asks,
  base,
  bids,
  sizeBase,
  availableBase,
  availableUsdc,
  bestAsk,
  bestBid,
  limitPrice,
  orderType,
  side,
  takerFeeBps,
}: {
  asks: OrderBookLevel[];
  /** The pair's base: what an engine sell spends. */
  base: SpotBase;
  bids: OrderBookLevel[];
  /** The order size in the base, already converted from whichever unit the Size field is in. */
  sizeBase: number;
  availableBase: number | null;
  availableUsdc: number | null;
  bestAsk: number | null;
  bestBid: number | null;
  limitPrice: string;
  orderType: SpotOrderType;
  side: "buy" | "sell";
  /** The venue's schedule from /v1/markets. Null when it did not report one — unknown, not free. */
  takerFeeBps: number | null;
}) {
  const crossingPrice = getCrossingPrice(side, bestAsk, bestBid);
  const hasAmount = Number.isFinite(sizeBase);
  /*
   * What a market order of this size would really fill at, walked through the resting depth. The
   * touch is only the first level: on a thin book the rest of the order fills behind it, so
   * quoting the touch understates the cost precisely when it matters most.
   */
  const fill = orderType === "Market" ? getMarketFill(side, asks, bids, sizeBase) : null;
  // A market order costs what it crosses at — the walked average where the book can price it,
  // the touch until a size has been entered.
  const effectivePrice =
    orderType === "Market" ? (fill?.averagePrice ?? crossingPrice) : parseAmount(limitPrice);
  const hasPrice = effectivePrice !== null && Number.isFinite(effectivePrice);
  // The USDC leg: what an engine buy of the base pays, what an engine sell receives.
  const total = hasPrice && hasAmount ? sizeBase * (effectivePrice as number) : null;

  const enteredPrice = hasPrice ? (effectivePrice as number) : null;
  // A market order is signed through the touch, so a moving quote cannot strand it as a resting limit.
  const signedPrice =
    orderType === "Market" ? getMarketableLimitPrice(side, bestAsk, bestBid) : enteredPrice;
  /*
   * What the order spends is its size counted at this price: a market order's expected fill, held
   * inside the signed limit. Counted at the signed limit, the slippage room was spent as cost too.
   */
  const sizingPrice = resolveSizingPrice({
    crossingPrice,
    enteredPrice,
    fill,
    orderType,
    side,
    signedPrice,
  });

  const cost = getOrderCost(side, sizingPrice, sizeBase, base);
  const availableForCost = cost?.currency === "USDC" ? availableUsdc : availableBase;
  /*
   * A shortfall, not a rejection: the venue accepts an order the account cannot cover, rests it,
   * and lets it expire unfilled — which reads as the order vanishing. Catching it here is the only
   * place a trader finds out before signing.
   */
  const shortfall =
    cost !== null && availableForCost !== null && cost.amount > availableForCost
      ? { currency: cost.currency, held: availableForCost, needed: cost.amount }
      : null;

  // The ceiling is signed per unit of base at the signed price, so it is counted on the size at
  // that price: the most the order can be charged, whatever it actually fills at.
  const signedNotional = hasAmount && signedPrice !== null ? sizeBase * signedPrice : 0;

  return {
    // Surfaced beside the fill itself so the panel never has to reach through it.
    averagePrice: fill === null ? null : fill.averagePrice,
    crossingPrice,
    fill,
    shortfall,
    signedPrice,
    sizingPrice,
    feeFromVenue: venueFee(total ?? 0, takerFeeBps),
    takerFee: signedNotional * Number(SPOT_TAKER_FEE_RATE),
    totalLabel: total === null ? "—" : formatUsdcAmount(total),
  };
}

/**
 * Resolves the CTA label. The wallet comes first — without one there is nothing to submit or
 * prepare, and submission rejects on the same condition. After that an in-flight order wins over
 * account preparation: once a submission starts, that is the more specific thing to wait on.
 *
 * A shortfall comes last and turns the button into the remedy rather than switching it off. A
 * disabled "Sell USDC" is a dead control: it states that the order cannot be placed and offers
 * nothing to do about it, which is the one blocker on this ticket the trader can clear themselves.
 */
function getSpotSubmitLabel({
  hasWallet,
  isPreparingAccount,
  isSubmitting,
  shortfallCurrency,
  sideLabel,
}: {
  hasWallet: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  /** The asset the account is short of, or null when the order is covered. */
  shortfallCurrency: PayCurrency | null;
  sideLabel: string;
}) {
  if (!hasWallet) {
    return "Deposit";
  }
  if (isSubmitting) {
    return "Submitting…";
  }
  if (isPreparingAccount) {
    return "Loading account…";
  }
  if (shortfallCurrency !== null) {
    return `Deposit ${shortfallCurrency}`;
  }
  return sideLabel;
}

/**
 * Rounds a derived size *down* to what the field holds in that unit: a whole base (cNGN, EURC),
 * since that is what the engine rests (the signer floors a fraction anyway, so showing one would
 * misstate the order); four decimals of USDC.
 *
 * `toFixed` rounds to nearest, which can land a hair above what the account holds — and a hair is
 * enough for the ticket to call the order unaffordable. Flooring keeps a derived size affordable.
 */
function toAffordableSize(size: number, unit: PayCurrency) {
  if (unit !== "USDC") {
    return Math.floor(size).toFixed(0);
  }
  return (Math.floor(size * 10_000) / 10_000).toFixed(4);
}

/**
 * The same order counted in the other leg, for the line under the Size field.
 *
 * Null — rendered as an em dash — whenever the book cannot price the conversion. A market ticket
 * with no touch has no honest counterpart to show, and inventing one would put a number on screen
 * that nothing can fill at.
 */
function getCounterpart({
  averagePrice,
  base,
  conversionPrice,
  sizeBase,
  unit,
}: {
  /** The walked fill average, where the book has one; it is what the Total is priced at. */
  averagePrice: number | null;
  base: SpotBase;
  conversionPrice: number | null;
  sizeBase: number;
  unit: PayCurrency;
}) {
  const currency: PayCurrency = unit === "USDC" ? base : "USDC";
  // The same price the Total uses, so the two are one quantity rather than two nearby ones.
  const price = averagePrice ?? conversionPrice;

  if (!Number.isFinite(sizeBase) || price === null) {
    return formatBalance(null, currency);
  }

  // Entered in USDC, `sizeBase` is already the counterpart; entered in the base, it has to be priced.
  return formatBalance(unit === "USDC" ? sizeBase : sizeBase * price, currency);
}

/**
 * Rewrites the Size field when its currency changes, carrying the order across rather than the
 * digits: what was 10 USDC becomes the cNGN it buys, not a 10 cNGN order a thousandth the size.
 * Returns null when there is no price to convert at, which leaves whatever was typed alone.
 */
function convertAmountToUnit(amount: number, nextUnit: PayCurrency, price: number | null) {
  if (!Number.isFinite(amount) || price === null || price <= 0) {
    return null;
  }

  return toAffordableSize(nextUnit === "USDC" ? amount * price : amount / price, nextUnit);
}

/**
 * How the Size field is denominated, and the order that entry describes.
 *
 * Everything downstream works in the base — the ceiling, the cost, the fee, the signed envelope —
 * so this is where a USDC entry becomes a base size, once, rather than at each of those call sites.
 * The counterpart shown under the field is priced later, off the walked average this size produces.
 */
function deriveAmountEntry({
  amount,
  anchorPrice,
  bestAsk,
  bestBid,
  engineLimit,
  isMarket,
  side,
  unit,
}: {
  amount: string;
  anchorPrice: number | null;
  bestAsk: number | null;
  bestBid: number | null;
  /** The limit the order is signed at, USDC per base; null without a typed limit. */
  engineLimit: number | null;
  isMarket: boolean;
  side: "buy" | "sell";
  unit: PayCurrency;
}) {
  const activeUnit = unit;
  const parsedAmount = parseAmount(amount);
  if (!isMarket) {
    // A limit order's legs are counted at its own limit: USDC at the price typed is that much base.
    return {
      activeUnit,
      conversionPrice: engineLimit,
      parsedAmount,
      sizeBase: toOrderSizeBase(parsedAmount, activeUnit, engineLimit),
    };
  }
  /*
   * A USDC entry is converted at the price the order is expected to fill at, held inside the
   * signed limit — the touch, since the walked average would depend on the size this very
   * conversion produces. The average is then walked for the size that results. The anchor stands
   * in only when there is nothing to cross, which no market order can fill against anyway.
   */
  const conversionPrice =
    getMarketSizingPrice(
      side,
      getCrossingPrice(side, bestAsk, bestBid),
      getMarketableLimitPrice(side, bestAsk, bestBid)
    ) ?? anchorPrice;
  const sizeBase = toOrderSizeBase(parsedAmount, activeUnit, conversionPrice);

  return { activeUnit, conversionPrice, parsedAmount, sizeBase };
}

/**
 * The other leg of the same order, so a size entered in one currency is never signed without its
 * counterpart on screen. An em dash until a price can convert it: a market order needs a touch, a
 * limit order its limit, and inventing either would put a number on screen nothing can fill at.
 */
function ConversionLine({ label }: { label: string }) {
  return <p className="text-[11px] text-panel-text-muted">≈ {label}</p>;
}

/**
 * The limit as the engine signs it, USDC per cNGN, under the cNGN-per-USDC field: rounded so the
 * order never trades past the limit typed. Only under a price field on a pair shown the other way
 * up; EURC-USDC signs the limit typed. An em dash without one.
 */
function EnginePriceLine({
  isMarket,
  pair,
  price,
}: {
  isMarket: boolean;
  pair: SpotPair;
  price: number | null;
}) {
  if (isMarket || !pair.inverted) {
    return null;
  }
  return (
    <p className="text-[11px] text-panel-text-muted">
      {price === null ? "—" : `${formatUsdcPrice(price)} per ${pair.base}, as signed`}
    </p>
  );
}

/**
 * Where a market order is expected to fill, walked through the resting depth rather than quoted
 * off the touch: on a thin book the two are not the same number, and this is the one the trader is
 * charged. Leads the summary, above the order's value, as the perp ticket's does. A limit ticket
 * has no row: its price is the one the trader typed.
 */
function ExpectedPriceRow({
  averagePrice,
  isMarket,
  orientation,
  pair,
}: {
  averagePrice: number | null;
  isMarket: boolean;
  orientation: SpotOrientation;
  pair: SpotPair;
}) {
  if (!isMarket) {
    return null;
  }
  return (
    <SummaryRow
      label="Expected Price"
      tooltip="Where a market order of this size is expected to fill, walked through the resting book"
      value={formatSpotPrice(orientation.price(averagePrice), pair)}
    />
  );
}

/**
 * Not a cost: the room a market order has to still cross if the quote moves between signing and
 * settlement. The fill itself lands at the maker's price, which Expected Price quotes.
 */
function SlippageRow({ isMarket }: { isMarket: boolean }) {
  if (!isMarket) {
    return null;
  }
  return <SummaryRow label="Slippage" value={`<${(SPOT_MARKET_SLIPPAGE * 100).toFixed(1)}%`} />;
}

/**
 * A market order larger than the book: the venue fills what rests and leaves the remainder working
 * at the signed limit until it expires. Muted rather than red — it is the venue behaving normally,
 * not the order being refused.
 *
 * Stands down while a shortfall is showing. That note is about an order that cannot be funded at
 * all, which settles the question this one is a footnote to — and stacked, the two pushed the
 * column past its height on a 700px viewport.
 */
function MarketDepthNote({
  fill,
  hasShortfall,
}: {
  fill: { averagePrice: number | null; filledSize: number; isFullyFilled: boolean } | null;
  hasShortfall: boolean;
}) {
  if (hasShortfall || fill === null || fill.isFullyFilled || fill.filledSize <= 0) {
    return null;
  }
  const coveredUsdc = fill.averagePrice === null ? null : fill.filledSize * fill.averagePrice;

  return (
    <p className="text-[11px] text-panel-text-muted leading-snug">
      Book covers {formatBalance(coveredUsdc, "USDC")} — the rest rests until it expires.
    </p>
  );
}

/**
 * The fee, on one row. `charged` is what the venue takes, from its own schedule on /v1/markets.
 * When the service reports no schedule the fee is unknown, not zero, so the row falls back to
 * `ceiling`, the most the order is signed to pay, as "Up to …" rather than printing a confident
 * zero. The ceiling and the order's lifetime are still stated in the confirmation before signing.
 */
function FeeRow({ ceiling, charged }: { ceiling: number; charged: number | null }) {
  return charged === null ? (
    <SummaryRow
      label="Fees"
      tooltip="The venue did not report its fee schedule; this is the most the order is signed to pay"
      value={`Up to ${formatUsdcAmount(ceiling)}`}
    />
  ) : (
    <SummaryRow label="Fees" value={formatUsdcAmount(charged)} />
  );
}

/**
 * Why the ticket will not sign this order, when it would trade against the trader's own resting
 * order; null when it would not. The venue cannot settle such a trade, so the submit control is
 * disabled rather than letting the order be signed: see `findOwnCrossingOrder`. Judged at the signed
 * price, where the matcher would cross it. Without a wallet there are no own orders to trade against.
 *
 * Lives outside the component so its branching does not count against that function's budget.
 */
function getOwnCrossingNote({
  hasWallet,
  orientation,
  ownOrders,
  pair,
  side,
  signedPrice,
}: {
  hasWallet: boolean;
  orientation: SpotOrientation;
  ownOrders: readonly SpotOpenOrder[];
  pair: SpotPair;
  side: "buy" | "sell";
  signedPrice: number | null;
}) {
  if (!hasWallet) {
    return null;
  }
  const order = findOwnCrossingOrder({ ownOrders, side, signedPrice });
  if (order === null) {
    return null;
  }
  // the resting order in the trader's terms: on an inverted pair an engine buy of cNGN is their sell of USDC
  const restingSide = orientation.side(order.side);
  return `This would trade against your own resting ${restingSide} at ${formatSpotPrice(orientation.price(order.price), pair)}, which can't settle. Cancel it in Open Orders or change the price.`;
}

/** Why an order that would trade against the trader's own resting order is not signable; nothing otherwise. */
function OwnCrossingNote({ note }: { note: string | null }) {
  if (note === null) {
    return null;
  }

  return <p className="text-[11px] text-panel-text-muted leading-snug">{note}</p>;
}

/**
 * Whether the submit control is inert, and how it reads when an own crossing is what stops it. Outside
 * the component for the same reason as `getOwnCrossingNote`: its branching stays off that budget.
 */
function getSubmitBlock(isBusy: boolean, ownCrossingNote: string | null) {
  return { disabled: isBusy || ownCrossingNote !== null };
}

/**
 * The Size field: the displayed base the order buys or sells, or the other leg it pays or receives.
 * Either way the other leg is shown underneath, and the engine signs the whole base.
 */
function AmountField({
  amount,
  onChange,
  onUnitSelect,
  pair,
  unit,
}: {
  amount: string;
  onChange: (value: string) => void;
  onUnitSelect: (unit: PayCurrency) => void;
  pair: SpotPair;
  unit: PayCurrency;
}) {
  return (
    <FormField
      adornment={
        <TokenUnitSelect
          label={`Size in ${unit} — switch currency`}
          onSelect={(next) => next !== unit && onUnitSelect(next)}
          options={sizeUnits(pair)}
          selected={unit}
        />
      }
      id="spot-amount"
      label="Size"
      onChange={onChange}
      placeholder="0"
      tooltip={`The ${pair.displayBase} the order buys or sells, or the ${pair.displayQuote} it pays or receives; the other leg is shown underneath. The engine signs whole ${pair.base}.`}
      value={amount}
    />
  );
}

/**
 * The button's colour: the side's when it would place an order, neutral once it is a deposit
 * remedy instead, so the trader is not asked to press a green "Buy"-coloured control that opens a
 * deposit dialog.
 */
function getSubmitTone({
  hasWallet,
  shortfallCurrency,
  side,
}: {
  hasWallet: boolean;
  shortfallCurrency: PayCurrency | null;
  side: "buy" | "sell";
}) {
  return shortfallCurrency !== null || !hasWallet ? "neutral" : side;
}

export function SpotOrderFormPanel({
  anchorPrice,
  asks,
  availableBase,
  availableUsdc,
  bestAsk,
  bestBid,
  bids,
  onDepositRequest,
  onEdit,
  onSubmitOrder,
  ownOpenOrders = [],
  pair,
  takerFeeBps,
  isPreparingAccount = false,
  hasWallet = false,
  isSubmitting = false,
  lastAction = null,
}: {
  /** Mid of the displayed book — seeds the limit price, and cannot cross on either side. */
  anchorPrice: number | null;
  /**
   * The ladder as displayed, so a market order's average price is walked through the same depth
   * the trader is looking at rather than estimated off the touch.
   */
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  /**
   * What a new order can actually spend: the trading-account balance less what this trader's own
   * resting orders already claim. The connected wallet's balance funds a deposit, not an order, so
   * it belongs in the deposit dialog rather than here.
   *
   * `Available` is formatted from these numbers rather than taking a label of its own — the two used
   * to arrive separately, and the label was the *balance* while the number was the spendable part,
   * so a trader with orders resting read a figure the order could not actually spend.
   */
  availableBase: number | null;
  availableUsdc: number | null;
  /** The spot pair the ticket trades: its base, and which way up the trader sees it. */
  pair: SpotPair;
  /**
   * The venue's taker fee, in basis points of the quote notional, exactly as /v1/markets reports
   * it. Null means the API did not report one — the fee is then unknown, not zero, and the ticket
   * shows only the signed ceiling. The schedule is never hardcoded here: the matcher charges what
   * this same field says, so a copy in the UI would be a second source of truth that drifts.
   */
  takerFeeBps: number | null;
  /** The touch as displayed in the ladder, so the ticket quotes the book on screen. */
  bestAsk: number | null;
  bestBid: number | null;
  /**
   * Opens the deposit dialog — what the CTA does before a wallet is connected, and what it does
   * instead of going dead when the account is short of the asset this order spends.
   */
  onDepositRequest?: (currency?: PayCurrency) => void;
  /** Any change to the ticket: the host clears the order status line on it. */
  onEdit?: () => void;
  /** `price` is USDC per base and `size` is the whole base, both as decimal strings. */
  onSubmitOrder: (args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: SpotOrderType;
  }) => void;
  /** The connected wallet's own working orders, so an order that would trade against one is stopped. */
  ownOpenOrders?: readonly SpotOpenOrder[];
  /** The trading subaccount is still being resolved — distinct from an order in flight. */
  isPreparingAccount?: boolean;
  /**
   * Whether a wallet is connected. This, not a Privy session, is what order submission and the
   * deposit flow require, so the CTA points at funding whenever it is false.
   */
  hasWallet?: boolean;
  isSubmitting?: boolean;
  lastAction?: string | null;
}) {
  const orientation = spotOrientation(pair);
  // The trader's side: a buy or sell of the displayed base. `side` below is the engine's, which on
  // an inverted pair is the other way.
  const [uiSide, setUiSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<SpotOrderType>("Market");
  // In the displayed quote per base. Seeded from the mid, not the last trade: a prefill past the
  // touch turns the trader's chosen "Limit" into a taker on submit, an immediate fill at the taker tier.
  const [limitPrice, setLimitPrice] = useState(
    orientation.price(anchorPrice)?.toFixed(pair.priceDecimals) ?? ""
  );
  const [amount, setAmount] = useState("10");
  // Which leg the Size field is counted in: the displayed base bought or sold, or the other leg.
  const [amountUnit, setAmountUnit] = useState<PayCurrency>(pair.displayBase);
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Wraps a field setter so every edit also tells the host. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      onEdit?.();
      set(value);
    };
  }

  // Everything below works in the engine's terms: its side, USDC per base, sizes in the base.
  const side = orientation.side(uiSide);
  const isBuy = uiSide === "buy";
  const needsLimitPrice = orderType !== "Market";
  const isMarket = orderType === "Market";
  // The limit as signed, USDC per base, rounded never to trade past the limit typed.
  const engineLimit = orientation.limit(limitPrice, uiSide);
  const signedLimit = toNumberOrNull(engineLimit);
  // The leg the order spends: an engine buy pays USDC, an engine sell delivers the base.
  const spendCurrency: PayCurrency = side === "buy" ? "USDC" : pair.base;
  const { activeUnit, conversionPrice, parsedAmount, sizeBase } = deriveAmountEntry({
    amount,
    anchorPrice,
    bestAsk,
    bestBid,
    engineLimit: signedLimit,
    isMarket,
    side,
    unit: amountUnit,
  });
  const availableLabel = formatBalanceFigure(
    spendCurrency === "USDC" ? availableUsdc : availableBase,
    spendCurrency
  );
  const {
    averagePrice,
    fill,
    shortfall,
    signedPrice,
    sizingPrice,
    takerFee,
    feeFromVenue,
    totalLabel,
  } = deriveOrderEconomics({
    asks,
    availableBase,
    availableUsdc,
    base: pair.base,
    bestAsk,
    bestBid,
    bids,
    limitPrice: engineLimit ?? "",
    orderType,
    side,
    sizeBase,
    takerFeeBps,
  });

  const counterpartLabel = getCounterpart({
    averagePrice,
    base: pair.base,
    conversionPrice,
    sizeBase,
    unit: activeUnit,
  });

  const baseLeg = toBaseLeg(sizeBase);
  const baseLegLabel = formatBalance(baseLeg, pair.base);
  const confirmation = buildSpotConfirmation({
    baseLabel: baseLegLabel,
    engineSide: side,
    isBuy,
    pair,
    takerFeeLabel: formatUsdcAmount(takerFee),
    usdcLabel: totalLabel,
    venueFeeLabel: feeFromVenue === null ? null : formatUsdcAmount(feeFromVenue),
  });

  /** Switches the Size field's currency, converting what is in it to match. */
  function handleUnitSelect(nextUnit: PayCurrency) {
    setAmountUnit(nextUnit);

    const converted = convertAmountToUnit(parsedAmount, nextUnit, conversionPrice);
    if (converted !== null) {
      setAmount(converted);
    }
  }

  const ownCrossingNote = getOwnCrossingNote({
    hasWallet,
    orientation,
    ownOrders: ownOpenOrders,
    pair,
    side,
    signedPrice,
  });

  function handleSubmit() {
    // Without a wallet there is nothing to submit against, so the CTA funds an account instead.
    if (!hasWallet) {
      onDepositRequest?.();
      return;
    }
    // Same move for the one blocker a trader can clear from here: the ticket sends them to the
    // dialog for the asset it named, rather than refusing the order and stopping there.
    if (shortfall !== null) {
      onDepositRequest?.(shortfall.currency);
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    setConfirmOpen(false);
    onSubmitOrder({
      orderType,
      price: resolveOrderPrice({ limitPrice: engineLimit ?? "", orderType, sizingPrice }),
      side,
      // Always the whole base: the signed envelope carries no other unit, so a USDC-denominated
      // ticket is converted here rather than sending the figure the trader typed.
      size: toAffordableSize(sizeBase, pair.base),
    });
  }

  const statusText = lastAction;
  const sideLabel = `${isBuy ? "Buy" : "Sell"} ${pair.displayBase}`;
  // Both states block submission, but they are not the same thing: "Submitting…" on a button the
  // user never pressed reads as a stuck order rather than a subaccount lookup still in flight.
  const isBusy = isSubmitting || isPreparingAccount;
  const submitBlock = getSubmitBlock(isBusy, ownCrossingNote);
  // Only meaningful for a trader who has an account to measure against: with no wallet the CTA
  // already funds one, and there is no balance to be short of yet.
  const shortfallCurrency = hasWallet && shortfall !== null ? shortfall.currency : null;
  const submitLabel = getSpotSubmitLabel({
    hasWallet,
    isPreparingAccount,
    isSubmitting,
    shortfallCurrency,
    sideLabel,
  });

  return (
    <OrderFormShell
      footer={
        <>
          {/*
           * One total, not a Subtotal/Total pair: the displayed quote a buy pays or a sell receives
           * (the USDC on both pairs), with the fee charged on it listed separately. Printing a fee-inclusive total as well cost the Size field its rows on a
           * 700px screen.
           */}
          <div className="space-y-0.5">
            <ExpectedPriceRow
              averagePrice={averagePrice}
              isMarket={isMarket}
              orientation={orientation}
              pair={pair}
            />
            <SummaryRow
              emphasis
              label="Order Value"
              tooltip={`The ${pair.displayQuote} this order pays for its ${pair.displayBase}, or receives for it`}
              value={pair.displayQuote === "USDC" ? totalLabel : baseLegLabel}
            />
            <FeeRow ceiling={takerFee} charged={feeFromVenue} />
            <SlippageRow isMarket={isMarket} />
          </div>

          <MarketDepthNote fill={fill} hasShortfall={shortfallCurrency !== null} />

          <OwnCrossingNote note={ownCrossingNote} />

          {shortfall === null || !hasWallet ? null : (
            <p className="text-[11px] text-panel-text-muted leading-snug" data-note="shortfall">
              Needs {formatBalance(shortfall.needed, shortfall.currency)}; account holds{" "}
              {formatBalance(shortfall.held, shortfall.currency)}.
            </p>
          )}

          {/*
           * Neutral once it stops being an order button, so the trader is not asked to press a
           * green "Buy"-coloured control that will open a deposit dialog. Stable id: the label
           * changes with wallet and submission state, so text is not an identifier.
           */}
          <SubmitButton
            busy={isBusy}
            disabled={submitBlock.disabled && !isBusy}
            id="spot-submit-cta"
            onClick={handleSubmit}
            tone={getSubmitTone({ hasWallet, shortfallCurrency, side: uiSide })}
          >
            {submitLabel}
          </SubmitButton>

          <ConfirmOrderDialog
            {...confirmation}
            isSubmitting={isSubmitting}
            onConfirm={handleConfirm}
            onOpenChange={setConfirmOpen}
            open={confirmOpen}
            orderSide={uiSide}
          />

          {statusText === null ? null : (
            <p className="text-[11px] text-panel-text-muted leading-snug">{statusText}</p>
          )}
        </>
      }
    >
      <SideToggle onSelect={edited(setUiSide)} options={SIDES} selected={uiSide} />

      <OrderTypeTabs
        onSelect={edited(setOrderType)}
        orderTypes={ORDER_TYPES}
        selected={orderType}
      />

      {/*
       * The balance an order draws on is the trading account's, not the connected wallet's, so
       * this is the number that answers "can I place this?". The currency follows the side,
       * because so does the balance an order spends: an engine buy pays USDC, a sell the base.
       */}
      <AvailableRow
        depositLabel={`Deposit ${spendCurrency}`}
        label={`Available (${spendCurrency})`}
        onDeposit={() => onDepositRequest?.(spendCurrency)}
        tooltip="Your trading account's balance less what your own resting orders already claim. The connected wallet funds a deposit, not an order."
        value={availableLabel}
      />

      {needsLimitPrice ? (
        <FormField
          adornment={
            <span className="flex items-center gap-2">
              {/*
               * The trader's touch, on the engine side the order rests: on an inverted pair their
               * best bid is the engine's best ask turned over.
               */}
              <PriceQuickFill
                bestLabel={isBuy ? "BID" : "ASK"}
                bestPrice={orientation.price(side === "buy" ? bestBid : bestAsk)}
                midPrice={orientation.price(anchorPrice)}
                onSelect={(price) => edited(setLimitPrice)(price.toFixed(pair.priceDecimals))}
              />
              <TokenUnit symbol={pair.displayQuote} />
            </span>
          }
          id="spot-limit-price"
          label="Limit price"
          onChange={edited(setLimitPrice)}
          placeholder="0.00"
          tooltip={`${pair.displayQuote} per ${pair.displayBase}. Seeded from the mid, which cannot cross on either side.`}
          value={limitPrice}
        />
      ) : null}

      <EnginePriceLine isMarket={isMarket} pair={pair} price={signedLimit} />

      {/*
       * Sized in the displayed base or the other leg. Only the whole engine base is submittable, so
       * a USDC entry is converted at the price the order crosses at (a market order) or at its
       * limit; the line under the field shows the other leg either way.
       */}
      <AmountField
        amount={amount}
        onChange={edited(setAmount)}
        onUnitSelect={(unit) => {
          onEdit?.();
          handleUnitSelect(unit);
        }}
        pair={pair}
        unit={activeUnit}
      />

      <ConversionLine label={counterpartLabel} />
    </OrderFormShell>
  );
}
