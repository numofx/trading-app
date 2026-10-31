"use client";

import { TriangleAlert } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import {
  estimateFutureFill,
  estimateFutureLeverage,
  estimateFutureOrder,
  formatFuturePrice,
  formatFutureUsdc,
  formatFutureVm,
  futureFillVm,
  futureMarketableSize,
  futureMaxFeeUsdc,
  futureOrderUiSide,
  futureOrderUnits,
  futurePositionSize,
  futureReduceOnlyTerms,
  futureTradingBlock,
  isOutsideFillBand,
  maxFutureSize,
} from "@/lib/future-market";
import type { FutureAccount, FutureSide, FutureState } from "@/lib/future-market.types";
import { formatLeverage, PERP_DEFAULT_MAX_SLIPPAGE } from "@/lib/perp-market";
import type { OrderBookLevel } from "@/lib/trading.types";
import { ConfirmOrderDialog } from "@/ui/trading-terminal/ConfirmOrderDialog";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";
import { CheckboxRow } from "@/ui/trading-terminal/order-form/CheckboxRow";
import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";
import { FormField } from "@/ui/trading-terminal/order-form/FormField";
import { OrderFormShell } from "@/ui/trading-terminal/order-form/OrderFormShell";
import { OrderSizeCard } from "@/ui/trading-terminal/order-form/OrderSizeCard";
import { SideToggle } from "@/ui/trading-terminal/order-form/SideToggle";
import { SlippageRow } from "@/ui/trading-terminal/order-form/SlippageRow";
import { SubmitButton } from "@/ui/trading-terminal/order-form/SubmitButton";
import { SummaryRow } from "@/ui/trading-terminal/order-form/SummaryRow";
import type { TokenSymbol } from "@/ui/trading-terminal/order-form/TokenUnit";

const ORDER_TYPES = ["Market", "Limit"] as const;

type FutureOrderType = (typeof ORDER_TYPES)[number];

/** Long and Short, each with what it gains on: the naira on the v1 series, the base on a v2 one. */
function sidesFor(state: FutureState | null) {
  const american = state?.terms === "american";
  const base = state?.baseSymbol ?? "cNGN";
  return [
    {
      label: "Long",
      tone: "buy",
      tooltip: american
        ? `Gains if ${base} strengthens against USDC`
        : "Gains if the naira weakens",
      value: "long",
    },
    {
      label: "Short",
      tone: "sell",
      tooltip: american
        ? `Gains if ${base} weakens against USDC`
        : "Gains if the naira strengthens",
      value: "short",
    },
  ] as const;
}

export type FutureOrderRequest = {
  side: FutureSide;
  orderType: FutureOrderType;
  /** In the series' price unit; the limit for a limit order, ignored for a market order (priced off the touch). */
  limitPrice: string;
  /** The size in the venue's whole units, `unitSize` of the series' `sizeSymbol` each. */
  units: number;
  /** How far through the touch a market order is signed, as a fraction. */
  maxSlippage: number;
  /** Ask the venue to hold the order to the account's position: it never opens or flips one. */
  reduceOnly: boolean;
};

const USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function formatUsd(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${USD.format(value)} USDC`;
}

function parsePrice(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const SIZE_PATTERN = /^\d+(\.\d+)?$/;

/** A typed size or amount, or null unless it is a positive decimal. */
function parseSize(value: string) {
  const trimmed = value.replaceAll(",", "").trim();
  if (!SIZE_PATTERN.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : null;
}

const SIZE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A signed size as the position it is: "Long 10 USDC", "Long 250,000 cNGN", "Flat". */
function formatPosition(size: number, symbol: string) {
  if (Math.abs(size) < 1e-9) {
    return "Flat";
  }
  return `${size > 0 ? "Long" : "Short"} ${SIZE.format(Math.abs(size))} ${symbol}`;
}

/** The position now and after the order: "Long 2 USDC → Long 1,002 USDC"; a dash without an order. */
function formatPositionChange(position: number, after: number | null, symbol: string) {
  return after === null
    ? "—"
    : `${formatPosition(position, symbol)} → ${formatPosition(after, symbol)}`;
}

const TOKEN_SYMBOLS: readonly string[] = ["cNGN", "EURC", "USDC"] satisfies TokenSymbol[];

/** A series' symbol as the size card names it: every listed base is one of its tokens. */
function tokenSymbol(symbol: string): TokenSymbol {
  return TOKEN_SYMBOLS.includes(symbol) ? (symbol as TokenSymbol) : "USDC";
}

/**
 * The size field's second unit, and how its figure is rounded: cNGN on the v1 series (the USDC
 * size times cNGN per USDC, whole cNGN), USDC on a v2 one (the base size times USDC per base, to
 * the cent). Either way it is the size times the price.
 */
function altUnitOf(state: FutureState | null) {
  return state?.terms === "american"
    ? { decimals: 2, symbol: "USDC" as const }
    : { decimals: 0, symbol: "cNGN" as const };
}

/**
 * The ticket's size, kept in both units: the series' `sizeSymbol` is the figure underneath (what
 * the order is signed in), its value in the second unit follows through the ticket's price. Typed
 * in the second unit, the size is rounded down to the venue's step, so the order never exceeds what
 * was typed.
 */
function useFutureSize(price: number | null, state: FutureState | null) {
  const sizeSymbol = tokenSymbol(state?.sizeSymbol ?? "USDC");
  const unitSize = state?.unitSize ?? 1;
  const alt = altUnitOf(state);
  const [size, setSizeText] = useState("");
  const [altSize, setAltSize] = useState("");
  const [showAlt, setShowAlt] = useState(false);
  const priced = price !== null && price > 0;

  function altOf(value: number | null) {
    return value === null || !priced ? "" : (value * price).toFixed(alt.decimals);
  }

  function onInput(value: string) {
    if (!showAlt) {
      setSizeText(value);
      setAltSize(altOf(parseSize(value)));
      return;
    }
    setAltSize(value);
    const typed = parseSize(value);
    const next =
      typed === null || !priced || unitSize <= 0
        ? null
        : Math.floor(typed / price / unitSize) * unitSize;
    setSizeText(next === null || next <= 0 ? "" : String(next));
  }

  /** Sets the size from the slider or MAX; the second unit follows. */
  function setSize(value: number) {
    setSizeText(value <= 0 ? "" : String(value));
    setAltSize(altOf(value > 0 ? value : null));
  }

  function toggleUnit() {
    setShowAlt(!showAlt);
    setAltSize(altOf(parseSize(size)));
  }

  return {
    altSize,
    altSymbol: alt.symbol,
    onInput,
    setSize,
    shown: showAlt ? altSize : size,
    showAlt,
    size,
    sizeSymbol,
    toggleUnit,
    unit: showAlt ? alt.symbol : sizeSymbol,
  };
}

/** What the Size field counts, for its tooltip. */
function sizeTooltip(
  fields: ReturnType<typeof useFutureSize>,
  state: FutureState | null,
  price: number | null
) {
  const unitSize = state?.unitSize ?? 1;
  const contractSize = state?.contractSize ?? 1000;
  const symbol = fields.sizeSymbol;
  const steps = `in steps of ${SIZE.format(unitSize)} ${symbol}; one contract is ${SIZE.format(contractSize)} ${symbol}`;
  const signed = state?.terms === "american" ? symbol : "USDC of notional";
  if (!fields.showAlt) {
    return `${signed}, ${steps}.`;
  }
  const at =
    price === null || state === null
      ? ""
      : ` at ${formatFuturePrice(price, state.priceDecimals)} ${state.priceUnit}`;
  return `The size as its ${fields.altSymbol} value${at}. The order is signed in ${signed}, ${steps}.`;
}

/** What MAX would set, for its tooltip. */
function maxSizeTitle(maxSize: number, symbol: string, hasAccount: boolean) {
  return hasAccount
    ? `${SIZE.format(maxSize)} ${symbol}: the most the account's margin can open on this side`
    : "Needs an account";
}

/**
 * The account's leverage once this order fills, against the engine's ceiling (1 / its initial
 * rate). Past the ceiling the engine refuses the order: the figure turns red and is marked
 * "Above max" with a warning sign, so the state does not rest on colour alone.
 */
function FutureLeverageRow({
  leverage,
  maxLeverage,
}: {
  leverage: number | null;
  maxLeverage: number | null;
}) {
  const overCeiling = leverage !== null && maxLeverage !== null && leverage > maxLeverage + 1e-9;
  const tone =
    leverage === null || leverage === 0 ? "text-panel-text-muted" : "text-panel-text-active";
  return (
    <div className="flex items-center justify-between gap-2 px-0.5 text-[12px]">
      <FieldLabel
        tooltip={`Your account's leverage after this order: the position's notional over the margin the engine credits you (USDC in full, any other collateral at its factor). The engine opens up to ${maxLeverage === null ? "its ceiling" : formatLeverage(maxLeverage)}; it margins the account as a whole, so there is no per-position leverage to set.`}
      >
        Position Leverage
      </FieldLabel>
      <span
        className={cn(
          "flex items-center gap-1.5 font-semibold tabular-nums",
          overCeiling ? "text-ask-text" : tone
        )}
      >
        {overCeiling ? (
          <span className="flex items-center gap-1 font-medium text-[11px]">
            <TriangleAlert aria-hidden className="size-3.5" />
            Above max
          </span>
        ) : null}
        {leverage === null ? "—" : formatLeverage(leverage)}
        {maxLeverage === null ? null : (
          <span className="font-normal text-panel-text-muted">/ {formatLeverage(maxLeverage)}</span>
        )}
      </span>
    </div>
  );
}

/** The price the second unit converts at: the typed limit, else the touch the order would cross. */
function sizingPrice(inputs: {
  bestAsk: number | null;
  bestBid: number | null;
  limitPrice: string;
  orderType: FutureOrderType;
  referencePrice: number | null;
  side: FutureSide;
}) {
  if (inputs.orderType === "Limit") {
    return parsePrice(inputs.limitPrice);
  }
  return (inputs.side === "long" ? inputs.bestAsk : inputs.bestBid) ?? inputs.referencePrice;
}

/** The size in the unit not shown, under the typed figure. */
function otherUnitText(fields: ReturnType<typeof useFutureSize>) {
  if (!fields.showAlt) {
    const digits = fields.altSymbol === "USDC" ? 2 : 0;
    const alt = fields.altSize === "" ? 0 : Number(fields.altSize);
    return `${alt.toLocaleString("en-US", { maximumFractionDigits: digits })} ${fields.altSymbol}`;
  }
  return `${fields.size === "" ? "0" : SIZE.format(Number(fields.size))} ${fields.sizeSymbol}`;
}

/** The size card, sized in the series' `sizeSymbol` with its value in the second unit, and the step hint under it. */
function FutureSizeField({
  fields,
  hasAccount,
  maxSize,
  onEdit,
  size,
  state,
  ticketPrice,
  validSize,
}: {
  fields: ReturnType<typeof useFutureSize>;
  hasAccount: boolean;
  maxSize: number;
  onEdit: () => void;
  size: number | null;
  state: FutureState | null;
  ticketPrice: number | null;
  validSize: boolean;
}) {
  const unitSize = state?.unitSize ?? 1;
  return (
    <div className="space-y-1">
      <OrderSizeCard
        baseUnit={fields.sizeSymbol}
        canToggleUnit={ticketPrice !== null && ticketPrice > 0}
        formatBase={(value) => SIZE.format(value)}
        inputId="future-size"
        max={hasAccount && maxSize >= unitSize ? maxSize : null}
        maxTitle={maxSizeTitle(maxSize, fields.sizeSymbol, hasAccount)}
        onInput={(value) => {
          onEdit();
          fields.onInput(value);
        }}
        onSetBase={(value) => {
          onEdit();
          fields.setSize(value);
        }}
        onToggleUnit={() => {
          onEdit();
          fields.toggleUnit();
        }}
        otherUnitText={otherUnitText(fields)}
        shown={fields.shown}
        size={size}
        step={unitSize}
        tooltip={sizeTooltip(fields, state, ticketPrice)}
        unit={fields.unit}
      />
      {!validSize && fields.size !== "" ? (
        <p className="text-[11px] text-panel-text-muted tabular-nums">
          Whole steps of {SIZE.format(unitSize)} {fields.sizeSymbol}, at least{" "}
          {SIZE.format(unitSize)}.
        </p>
      ) : null}
    </div>
  );
}

/** Why the ticket's price cannot be signed, or null when it can. */
function describePriceProblem(inputs: {
  band: FutureState["fillBand"];
  orderType: FutureOrderType;
  state: FutureState | null;
  touch: number | null;
  typedLimit: number | null;
}): string | null {
  const digits = inputs.state?.priceDecimals ?? 2;
  if (inputs.state !== null && inputs.band === null) {
    return "The venue cannot read the fill band right now; orders resume when it can.";
  }
  if (inputs.orderType === "Market") {
    return inputs.touch === null ? "No resting liquidity on that side. Use a limit order." : null;
  }
  if (inputs.typedLimit === null) {
    return `Enter a limit price in ${inputs.state?.priceUnit ?? "cNGN per USDC"}.`;
  }
  return isOutsideFillBand(inputs.typedLimit, inputs.band) && inputs.band !== null
    ? `Outside the fill band: orders must be between ${formatFuturePrice(inputs.band.low, digits)} and ${formatFuturePrice(inputs.band.high, digits)}.`
    : null;
}

/**
 * A market order is a limit that rests: what the book does not hold inside the slippage stays on
 * the book instead of filling, which the trader should know before signing. Null when it all fills.
 */
function describeDepthShortfall(inputs: {
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  maxSlippage: number;
  orderType: FutureOrderType;
  side: FutureSide;
  size: number | null;
  state: FutureState | null;
}) {
  const { size, state } = inputs;
  if (inputs.orderType === "Limit" || size === null || state === null || !(state.unitSize > 0)) {
    return null;
  }
  const fillable = futureMarketableSize({
    asks: inputs.asks,
    band: state.fillBand,
    bids: inputs.bids,
    maxSlippage: inputs.maxSlippage,
    side: inputs.side,
    unitSize: state.unitSize,
  });
  if (fillable >= size - 1e-9) {
    return null;
  }
  const symbol = state.sizeSymbol;
  return `The book fills ${SIZE.format(fillable)} ${symbol} within ${SIZE.format(inputs.maxSlippage * 100)}% slippage; the other ${SIZE.format(size - fillable)} ${symbol} would rest as a limit order.`;
}

/**
 * Everything the ticket shows that follows from its fields and the market: whether the series
 * takes orders, the size, the price it would trade at and what is wrong with it, and the margin.
 */
function deriveTicket(inputs: {
  account: FutureAccount | null;
  asks: OrderBookLevel[];
  bids: OrderBookLevel[];
  bestAsk: number | null;
  bestBid: number | null;
  limitPrice: string;
  maxSlippage: number;
  nowMs: number;
  orderType: FutureOrderType;
  reduceOnly: boolean;
  referencePrice: number | null;
  side: FutureSide;
  size: string;
  state: FutureState | null;
  takerFeeBps: number | null;
}) {
  const { account, orderType, side, state, takerFeeBps } = inputs;
  const size = parseSize(inputs.size);
  const units = state === null || size === null ? null : futureOrderUnits(size, state);
  const typedLimit = parsePrice(inputs.limitPrice);
  const touch = side === "long" ? inputs.bestAsk : inputs.bestBid;
  const priceError = describePriceProblem({
    band: state?.fillBand ?? null,
    orderType,
    state,
    touch,
    typedLimit,
  });
  const position = state === null ? 0 : futurePositionSize(account, state);
  const reduce = futureReduceOnlyTerms({
    position,
    reduceOnly: inputs.reduceOnly,
    side,
    size,
    unitSize: state?.unitSize ?? 1,
  });
  // A market order's price is the book walked for its size, not the touch alone.
  const fill =
    state === null || orderType === "Limit"
      ? { averagePrice: null, slippage: null }
      : estimateFutureFill({ asks: inputs.asks, bids: inputs.bids, side, size });
  const expectedPrice =
    orderType === "Limit" ? typedLimit : (fill.averagePrice ?? touch ?? inputs.referencePrice);
  // Under Reduce Only the venue fills no more than the position: the figures are that fill's. A v2
  // series values the size at the price it trades at.
  const estimate =
    state === null || reduce.filled === null || units === null
      ? null
      : estimateFutureOrder({
          account,
          price: expectedPrice,
          side,
          size: reduce.filled,
          state,
          takerFeeBps,
        });
  const depthNote = describeDepthShortfall({
    asks: inputs.asks,
    bids: inputs.bids,
    maxSlippage: inputs.maxSlippage,
    orderType,
    side,
    // Under Reduce Only the venue takes no more than the position, so that is the size.
    size: reduce.filled,
    state,
  });
  // MAX and leverage value a v2 size at the ticket's price before there is an order to price.
  const sizingAt = expectedPrice ?? inputs.referencePrice;
  return {
    block:
      state === null
        ? "The future isn't listed on the venue right now."
        : futureTradingBlock(state, inputs.nowMs),
    depthNote,
    estimate,
    expectedPrice,
    leverage:
      state === null
        ? { leverage: null, maxLeverage: null }
        : estimateFutureLeverage({
            account,
            afterSize: estimate?.after ?? position,
            price: sizingAt,
            state,
          }),
    maxSize:
      reduce.maxSize ??
      (state === null ? 0 : maxFutureSize({ account, price: sizingAt, side, state, takerFeeBps })),
    reduce,
    slippage: fill.slippage,
    size,
    position,
    priceError,
    // An empty limit field is not yet an error worth a line; the disabled button says enough.
    shownPriceError: orderType === "Limit" && inputs.limitPrice === "" ? null : priceError,
    units,
  };
}

/** The figures under the ticket: price, notional, margin, slippage, fees and the position after. */
/** The slippage line once there is an order to slip; a dash before. */
function SlippageLine({
  maxSlippage,
  onMaxSlippageChange,
  sized,
  slippage,
}: {
  maxSlippage: number;
  onMaxSlippageChange: (max: number) => void;
  sized: boolean;
  /** How far past the touch the size is expected to fill, walked through the book. */
  slippage: number | null;
}) {
  return sized ? (
    <SlippageRow estimate={slippage} max={maxSlippage} onMaxChange={onMaxSlippageChange} />
  ) : (
    <SummaryRow label="Slippage" value="—" />
  );
}

/** The summary's tooltips that differ by the series' terms. */
function summaryTooltips(state: FutureState | null) {
  const digits = state?.priceDecimals ?? 2;
  const mark = formatFuturePrice(state?.markPrice ?? null, digits);
  if (state?.terms === "american") {
    return {
      notional: `The size's value in USDC at the expected price: one contract is ${SIZE.format(state.contractSize)} ${state.sizeSymbol}`,
      touch: `The touch a market order crosses, ${state.priceUnit}`,
      vm: `Settled in USDC on the fill: the gap between the fill price and the mark (${mark}), times the size. A long filled above the mark, or a short below it, pays it.`,
    };
  }
  return {
    notional: `The size in USDC, whatever the price: one contract is ${USD.format(state?.contractSize ?? 1000)} USDC`,
    touch: "The touch a market order crosses, cNGN per USDC",
    vm: `Settled in cNGN on the fill: the gap between the fill price and the mark (${mark}), times the size. A long filled above the mark, or a short below it, pays it; USDC covers any cNGN the account lacks.`,
  };
}

function TicketSummary({
  estimate,
  expectedPrice,
  hasAccount,
  maxSlippage,
  onMaxSlippageChange,
  orderType,
  position,
  side,
  slippage,
  state,
  takerFeeBps,
}: {
  estimate: ReturnType<typeof estimateFutureOrder> | null;
  expectedPrice: number | null;
  hasAccount: boolean;
  maxSlippage: number;
  onMaxSlippageChange: (max: number) => void;
  orderType: FutureOrderType;
  position: number;
  side: FutureSide;
  slippage: number | null;
  state: FutureState | null;
  takerFeeBps: number | null;
}) {
  const shortfall = estimate?.shortfall ?? 0;
  // The engine's last mark: what a fill's VM is settled against.
  const markPrice = state?.markPrice ?? null;
  const digits = state?.priceDecimals ?? 2;
  const sizeSymbol = state?.sizeSymbol ?? "USDC";
  const tooltips = summaryTooltips(state);
  // No size, no order: every figure about it is a dash rather than a figure for nothing.
  const sized = estimate !== null;
  return (
    <>
      <div className="space-y-0.5">
        <SummaryRow
          label="Expected Price"
          tooltip={
            orderType === "Limit" ? "A limit order trades at its limit or better" : tooltips.touch
          }
          value={sized ? formatFuturePrice(expectedPrice, digits) : "—"}
        />
        <SummaryRow
          label="Notional"
          tooltip={tooltips.notional}
          value={formatUsd(estimate?.notional ?? null)}
        />
        <SummaryRow
          label="Initial Margin"
          tooltip="What the order adds to the position, at the engine's initial margin rate. Reducing a position needs none."
          value={formatUsd(estimate?.initialMargin ?? null)}
        />
        {orderType === "Limit" ? null : (
          <SlippageLine
            maxSlippage={maxSlippage}
            onMaxSlippageChange={onMaxSlippageChange}
            sized={sized}
            slippage={slippage}
          />
        )}
        <SummaryRow
          label="VM at Mark"
          tooltip={tooltips.vm}
          value={
            sized && state !== null
              ? formatFutureVm(
                  futureFillVm({ markPrice, price: expectedPrice, side, size: estimate.size }),
                  markPrice,
                  state
                )
              : "—"
          }
        />
        <SummaryRow
          label="Fees"
          tooltip="The venue's taker fee on the notional, in USDC. A resting limit that is hit pays none."
          value={
            takerFeeBps === null || !sized
              ? "—"
              : `${formatFutureUsdc(estimate?.fee ?? null)} (${takerFeeBps / 100}%)`
          }
        />
        <SummaryRow
          label="Position After"
          tooltip="Your position in the series now, and once this order fills in full."
          value={formatPositionChange(position, estimate?.after ?? null, sizeSymbol)}
        />
      </div>

      {shortfall > 0 && hasAccount ? (
        <p className="text-[11px] text-panel-text-muted leading-snug">
          Needs {USD.format(shortfall)} USDC more margin than the account has free.
        </p>
      ) : null}
    </>
  );
}

/**
 * The confirm popup's copy and rows for a futures order, in the ticket's terms: the side and its
 * USDC size, then the price it trades at, its notional, the margin it adds, the fee charged and
 * the most it is signed to pay, and the position it leaves.
 */
function buildFutureConfirmation(inputs: {
  estimate: ReturnType<typeof estimateFutureOrder>;
  expectedPrice: number | null;
  orderType: FutureOrderType;
  position: number;
  reducing: boolean;
  side: FutureSide;
  state: FutureState;
  takerFeeBps: number | null;
}) {
  const { estimate, side, state } = inputs;
  const verb = side === "long" ? "long" : "short";
  return {
    confirmLabel: `Confirm ${verb}`,
    directionLabel: side === "long" ? "Long" : "Short",
    orderSide: futureOrderUiSide(side),
    sizeLabel: `${SIZE.format(estimate.size)} ${state.sizeSymbol}`,
    title: `Confirm ${verb}`,
    summaryRows: [
      {
        label: inputs.orderType === "Limit" ? "Limit price" : "Expected price",
        value: formatFuturePrice(inputs.expectedPrice, state.priceDecimals),
      },
      { label: "Notional", value: formatUsd(estimate.notional) },
      { label: "Initial margin", value: formatUsd(estimate.initialMargin) },
      ...(inputs.takerFeeBps === null
        ? []
        : [{ label: "Taker fee", value: formatFutureUsdc(estimate.fee) }]),
      {
        label: "Max fee",
        value: formatFutureUsdc(
          estimate.notional === null ? null : futureMaxFeeUsdc(estimate.notional)
        ),
      },
      {
        label: "Position after",
        value: formatPositionChange(inputs.position, estimate.after, state.sizeSymbol),
      },
      ...(inputs.reducing ? [{ label: "Reduce only", value: "Yes" }] : []),
    ],
  };
}

type ButtonState = { enabled: boolean; label: string; tone: "buy" | "sell" | "neutral" };

function resolveButton(inputs: {
  account: FutureAccount | null;
  blocked: boolean;
  size: number | null;
  sizeSymbol: string;
  hasAccount: boolean;
  hasWallet: boolean;
  isAccepted: boolean;
  isFilled: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  priceError: string | null;
  shortfall: number | null;
  side: FutureSide;
}): ButtonState {
  const neutral = (label: string, enabled: boolean): ButtonState => ({
    enabled,
    label,
    tone: "neutral",
  });
  if (inputs.blocked) {
    return neutral("Trading closed", false);
  }
  if (!inputs.hasWallet) {
    return neutral("Connect wallet", true);
  }
  if (inputs.isPreparingAccount) {
    return neutral("Loading account…", false);
  }
  if (!inputs.hasAccount) {
    return neutral("Deposit to open your account", true);
  }
  if (inputs.isSubmitting) {
    return neutral("Submitting…", false);
  }
  if (inputs.isAccepted) {
    return neutral("Accepted", false);
  }
  if (inputs.isFilled) {
    return neutral("Filled", false);
  }
  if (inputs.shortfall !== null && inputs.shortfall > 0) {
    return neutral("Deposit margin", true);
  }
  const verb = inputs.side === "long" ? "Long" : "Short";
  const label =
    inputs.size === null ? verb : `${verb} ${SIZE.format(inputs.size)} ${inputs.sizeSymbol}`;
  return {
    enabled: inputs.size !== null && inputs.priceError === null && inputs.account !== null,
    label,
    tone: futureOrderUiSide(inputs.side),
  };
}

/** The limit field's unit, placeholder and tooltip, and the margin line's note, by the series' terms. */
function ticketCopy(state: FutureState | null) {
  if (state?.terms === "american") {
    return {
      availableMargin:
        "The account's initial margin surplus across its futures positions: what new positions can draw on. Profit and loss arrive as variation margin, in USDC, at each hourly mark.",
      limitPlaceholder: (0).toFixed(state.priceDecimals),
      limitTooltip: state.priceUnit,
      limitUnit: "USDC",
    };
  }
  return {
    availableMargin:
      "The account's initial margin surplus, across spot holdings and futures positions: what new positions can draw on. Profit and loss arrive as variation margin at each hourly mark.",
    limitPlaceholder: "0.00",
    limitTooltip: "cNGN per USDC",
    limitUnit: "cNGN",
  };
}

/**
 * The future's order ticket, in the series' own terms. On the v1 series the size is USDC of
 * notional in whole venue units (1 USDC; a contract is 1,000) and the price cNGN per USDC: a long
 * gains as cNGN weakens. On a v2 series the size is the base (1,000 cNGN or 1 EURC a unit) and the
 * price USDC per base: a long is long the base, and the notional is the size at the price. Every
 * order must sit inside the fill band around the index, which the ticket checks before signing. The
 * engine margins the whole account at its initial rate on what an order adds to the position;
 * reducing one is always allowed. Without a live series (`state` null) the form renders but cannot
 * submit.
 */
export function FutureOrderFormPanel({
  account,
  asks,
  bestAsk,
  bestBid,
  bids,
  hasAccount,
  hasWallet,
  isAccepted,
  isFilled,
  isPreparingAccount,
  isSubmitting,
  lastAction,
  nowMs,
  onConnect,
  onDepositRequest,
  onEdit,
  onSubmit,
  referencePrice,
  state,
  takerFeeBps,
}: {
  account: FutureAccount | null;
  /** The resting book, touch first: what a market order walks for its price and slippage. */
  asks: OrderBookLevel[];
  bestAsk: number | null;
  bestBid: number | null;
  bids: OrderBookLevel[];
  /** The wallet has its trading account under the MarginEngine. */
  hasAccount: boolean;
  hasWallet: boolean;
  isAccepted: boolean;
  isFilled: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  lastAction: string | null;
  nowMs: number;
  onConnect: () => void;
  onDepositRequest: () => void;
  onEdit: () => void;
  onSubmit?: (request: FutureOrderRequest) => void;
  /** The price a market order fills near, in the series' terms: the touch, else the mark. */
  referencePrice: number | null;
  state: FutureState | null;
  takerFeeBps: number | null;
}) {
  const [side, setSide] = useState<FutureSide>("long");
  const [orderType, setOrderType] = useState<FutureOrderType>("Market");
  const [limitPrice, setLimitPrice] = useState("");
  const [maxSlippage, setMaxSlippage] = useState(PERP_DEFAULT_MAX_SLIPPAGE);
  /** The order awaiting the confirm popup; null while it is closed. */
  const [pending, setPending] = useState<FutureOrderRequest | null>(null);
  const [reduceOnly, setReduceOnly] = useState(false);
  const ticketPrice = sizingPrice({
    bestAsk,
    bestBid,
    limitPrice,
    orderType,
    referencePrice,
    side,
  });
  const fields = useFutureSize(ticketPrice, state);
  const copy = ticketCopy(state);

  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      onEdit();
      set(value);
    };
  }

  const {
    block,
    depthNote,
    estimate,
    expectedPrice,
    leverage,
    maxSize,
    position,
    priceError,
    reduce,
    shownPriceError,
    size,
    slippage,
    units,
  } = deriveTicket({
    account,
    asks,
    bids,
    bestAsk,
    bestBid,
    limitPrice,
    maxSlippage,
    nowMs,
    orderType,
    reduceOnly,
    referencePrice,
    side,
    size: fields.size,
    state,
    takerFeeBps,
  });

  const button = resolveButton({
    account,
    blocked: block !== null || onSubmit === undefined,
    size: units === null ? null : size,
    sizeSymbol: fields.sizeSymbol,
    hasAccount,
    hasWallet,
    isAccepted,
    isFilled,
    isPreparingAccount,
    isSubmitting,
    // An order on the position's own side cannot be reduce-only: the venue would refuse it.
    priceError: priceError ?? reduce.error,
    shortfall: estimate?.shortfall ?? null,
    side,
  });

  function handleSubmit() {
    if (!hasWallet) {
      onConnect();
      return;
    }
    if (!hasAccount || (estimate?.shortfall ?? 0) > 0) {
      onDepositRequest();
      return;
    }
    if (
      onSubmit === undefined ||
      units === null ||
      priceError !== null ||
      reduce.error !== null ||
      estimate === null
    ) {
      return;
    }
    // Held until the trader confirms the figures; the order is the ticket's as it stands now.
    setPending({ limitPrice, maxSlippage, orderType, reduceOnly: reduce.reducing, side, units });
  }

  function handleConfirm() {
    if (pending !== null && onSubmit !== undefined) {
      onSubmit(pending);
    }
    setPending(null);
  }

  const confirmation =
    estimate === null || state === null
      ? null
      : buildFutureConfirmation({
          estimate,
          expectedPrice,
          orderType,
          position,
          reducing: reduce.reducing,
          side,
          state,
          takerFeeBps,
        });

  // A typed limit outside the band is said under the field, as it is typed; the status line keeps
  // what is not about the limit.
  const limitError = orderType === "Limit" ? shownPriceError : null;
  const statusText =
    block ?? lastAction ?? (limitError === null ? shownPriceError : null) ?? depthNote;

  return (
    <OrderFormShell
      footer={
        <>
          <TicketSummary
            estimate={estimate}
            expectedPrice={expectedPrice}
            hasAccount={hasAccount}
            maxSlippage={maxSlippage}
            onMaxSlippageChange={edited(setMaxSlippage)}
            orderType={orderType}
            position={position}
            side={side}
            slippage={slippage}
            state={state}
            takerFeeBps={takerFeeBps}
          />

          <SubmitButton
            busy={isSubmitting}
            disabled={!button.enabled}
            id="future-submit-cta"
            onClick={handleSubmit}
            tone={button.tone}
          >
            {button.label}
          </SubmitButton>

          {confirmation === null ? null : (
            <ConfirmOrderDialog
              {...confirmation}
              isSubmitting={isSubmitting}
              onConfirm={handleConfirm}
              onOpenChange={(open) => {
                if (!open) {
                  setPending(null);
                }
              }}
              open={pending !== null}
            />
          )}

          {statusText === null ? null : (
            <p className="text-[11px] text-panel-text-muted leading-snug">{statusText}</p>
          )}
        </>
      }
    >
      <SideToggle onSelect={edited(setSide)} options={sidesFor(state)} selected={side} />

      <OrderTypeTabs
        onSelect={edited(setOrderType)}
        orderTypes={ORDER_TYPES}
        selected={orderType}
      />

      <div className="space-y-2 pt-1 pb-0.5">
        <div className="flex items-center justify-between gap-2 px-0.5 text-[12px]">
          <span
            className="cursor-help text-[11px] text-panel-text-muted"
            title={copy.availableMargin}
          >
            Available margin
          </span>
          <span className="flex items-center gap-2 tabular-nums">
            <span className="text-panel-text">
              {formatUsd(account?.initialMarginSurplus ?? null)}
            </span>
            <button
              className="cursor-pointer font-medium text-[11px] text-accent-text hover:underline"
              onClick={onDepositRequest}
              type="button"
            >
              Deposit
            </button>
          </span>
        </div>

        {orderType === "Limit" ? (
          <div className="space-y-1">
            <FormField
              adornment={
                <span className="font-medium text-[12px] text-panel-text">{copy.limitUnit}</span>
              }
              id="future-limit-price"
              label="Limit price"
              onChange={edited(setLimitPrice)}
              placeholder={copy.limitPlaceholder}
              tooltip={copy.limitTooltip}
              value={limitPrice}
            />
            {limitError === null ? null : (
              <p className="text-[11px] text-ask-text leading-snug" role="alert">
                {limitError}
              </p>
            )}
          </div>
        ) : null}

        <FutureSizeField
          fields={fields}
          hasAccount={hasAccount}
          maxSize={maxSize}
          onEdit={onEdit}
          size={size}
          state={state}
          ticketPrice={ticketPrice}
          validSize={units !== null}
        />
        <FutureLeverageRow leverage={leverage.leverage} maxLeverage={leverage.maxLeverage} />
        <CheckboxRow
          checked={reduce.reducing}
          disabled={Math.abs(position) < 1e-9}
          id="future-reduce-only"
          label="Reduce Only"
          onChange={edited(setReduceOnly)}
          tooltip={
            Math.abs(position) < 1e-9
              ? "Needs an open position to reduce"
              : "The venue fills this order up to your open position and cancels the rest; it can never open or flip one"
          }
        />
        {reduce.error === null ? null : (
          <p className="text-[11px] text-ask-text leading-snug" role="alert">
            {reduce.error}
          </p>
        )}
      </div>
    </OrderFormShell>
  );
}
