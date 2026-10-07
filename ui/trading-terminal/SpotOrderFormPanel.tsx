"use client";

import { useState } from "react";
import { formatBalance, formatBalanceFigure } from "@/lib/account-balance-display";
import {
  formatNairaPerUsdc,
  formatPrice,
  formatUsdcPrice,
  PRICE_DECIMALS,
} from "@/lib/market-formatting";
import {
  findOwnCrossingOrder,
  getCrossingPrice,
  getMarketableLimitPrice,
  getMarketFill,
  getMarketSizingPrice,
  getMaxOrderSize,
  getOrderCost,
  SPOT_MARKET_SLIPPAGE,
  toOrderSizeCngn,
} from "@/lib/spot-market";
import { SPOT_ORDER_LIFETIME_LABEL, SPOT_TAKER_FEE_RATE } from "@/lib/spot-order-submission";
import type { OrderBookLevel, SpotOpenOrder } from "@/lib/trading.types";
import { ConfirmOrderDialog } from "@/ui/trading-terminal/ConfirmOrderDialog";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";
import { AmountSlider } from "@/ui/trading-terminal/order-form/AmountSlider";
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
type PayCurrency = "cNGN" | "USDC";

const ORDER_TYPES = ["Market", "Limit"] as const satisfies readonly SpotOrderType[];

const SIDES = [
  { label: "Buy", tone: "buy", value: "buy" },
  { label: "Sell", tone: "sell", value: "sell" },
] as const;

/**
 * The units the Size field can be counted in, the order's own first. cNGN is what the order is
 * signed for and what the engine rests; USDC is what a buy spends or a sell receives.
 */
const SIZE_UNITS = ["cNGN", "USDC"] as const satisfies readonly PayCurrency[];

/** Presets under the size slider: shares of what the account can fund. */
const SIZE_PRESETS = [25, 50, 75, 100].map((percent) => ({
  label: `${percent}%`,
  value: percent,
}));

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
 * A USDC-per-cNGN price as the decimal string an envelope or a field takes: ten places hold the
 * engine's resolution for any price this pair trades at, and `toFixed` never falls into the
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
 * Copy and rows for the submit confirmation. Lives outside the component so its branching does
 * not count against the panel's cognitive complexity budget.
 */
function buildSpotConfirmation({
  amount,
  isBuy,
  orderType,
  takerFeeLabel,
  venueFeeLabel,
  totalLabel,
}: {
  amount: string;
  isBuy: boolean;
  orderType: SpotOrderType;
  takerFeeLabel: string;
  /** The charge the venue reported for this size, or null when it reported no schedule. */
  venueFeeLabel: string | null;
  totalLabel: string;
}) {
  const action = isBuy ? "buy" : "sell";

  return {
    confirmLabel: `Confirm ${action}`,
    description: `This submits a ${orderType.toLowerCase()} order for cNGN-USDC. It expires ${SPOT_ORDER_LIFETIME_LABEL} after signing if it has not filled, and once filled it cannot be reversed from this screen.`,
    directionLabel: isBuy ? "Buy cNGN" : "Sell cNGN",
    sizeLabel: `${amount || "0"} cNGN`,
    title: `Confirm ${action}`,
    // The USDC leg: what a buy pays for the cNGN, what a sell receives for it.
    summaryRows: [
      { label: isBuy ? "You pay" : "You receive", value: totalLabel },
      // The charge first, the ceiling under it. The ceiling was the only row here when the venue
      // charged nothing; now that it charges, leading with it would quote a number no fill hits.
      ...(venueFeeLabel === null ? [] : [{ label: "Taker fee", value: venueFeeLabel }]),
      {
        label:
          venueFeeLabel === null ? `Max taker fee (${SPOT_TAKER_FEE_BPS} bps)` : "Max fee (signed)",
        value: takerFeeLabel,
      },
      { label: "Expires", value: `${SPOT_ORDER_LIFETIME_LABEL} after signing` },
    ],
  };
}

/**
 * A USDC amount: the order's total (its cNGN size at its price) and the fees charged on it. Four
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
  bids,
  sizeCngn,
  anchorPrice,
  availableCngn,
  availableUsdc,
  bestAsk,
  bestBid,
  limitPrice,
  orderType,
  side,
  takerFeeBps,
}: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  /** The order size in cNGN, already converted from whichever unit the Size field is in. */
  sizeCngn: number;
  anchorPrice: number | null;
  availableCngn: number | null;
  availableUsdc: number | null;
  bestAsk: number | null;
  bestBid: number | null;
  limitPrice: string;
  orderType: SpotOrderType;
  side: "buy" | "sell";
  /** The venue's schedule from /v1/markets. Null when it did not report one — unknown, not free. */
  takerFeeBps: number | null;
}) {
  const isBuy = side === "buy";
  const crossingPrice = getCrossingPrice(side, bestAsk, bestBid);
  const hasAmount = Number.isFinite(sizeCngn);
  /*
   * What a market order of this size would really fill at, walked through the resting depth. The
   * touch is only the first level: on a thin book the rest of the order fills behind it, so
   * quoting the touch understates the cost precisely when it matters most.
   */
  const fill = orderType === "Market" ? getMarketFill(side, asks, bids, sizeCngn) : null;
  // A market order costs what it crosses at — the walked average where the book can price it,
  // the touch until a size has been entered.
  const effectivePrice =
    orderType === "Market" ? (fill?.averagePrice ?? crossingPrice) : parseAmount(limitPrice);
  const hasPrice = effectivePrice !== null && Number.isFinite(effectivePrice);
  // The USDC leg: what a buy pays for its cNGN, what a sell receives for it.
  const total = hasPrice && hasAmount ? sizeCngn * (effectivePrice as number) : null;

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

  /*
   * The ceiling stays priced off `signedPrice`, the most a cNGN of this order can be counted at. The
   * spend is counted at `sizingPrice`, which never exceeds it on a buy, so the slider's top notch is
   * always affordable — even when a larger size walks the average deeper into the book.
   */
  const maxOrderSize = getMaxOrderSize({
    availableCngn,
    availableUsdc,
    feeRate: Number(SPOT_TAKER_FEE_RATE),
    isBuy,
    price: signedPrice ?? anchorPrice,
  });
  const canSizeByPercent = maxOrderSize !== null && maxOrderSize > 0;

  const cost = getOrderCost(side, sizingPrice, sizeCngn);
  const availableForCost = cost?.currency === "USDC" ? availableUsdc : availableCngn;
  /*
   * A shortfall, not a rejection: the venue accepts an order the account cannot cover, rests it,
   * and lets it expire unfilled — which reads as the order vanishing. Catching it here is the only
   * place a trader finds out before signing.
   */
  const shortfall =
    cost !== null && availableForCost !== null && cost.amount > availableForCost
      ? { currency: cost.currency, held: availableForCost, needed: cost.amount }
      : null;

  // The ceiling is signed per cNGN at the signed price, so it is counted on the size at that
  // price: the most the order can be charged, whatever it actually fills at.
  const signedNotional = hasAmount && signedPrice !== null ? sizeCngn * signedPrice : 0;

  return {
    // Surfaced beside the fill itself so the panel never has to reach through it.
    averagePrice: fill === null ? null : fill.averagePrice,
    canSizeByPercent,
    crossingPrice,
    fill,
    shortfall,
    signedPrice,
    sizingPrice,
    maxOrderSize,
    feeFromVenue: venueFee(total ?? 0, takerFeeBps),
    // Derived from the amount rather than held separately, so typing a size moves the slider and
    // the two can never disagree about what is being ordered.
    sizePercent:
      canSizeByPercent && hasAmount
        ? Math.min(100, Math.max(0, Math.round((sizeCngn / (maxOrderSize as number)) * 100)))
        : 0,
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
 * disabled "Sell cNGN" is a dead control: it states that the order cannot be placed and offers
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
 * Rounds a derived size *down* to what the field holds in that unit: whole cNGN, since that is what
 * the engine rests (the signer floors a fraction anyway, so showing one would misstate the order);
 * four decimals of USDC.
 *
 * `toFixed` rounds to nearest, which at 100% can land a hair above what the account holds — and a
 * hair is enough for the ticket to call the order unaffordable. Flooring keeps the top notch of the
 * slider exactly at the affordable max.
 */
function toAffordableSize(size: number, unit: PayCurrency) {
  if (unit === "cNGN") {
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
  conversionPrice,
  sizeCngn,
  unit,
}: {
  /** The walked fill average, where the book has one; it is what the Total is priced at. */
  averagePrice: number | null;
  conversionPrice: number | null;
  sizeCngn: number;
  unit: PayCurrency;
}) {
  const currency: PayCurrency = unit === "cNGN" ? "USDC" : "cNGN";
  // The same price the Total uses, so the two are one quantity rather than two nearby ones.
  const price = averagePrice ?? conversionPrice;

  if (!Number.isFinite(sizeCngn) || price === null) {
    return formatBalance(null, currency);
  }

  // Entered in USDC, `sizeCngn` is already the counterpart; entered in cNGN, it has to be priced.
  return formatBalance(unit === "cNGN" ? sizeCngn * price : sizeCngn, currency);
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
 * Everything downstream works in cNGN — the ceiling, the cost, the fee, the signed envelope — so
 * this is where a USDC entry becomes a cNGN size, once, rather than at each of those call sites.
 * The counterpart shown under the field is priced later, off the walked average this size produces.
 */
function deriveAmountEntry({
  amount,
  anchorPrice,
  bestAsk,
  bestBid,
  isMarket,
  side,
  unit,
}: {
  amount: string;
  anchorPrice: number | null;
  bestAsk: number | null;
  bestBid: number | null;
  isMarket: boolean;
  side: "buy" | "sell";
  unit: PayCurrency;
}) {
  // A limit ticket is always in cNGN, so the unit resets with the tab rather than carrying a USDC
  // entry into a field that no longer offers the switch.
  const activeUnit: PayCurrency = isMarket ? unit : "cNGN";
  const parsedAmount = parseAmount(amount);
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
  const sizeCngn = toOrderSizeCngn(parsedAmount, activeUnit, conversionPrice);

  return { activeUnit, conversionPrice, parsedAmount, sizeCngn };
}

/**
 * The other leg of the same order, so a size entered in one currency is never signed without its
 * counterpart on screen. An em dash until the book can price it: a conversion needs a touch, and
 * inventing one would put a number on screen that nothing can fill at.
 */
function ConversionLine({ isMarket, label }: { isMarket: boolean; label: string }) {
  if (!isMarket) {
    return null;
  }

  return <p className="text-[11px] text-panel-text-muted">≈ {label}</p>;
}

/**
 * The limit price the other way up: naira per dollar is how this pair is quoted everywhere but the
 * engine, so it sits under the USDC-per-cNGN figure the order is actually priced in. Only under a
 * price field: a market ticket has none, and the line cost it the balance summary at 700px tall.
 * An em dash when there is no price yet.
 */
function NairaPerUsdcLine({ isMarket, price }: { isMarket: boolean; price: number | null }) {
  if (isMarket) {
    return null;
  }
  return <p className="text-[11px] text-panel-text-muted">{formatNairaPerUsdc(price)}</p>;
}

/** What a market order fills at, and the room it is signed with. A limit ticket has neither. */
function MarketFillRows({
  averagePrice,
  isMarket,
}: {
  averagePrice: number | null;
  isMarket: boolean;
}) {
  if (!isMarket) {
    return null;
  }

  return (
    <>
      {/*
       * What the order fills at, walked through the resting depth rather than quoted off the
       * touch — on a thin book the two are not the same number, and the average is the one the
       * trader is charged.
       */}
      <SummaryRow label="Average price" value={formatPrice(averagePrice)} />
      {/*
       * Not a cost: the room the order has to still cross if the quote moves between signing and
       * settlement. The fill itself lands at the maker's price, which `Average price` above quotes.
       */}
      <SummaryRow label="Slippage" value={`<${(SPOT_MARKET_SLIPPAGE * 100).toFixed(1)}%`} />
    </>
  );
}

/**
 * How long an order that does not fill stays on the book: a limit ticket's most surprising term,
 * since it leaves the book on its own and nothing else on screen would say so. A market order
 * crosses on submission, so for it the lifetime only applies to a remainder the book could not
 * cover; the row says so in its tooltip rather than disappearing.
 */
function OrderLifetimeRow({ isMarket }: { isMarket: boolean }) {
  return (
    <SummaryRow
      label="Expires"
      tooltip={
        isMarket
          ? "A market order crosses on submission; only a remainder the book could not cover rests this long"
          : undefined
      }
      value={`${SPOT_ORDER_LIFETIME_LABEL} after signing`}
    />
  );
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
  fill: { filledSize: number; isFullyFilled: boolean } | null;
  hasShortfall: boolean;
}) {
  if (hasShortfall || fill === null || fill.isFullyFilled || fill.filledSize <= 0) {
    return null;
  }

  return (
    <p className="text-[11px] text-panel-text-muted leading-snug">
      Book covers {formatBalance(fill.filledSize, "cNGN")} — the rest rests until it expires.
    </p>
  );
}

/**
 * The two fee figures, and the trader needs both.
 *
 * `charged` is what the venue takes: its own published schedule, served by /v1/markets, so this
 * app never carries a second copy of the rate to disagree with. Null means the service reported no
 * schedule — the fee is then UNKNOWN, not zero, and the row is omitted rather than printing a
 * confident "0.00 USDC" that a market which does charge would make wrong by the whole fee.
 *
 * `ceiling` is the worstFee the order is signed with: the most that can be charged before
 * TradeModule reverts TM_FeeTooHigh. It is a bound, never a quote — an order that partly fills, or
 * rests and never takes, is charged less. It stays on screen next to the charge because it is the
 * number that decides whether the order can fill at all: a ceiling below the schedule reverts.
 */
function FeeRows({ ceiling, charged }: { ceiling: number; charged: number | null }) {
  return (
    <>
      {charged === null ? null : <SummaryRow label="Fee" value={formatUsdcAmount(charged)} />}
      <SummaryRow
        label="Max fee"
        tooltip="The most the order is signed to pay: a bound the venue reverts above, never a quote. An order that partly fills, or rests and never takes, is charged less."
        value={formatUsdcAmount(ceiling)}
      />
    </>
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
  ownOrders,
  side,
  signedPrice,
}: {
  hasWallet: boolean;
  ownOrders: readonly SpotOpenOrder[];
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
  return `This would trade against your own resting ${order.side} at ${formatUsdcPrice(order.price)}, which can't settle. Cancel it in Open Orders or change the price.`;
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
 * The Size field. A market order offers the unit switch; a limit order is priced by the trader,
 * so its size is the one number the ticket should not be restating for them, and it reads cNGN.
 */
function AmountField({
  amount,
  isMarket,
  onChange,
  onUnitSelect,
  unit,
}: {
  amount: string;
  isMarket: boolean;
  onChange: (value: string) => void;
  onUnitSelect: (unit: PayCurrency) => void;
  unit: PayCurrency;
}) {
  return (
    <FormField
      adornment={
        isMarket ? (
          <TokenUnitSelect
            label={`Size in ${unit} — switch currency`}
            onSelect={(next) => next !== unit && onUnitSelect(next)}
            options={SIZE_UNITS}
            selected={unit}
          />
        ) : (
          <TokenUnit symbol="cNGN" />
        )
      }
      id="spot-amount"
      label="Size"
      onChange={onChange}
      placeholder="0"
      tooltip={
        isMarket
          ? "The cNGN the order trades. Enter it in cNGN or in USDC; the other leg is shown underneath."
          : "The cNGN the order trades; the engine rests whole cNGN."
      }
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
  availableCngn,
  availableUsdc,
  bestAsk,
  bestBid,
  bids,
  onDepositRequest,
  onEdit,
  onSubmitOrder,
  ownOpenOrders = [],
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
   * so a trader with orders resting read a figure the slider would not size to.
   */
  availableCngn: number | null;
  availableUsdc: number | null;
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
  /** `price` is USDC per cNGN and `size` is whole cNGN, both as decimal strings. */
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
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<SpotOrderType>("Market");
  // Seeded from the mid, not the last trade: a prefill past the touch turns the trader's chosen
  // "Limit" into a taker on submit — an immediate fill at the taker tier instead of resting free.
  const [limitPrice, setLimitPrice] = useState(
    anchorPrice === null ? "" : anchorPrice.toFixed(PRICE_DECIMALS)
  );
  const [amount, setAmount] = useState("1000");
  // Which leg the Size field is counted in. cNGN is the order's own size; USDC is what the trader
  // spends or receives. Market orders alone offer the switch — a limit order is priced by the
  // trader, so its size is the one number the ticket should not be restating for them.
  const [amountUnit, setAmountUnit] = useState<PayCurrency>("cNGN");
  const [confirmOpen, setConfirmOpen] = useState(false);
  /** Wraps a field setter so every edit also tells the host. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      onEdit?.();
      set(value);
    };
  }

  const isBuy = side === "buy";
  const needsLimitPrice = orderType !== "Market";
  const isMarket = orderType === "Market";
  // The leg the order spends: a buy of cNGN pays USDC, a sell delivers the cNGN itself.
  const spendCurrency: PayCurrency = isBuy ? "USDC" : "cNGN";
  const { activeUnit, conversionPrice, parsedAmount, sizeCngn } = deriveAmountEntry({
    amount,
    anchorPrice,
    bestAsk,
    bestBid,
    isMarket,
    side,
    unit: amountUnit,
  });
  const availableLabel = formatBalanceFigure(
    spendCurrency === "USDC" ? availableUsdc : availableCngn,
    spendCurrency
  );
  const {
    averagePrice,
    canSizeByPercent,
    fill,
    maxOrderSize,
    shortfall,
    signedPrice,
    sizePercent,
    sizingPrice,
    takerFee,
    feeFromVenue,
    totalLabel,
  } = deriveOrderEconomics({
    anchorPrice,
    asks,
    availableCngn,
    availableUsdc,
    bestAsk,
    bestBid,
    bids,
    limitPrice,
    orderType,
    side,
    sizeCngn,
    takerFeeBps,
  });

  const counterpartLabel = getCounterpart({
    averagePrice,
    conversionPrice,
    sizeCngn,
    unit: activeUnit,
  });

  const confirmation = buildSpotConfirmation({
    amount: Number.isFinite(sizeCngn) ? toAffordableSize(sizeCngn, "cNGN") : "",
    isBuy,
    orderType,
    takerFeeLabel: formatUsdcAmount(takerFee),
    venueFeeLabel: feeFromVenue === null ? null : formatUsdcAmount(feeFromVenue),
    totalLabel,
  });

  function handleSizePercent(percent: number) {
    if (!canSizeByPercent) {
      return;
    }
    // The ceiling is a cNGN size; the field may be counting USDC, so the notch is written back in
    // the unit on screen rather than dropping a cNGN figure into a USDC field.
    const sizeAtPercent = (maxOrderSize as number) * (percent / 100);
    const inUsdc =
      activeUnit === "USDC" ? convertAmountToUnit(sizeAtPercent, "USDC", conversionPrice) : null;
    setAmount(inUsdc ?? toAffordableSize(sizeAtPercent, "cNGN"));
  }

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
    ownOrders: ownOpenOrders,
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
      price: resolveOrderPrice({ limitPrice, orderType, sizingPrice }),
      side,
      // Always whole cNGN: the signed envelope carries no other unit, so a USDC-denominated ticket
      // is converted here rather than sending the figure the trader typed.
      size: toAffordableSize(sizeCngn, "cNGN"),
    });
  }

  const statusText = lastAction;
  const sideLabel = isBuy ? "Buy cNGN" : "Sell cNGN";
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
  // The price the order is counted at — the typed limit, or a market order's expected fill — the
  // other way up, under the field it belongs to.
  const priceInUse = isMarket ? sizingPrice : parseAmountOrNull(limitPrice);

  return (
    <OrderFormShell
      footer={
        <>
          {/*
           * One total, not a Subtotal/Total pair: the USDC a buy pays or a sell receives for its
           * cNGN, with the fee charged on it listed separately. Printing a fee-inclusive total as
           * well cost the Size field its rows on a 700px screen.
           */}
          <div className="space-y-0.5">
            <SummaryRow emphasis label="Total" value={totalLabel} />
            <FeeRows ceiling={takerFee} charged={feeFromVenue} />
            <MarketFillRows averagePrice={averagePrice} isMarket={isMarket} />
            <OrderLifetimeRow isMarket={isMarket} />
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
            tone={getSubmitTone({ hasWallet, shortfallCurrency, side })}
          >
            {submitLabel}
          </SubmitButton>

          <ConfirmOrderDialog
            {...confirmation}
            isSubmitting={isSubmitting}
            onConfirm={handleConfirm}
            onOpenChange={setConfirmOpen}
            open={confirmOpen}
            orderSide={side}
          />

          {statusText === null ? null : (
            <p className="text-[11px] text-panel-text-muted leading-snug">{statusText}</p>
          )}
        </>
      }
    >
      <SideToggle onSelect={edited(setSide)} options={SIDES} selected={side} />

      <OrderTypeTabs
        onSelect={edited(setOrderType)}
        orderTypes={ORDER_TYPES}
        selected={orderType}
      />

      {/*
       * The balance an order draws on is the trading account's, not the connected wallet's, so
       * this is the number that answers "can I place this?". The currency follows the side,
       * because so does the balance an order spends: a buy pays USDC for cNGN, a sell pays cNGN.
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
              <PriceQuickFill
                bestLabel={isBuy ? "BID" : "ASK"}
                bestPrice={isBuy ? bestBid : bestAsk}
                midPrice={anchorPrice}
                onSelect={(price) => setLimitPrice(price.toFixed(PRICE_DECIMALS))}
              />
              <TokenUnit symbol="USDC" />
            </span>
          }
          id="spot-limit-price"
          label="Limit price"
          onChange={edited(setLimitPrice)}
          placeholder="0.0000000"
          tooltip="USDC per cNGN, the price the engine rests the order at. Seeded from the mid, which cannot cross on either side."
          value={limitPrice}
        />
      ) : null}

      <NairaPerUsdcLine isMarket={isMarket} price={priceInUse} />

      {/*
       * A market order is as often sized by what a trader wants to spend as by what they want to
       * hold, and on this pair those are different currencies. Only the cNGN figure is
       * submittable, so a USDC entry is converted at the price the order crosses at; the line
       * under the field shows the other leg either way. A limit order is priced by the trader, so
       * its size is the one number the ticket should not be restating for them.
       */}
      <AmountField
        amount={amount}
        isMarket={isMarket}
        onChange={edited(setAmount)}
        onUnitSelect={(unit) => {
          onEdit?.();
          handleUnitSelect(unit);
        }}
        unit={activeUnit}
      />

      <ConversionLine isMarket={isMarket} label={counterpartLabel} />

      {/*
       * Sizes the order as a share of what the account can fund. Inert, and visibly so, when that
       * ceiling is unknown, rather than sliding against an invented balance.
       */}
      <AmountSlider
        disabled={!canSizeByPercent}
        label="Order size as a percentage of available balance"
        max={100}
        min={0}
        onChange={edited(handleSizePercent)}
        presets={SIZE_PRESETS}
        step={25}
        value={sizePercent}
        valueText={`${sizePercent}%`}
      />
    </OrderFormShell>
  );
}

/** A typed price as a number, or null for an empty or unparseable field. */
function parseAmountOrNull(value: string) {
  const parsed = parseAmount(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}
