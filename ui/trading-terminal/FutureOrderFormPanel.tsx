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
  futureFillVmCngn,
  futureMarketableUnits,
  futureMaxFeeUsdc,
  futureNotionalUsdc,
  futureOrderUiSide,
  futureOrderUnits,
  futureReduceOnlyTerms,
  futureTradingBlock,
  isOutsideFillBand,
  maxFutureNotional,
  toContracts,
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

const ORDER_TYPES = ["Market", "Limit"] as const;

type FutureOrderType = (typeof ORDER_TYPES)[number];

const SIDES = [
  { label: "Long", tone: "buy", tooltip: "Gains if the naira weakens", value: "long" },
  { label: "Short", tone: "sell", tooltip: "Gains if the naira strengthens", value: "short" },
] as const;

export type FutureOrderRequest = {
  side: FutureSide;
  orderType: FutureOrderType;
  /** cNGN per USDC; the limit for a limit order, ignored for a market order (priced off the touch). */
  limitPrice: string;
  /** The size in the venue's whole units, `unitUsdc` of notional each. */
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

/** The typed size, USDC of notional, or null unless it is a positive decimal. */
function parseNotional(value: string) {
  const trimmed = value.replaceAll(",", "").trim();
  if (!SIZE_PATTERN.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : null;
}

const SIZE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A signed notional as the position it is: "Long 10 USDC", "Flat". */
function formatPosition(notional: number) {
  if (Math.abs(notional) < 1e-9) {
    return "Flat";
  }
  return `${notional > 0 ? "Long" : "Short"} ${SIZE.format(Math.abs(notional))} USDC`;
}

/** The position now and after the order: "Long 2 USDC → Long 1,002 USDC"; a dash without an order. */
function formatPositionChange(position: number, after: number | null) {
  return after === null ? "—" : `${formatPosition(position)} → ${formatPosition(after)}`;
}

const SIZE_UNITS = ["USDC", "cNGN"] as const;

type SizeUnit = (typeof SIZE_UNITS)[number];

const CNGN = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

/**
 * The ticket's size, kept in both units: USDC of notional is the figure underneath (what the order
 * is signed in), its cNGN value follows through the ticket's price (cNGN per USDC). Typed in cNGN,
 * the USDC size is rounded down to the venue's step, so the order never exceeds what was typed.
 */
function useFutureSize(price: number | null, unitUsdc: number) {
  const [sizeUsdc, setSizeUsdc] = useState("");
  const [sizeCngn, setSizeCngn] = useState("");
  const [unit, setUnit] = useState<SizeUnit>("USDC");
  const priced = price !== null && price > 0;

  function cngnOf(usdc: number | null) {
    return usdc === null || !priced ? "" : String(Math.round(usdc * price));
  }

  function onInput(value: string) {
    if (unit === "USDC") {
      setSizeUsdc(value);
      setSizeCngn(cngnOf(parseNotional(value)));
      return;
    }
    setSizeCngn(value);
    const cngn = parseNotional(value);
    const usdc =
      cngn === null || !priced || unitUsdc <= 0
        ? null
        : Math.floor(cngn / price / unitUsdc) * unitUsdc;
    setSizeUsdc(usdc === null || usdc <= 0 ? "" : String(usdc));
  }

  /** Sets the size in USDC from the slider or MAX; the cNGN view follows. */
  function setUsdc(usdc: number) {
    setSizeUsdc(usdc <= 0 ? "" : String(usdc));
    setSizeCngn(cngnOf(usdc > 0 ? usdc : null));
  }

  function toggleUnit() {
    setUnit(unit === "USDC" ? "cNGN" : "USDC");
    setSizeCngn(cngnOf(parseNotional(sizeUsdc)));
  }

  return {
    onInput,
    setUsdc,
    shown: unit === "USDC" ? sizeUsdc : sizeCngn,
    sizeCngn,
    sizeUsdc,
    toggleUnit,
    unit,
  };
}

/** What the Size field counts, for its tooltip. */
function sizeTooltip(unit: SizeUnit, unitUsdc: number, contractSize: number, price: number | null) {
  const steps = `in steps of ${SIZE.format(unitUsdc)} USDC; one contract is ${USD.format(contractSize)} USDC`;
  if (unit === "USDC") {
    return `USDC of notional, ${steps}.`;
  }
  const at = price === null ? "" : ` at ${formatFuturePrice(price)} cNGN per USDC`;
  return `The size as its cNGN value${at}. The order is signed in USDC of notional, ${steps}.`;
}

/** What MAX would set, for its tooltip. */
function maxSizeTitle(maxNotional: number, hasAccount: boolean) {
  return hasAccount
    ? `${SIZE.format(maxNotional)} USDC: the most the account's margin can open on this side`
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
        tooltip={`Your account's leverage after this order: the position's notional over the margin the engine credits you (USDC in full, cNGN at its factor). The engine opens up to ${maxLeverage === null ? "its ceiling" : formatLeverage(maxLeverage)}; it margins the account as a whole, so there is no per-position leverage to set.`}
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

/** The price the cNGN view converts at: the typed limit, else the touch the order would cross. */
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
  if (fields.unit === "USDC") {
    return `${fields.sizeCngn === "" ? "0" : CNGN.format(Number(fields.sizeCngn))} cNGN`;
  }
  return `${fields.sizeUsdc === "" ? "0" : SIZE.format(Number(fields.sizeUsdc))} USDC`;
}

/** The size card, sized in USDC of notional with its cNGN value, and the step hint under it. */
function FutureSizeField({
  contractSize,
  fields,
  hasAccount,
  maxNotional,
  notional,
  onEdit,
  ticketPrice,
  unitUsdc,
  validSize,
}: {
  contractSize: number;
  fields: ReturnType<typeof useFutureSize>;
  hasAccount: boolean;
  maxNotional: number;
  notional: number | null;
  onEdit: () => void;
  ticketPrice: number | null;
  unitUsdc: number;
  validSize: boolean;
}) {
  return (
    <div className="space-y-1">
      <OrderSizeCard
        baseUnit="USDC"
        canToggleUnit={ticketPrice !== null && ticketPrice > 0}
        formatBase={(value) => SIZE.format(value)}
        inputId="future-size"
        max={hasAccount && maxNotional >= unitUsdc ? maxNotional : null}
        maxTitle={maxSizeTitle(maxNotional, hasAccount)}
        onInput={(value) => {
          onEdit();
          fields.onInput(value);
        }}
        onSetBase={(value) => {
          onEdit();
          fields.setUsdc(value);
        }}
        onToggleUnit={() => {
          onEdit();
          fields.toggleUnit();
        }}
        otherUnitText={otherUnitText(fields)}
        shown={fields.shown}
        size={notional}
        step={unitUsdc}
        tooltip={sizeTooltip(fields.unit, unitUsdc, contractSize, ticketPrice)}
        unit={fields.unit}
      />
      {!validSize && fields.sizeUsdc !== "" ? (
        <p className="text-[11px] text-panel-text-muted tabular-nums">
          Whole steps of {SIZE.format(unitUsdc)} USDC, at least {SIZE.format(unitUsdc)}.
        </p>
      ) : null}
    </div>
  );
}

/** Why the ticket's price cannot be signed, or null when it can. */
function describePriceProblem(inputs: {
  band: FutureState["fillBand"];
  hasState: boolean;
  orderType: FutureOrderType;
  touch: number | null;
  typedLimit: number | null;
}): string | null {
  if (inputs.hasState && inputs.band === null) {
    return "The venue cannot read the fill band right now; orders resume when it can.";
  }
  if (inputs.orderType === "Market") {
    return inputs.touch === null ? "No resting liquidity on that side. Use a limit order." : null;
  }
  if (inputs.typedLimit === null) {
    return "Enter a limit price in cNGN per USDC.";
  }
  return isOutsideFillBand(inputs.typedLimit, inputs.band) && inputs.band !== null
    ? `Outside the fill band: orders must be between ${formatFuturePrice(inputs.band.low)} and ${formatFuturePrice(inputs.band.high)}.`
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
  notional: number | null;
  orderType: FutureOrderType;
  side: FutureSide;
  state: FutureState | null;
}) {
  const { notional, state } = inputs;
  if (
    inputs.orderType === "Limit" ||
    notional === null ||
    state === null ||
    !(state.unitUsdc > 0)
  ) {
    return null;
  }
  const fillable =
    futureMarketableUnits({
      asks: inputs.asks,
      band: state.fillBand,
      bids: inputs.bids,
      maxSlippage: inputs.maxSlippage,
      side: inputs.side,
    }) * state.unitUsdc;
  if (fillable >= notional) {
    return null;
  }
  return `The book fills ${SIZE.format(fillable)} USDC within ${SIZE.format(inputs.maxSlippage * 100)}% slippage; the other ${SIZE.format(notional - fillable)} USDC would rest as a limit order.`;
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
  const notional = parseNotional(inputs.size);
  const units = state === null || notional === null ? null : futureOrderUnits(notional, state);
  const typedLimit = parsePrice(inputs.limitPrice);
  const touch = side === "long" ? inputs.bestAsk : inputs.bestBid;
  const priceError = describePriceProblem({
    band: state?.fillBand ?? null,
    hasState: state !== null,
    orderType,
    touch,
    typedLimit,
  });
  const position =
    account === null || state === null
      ? 0
      : futureNotionalUsdc(toContracts(account.positionUnits), state);
  const reduce = futureReduceOnlyTerms({
    notional,
    position,
    reduceOnly: inputs.reduceOnly,
    side,
    unitUsdc: state?.unitUsdc ?? 1,
  });
  // Under Reduce Only the venue fills no more than the position: the figures are that fill's.
  const estimate =
    state === null || reduce.filled === null || units === null
      ? null
      : estimateFutureOrder({ account, notional: reduce.filled, side, state, takerFeeBps });
  const depthNote = describeDepthShortfall({
    asks: inputs.asks,
    bids: inputs.bids,
    maxSlippage: inputs.maxSlippage,
    // Under Reduce Only the venue takes no more than the position, so that is the size.
    notional: reduce.filled,
    orderType,
    side,
    state,
  });
  // A market order's price is the book walked for its size, not the touch alone.
  const fill =
    state === null || orderType === "Limit"
      ? { averagePrice: null, slippage: null }
      : estimateFutureFill({ asks: inputs.asks, bids: inputs.bids, notional, side, state });
  return {
    block:
      state === null
        ? "The future isn't listed on the venue right now."
        : futureTradingBlock(state, inputs.nowMs),
    depthNote,
    estimate,
    expectedPrice:
      orderType === "Limit" ? typedLimit : (fill.averagePrice ?? touch ?? inputs.referencePrice),
    leverage:
      state === null
        ? { leverage: null, maxLeverage: null }
        : estimateFutureLeverage({ account, afterNotional: estimate?.after ?? position, state }),
    maxNotional:
      reduce.maxNotional ??
      (state === null ? 0 : maxFutureNotional({ account, side, state, takerFeeBps })),
    reduce,
    slippage: fill.slippage,
    notional,
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

function TicketSummary({
  contractSize,
  estimate,
  expectedPrice,
  hasAccount,
  markPrice,
  maxSlippage,
  onMaxSlippageChange,
  orderType,
  position,
  side,
  slippage,
  takerFeeBps,
}: {
  contractSize: number;
  estimate: ReturnType<typeof estimateFutureOrder> | null;
  expectedPrice: number | null;
  hasAccount: boolean;
  /** The engine's last mark, cNGN per USDC: what a fill's VM is settled against. */
  markPrice: number | null;
  maxSlippage: number;
  onMaxSlippageChange: (max: number) => void;
  orderType: FutureOrderType;
  position: number;
  side: FutureSide;
  slippage: number | null;
  takerFeeBps: number | null;
}) {
  const shortfall = estimate?.shortfall ?? 0;
  // No size, no order: every figure about it is a dash rather than a figure for nothing.
  const sized = estimate !== null;
  return (
    <>
      <div className="space-y-0.5">
        <SummaryRow
          label="Expected Price"
          tooltip={
            orderType === "Limit"
              ? "A limit order trades at its limit or better"
              : "The touch a market order crosses, cNGN per USDC"
          }
          value={sized ? formatFuturePrice(expectedPrice) : "—"}
        />
        <SummaryRow
          label="Notional"
          tooltip={`The size in USDC, whatever the price: one contract is ${USD.format(contractSize)} USDC`}
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
          tooltip={`Settled in cNGN on the fill: the gap between the fill price and the mark (${formatFuturePrice(markPrice)}), times the size. A long filled above the mark, or a short below it, pays it; USDC covers any cNGN the account lacks.`}
          value={
            sized
              ? formatFutureVm(
                  futureFillVmCngn({
                    markPrice,
                    notional: estimate?.notional ?? 0,
                    price: expectedPrice,
                    side,
                  }),
                  markPrice
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
          value={formatPositionChange(position, estimate?.after ?? null)}
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
  takerFeeBps: number | null;
}) {
  const { estimate, side } = inputs;
  const verb = side === "long" ? "long" : "short";
  return {
    confirmLabel: `Confirm ${verb}`,
    directionLabel: side === "long" ? "Long" : "Short",
    orderSide: futureOrderUiSide(side),
    sizeLabel: formatUsd(estimate.notional),
    title: `Confirm ${verb}`,
    summaryRows: [
      {
        label: inputs.orderType === "Limit" ? "Limit price" : "Expected price",
        value: formatFuturePrice(inputs.expectedPrice),
      },
      { label: "Notional", value: formatUsd(estimate.notional) },
      { label: "Initial margin", value: formatUsd(estimate.initialMargin) },
      ...(inputs.takerFeeBps === null
        ? []
        : [{ label: "Taker fee", value: formatFutureUsdc(estimate.fee) }]),
      { label: "Max fee", value: formatFutureUsdc(futureMaxFeeUsdc(estimate.notional)) },
      { label: "Position after", value: formatPositionChange(inputs.position, estimate.after) },
      ...(inputs.reducing ? [{ label: "Reduce only", value: "Yes" }] : []),
    ],
  };
}

type ButtonState = { enabled: boolean; label: string; tone: "buy" | "sell" | "neutral" };

function resolveButton(inputs: {
  account: FutureAccount | null;
  blocked: boolean;
  notional: number | null;
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
  const label = inputs.notional === null ? verb : `${verb} ${SIZE.format(inputs.notional)} USDC`;
  return {
    enabled: inputs.notional !== null && inputs.priceError === null && inputs.account !== null,
    label,
    tone: futureOrderUiSide(inputs.side),
  };
}

/**
 * The future's order ticket. Size is USDC of notional, in whole venue units (1 USDC; a contract is
 * 1,000), and the price is cNGN per USDC: a long gains as cNGN weakens, a short as it strengthens. Every order must sit inside the
 * fill band around the index, which the ticket checks before signing. The engine margins the whole
 * account at its initial rate on what an order adds to the position; reducing one is
 * always allowed. Without a live series (`state` null) the form renders but cannot submit.
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
  /** The price a market order fills near, cNGN per USDC: the touch, else the mark. */
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
  const contractSize = state?.contractSizeUsdc ?? 1000;
  const unitUsdc = state?.unitUsdc ?? 1;
  const ticketPrice = sizingPrice({
    bestAsk,
    bestBid,
    limitPrice,
    orderType,
    referencePrice,
    side,
  });
  const fields = useFutureSize(ticketPrice, unitUsdc);

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
    maxNotional,
    notional,
    position,
    priceError,
    reduce,
    shownPriceError,
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
    size: fields.sizeUsdc,
    state,
    takerFeeBps,
  });

  const button = resolveButton({
    account,
    blocked: block !== null || onSubmit === undefined,
    notional: units === null ? null : notional,
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
    estimate === null
      ? null
      : buildFutureConfirmation({
          estimate,
          expectedPrice,
          orderType,
          position,
          reducing: reduce.reducing,
          side,
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
            contractSize={contractSize}
            estimate={estimate}
            expectedPrice={expectedPrice}
            hasAccount={hasAccount}
            markPrice={state?.markPrice ?? null}
            maxSlippage={maxSlippage}
            onMaxSlippageChange={edited(setMaxSlippage)}
            orderType={orderType}
            position={position}
            side={side}
            slippage={slippage}
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
      <SideToggle onSelect={edited(setSide)} options={SIDES} selected={side} />

      <OrderTypeTabs
        onSelect={edited(setOrderType)}
        orderTypes={ORDER_TYPES}
        selected={orderType}
      />

      <div className="space-y-2 pt-1 pb-0.5">
        <div className="flex items-center justify-between gap-2 px-0.5 text-[12px]">
          <span
            className="cursor-help text-[11px] text-panel-text-muted"
            title="The account's initial margin surplus, across spot holdings and futures positions: what new positions can draw on. Profit and loss arrive as variation margin at each hourly mark."
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
              adornment={<span className="font-medium text-[12px] text-panel-text">cNGN</span>}
              id="future-limit-price"
              label="Limit price"
              onChange={edited(setLimitPrice)}
              placeholder="0.00"
              tooltip="cNGN per USDC"
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
          contractSize={contractSize}
          fields={fields}
          hasAccount={hasAccount}
          maxNotional={maxNotional}
          notional={notional}
          onEdit={onEdit}
          ticketPrice={ticketPrice}
          unitUsdc={unitUsdc}
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
