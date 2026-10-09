"use client";

import { ArrowLeftRight, ArrowRight, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatDollarPrice, formatNairaPerUsdc, formatPrice } from "@/lib/market-formatting";
import {
  describePerpMarginSources,
  estimateLiquidationPrice,
  estimatePerpEntry,
  estimatePositionLeverage,
  formatCngnAmount,
  formatLeverage,
  maxOrderSizeCngn,
  PERP_DEFAULT_MAX_SLIPPAGE,
  perpOrderUiSide,
  perpSubmitLabel,
  positionAfterOrder,
  TRADING_PAUSED_MESSAGE,
} from "@/lib/perp-market";
import type { PerpAccountMargin, PerpPosition, PerpState } from "@/lib/perp-market.types";
import { TOKEN_ICONS } from "@/lib/token-icons";
import type { OrderBookLevel } from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";
import { CheckboxRow } from "@/ui/trading-terminal/order-form/CheckboxRow";
import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";
import { FormField } from "@/ui/trading-terminal/order-form/FormField";
import { OrderFormShell } from "@/ui/trading-terminal/order-form/OrderFormShell";
import { SideToggle } from "@/ui/trading-terminal/order-form/SideToggle";
import { SlippageRow } from "@/ui/trading-terminal/order-form/SlippageRow";
import { SubmitButton } from "@/ui/trading-terminal/order-form/SubmitButton";
import { SummaryRow } from "@/ui/trading-terminal/order-form/SummaryRow";
import type { TokenSymbol } from "@/ui/trading-terminal/order-form/TokenUnit";
import { TokenUnit } from "@/ui/trading-terminal/order-form/TokenUnit";

type PerpSide = "long" | "short";

const ORDER_TYPES = ["Market", "Limit"] as const;

type PerpOrderType = (typeof ORDER_TYPES)[number];

const SIDES = [
  { label: "Long", tone: "buy", value: "long" },
  { label: "Short", tone: "sell", value: "short" },
] as const;

export type PerpOrderRequest = {
  side: PerpSide;
  orderType: PerpOrderType;
  /** USDC per cNGN; the limit for a limit order, ignored for a market order (priced off the touch). */
  limitPrice: string;
  /** The figure the trader typed, in `sizeUnit`: cNGN contracts, or USDC to convert at the sizing price. */
  size: string;
  sizeUnit: "cNGN" | "USDC";
  /** Only shrink the open position: the venue clamps the fill to it and never opens or flips one. */
  reduceOnly: boolean;
  /** How far through the touch a market order is signed, as a fraction; ignored for a limit order. */
  maxSlippage: number;
};

const USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function parseAmount(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** A derived USDC amount as the input shows it: at most two decimals, no trailing zeros. */
function formatDerived(value: number) {
  return String(Number(value.toFixed(2)));
}

/** A derived cNGN size as the input shows it: whole contracts, which is what the engine rests. */
function formatDerivedCngn(value: number) {
  return String(Math.round(value));
}

const SIZE_UNITS = ["cNGN", "USDC"] as const satisfies readonly TokenSymbol[];

type SizeUnit = (typeof SIZE_UNITS)[number];

/** What the Size field counts, for its tooltip: cNGN contracts, or their USDC value at the ticket's price. */
function sizeTooltip(unit: SizeUnit, price: number | null) {
  if (unit === "cNGN") {
    return "What you trade: cNGN contracts, which is what the order is signed in.";
  }
  const at = price === null ? "" : ` at ${formatPrice(price)} USDC per cNGN`;
  return `What you trade, as its USDC value${at}. The order is signed in cNGN.`;
}

/**
 * The ticket's size, kept in both units: the cNGN size is the figure underneath (what the order
 * is signed in), its USDC value follows through the ticket's price (USDC per cNGN). The USDC
 * unit is a view of the size the trader can also type into.
 */
function usePerpSize(price: number | null) {
  const [sizeCngn, setSizeCngn] = useState("");
  const [sizeUsd, setSizeUsd] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("cNGN");
  const priced = price !== null && price > 0;

  function toUsd(cngn: number | null) {
    return cngn === null || !priced ? null : cngn * price;
  }

  function onSizeInput(value: string) {
    if (sizeUnit === "cNGN") {
      setSizeCngn(value);
      const usd = toUsd(parseAmount(value));
      setSizeUsd(usd === null ? "" : formatDerived(usd));
      return;
    }
    setSizeUsd(value);
    const usd = parseAmount(value);
    setSizeCngn(usd === null || !priced ? "" : formatDerivedCngn(usd / price));
  }

  /** Sets the size in cNGN from the slider or MAX; the USDC view follows. */
  function setCngn(cngn: number) {
    setSizeCngn(cngn <= 0 ? "" : formatDerivedCngn(cngn));
    const usd = toUsd(cngn > 0 ? cngn : null);
    setSizeUsd(usd === null ? "" : formatDerived(usd));
  }

  function toggleUnit() {
    setSizeUnit(sizeUnit === "cNGN" ? "USDC" : "cNGN");
    const usd = toUsd(parseAmount(sizeCngn));
    setSizeUsd(usd === null ? "" : formatDerived(usd));
  }

  return {
    onSizeInput,
    setCngn,
    /** What the Size field shows: the cNGN size, or its USDC value. */
    shown: sizeUnit === "cNGN" ? sizeCngn : sizeUsd,
    sizeCngn,
    sizeUnit,
    /** The size's USDC value at the ticket's price, as the USDC view would show it. */
    sizeUsd,
    toggleUnit,
  };
}

const SLIDER_MARKS = [25, 50, 75] as const;

/**
 * The order's size in one card: the label and unit switch on the left, the typed figure and its
 * value in the other unit on the right, and under them a slider across everything the account's
 * margin can open, with MAX at its end. The slider is inert, and visibly so, until the ticket
 * knows that ceiling: it never slides against a number it does not have.
 */
function OrderSizeCard({
  canToggleUnit,
  maxCngn,
  onInput,
  onSetCngn,
  onToggleUnit,
  otherUnitText,
  shown,
  sizeCngn,
  tooltip,
  unit,
}: {
  canToggleUnit: boolean;
  maxCngn: number | null;
  onInput: (value: string) => void;
  onSetCngn: (cngn: number) => void;
  onToggleUnit: () => void;
  otherUnitText: string;
  shown: string;
  sizeCngn: number | null;
  tooltip: string;
  unit: SizeUnit;
}) {
  const sliderDisabled = maxCngn === null || maxCngn <= 0;
  const sliderMax = sliderDisabled ? 1 : maxCngn;
  // Without a ceiling the track stays empty: a typed size has nothing to be a share of.
  const sliderValue = sliderDisabled ? 0 : Math.min(sizeCngn ?? 0, sliderMax);
  const fillPercent = (sliderValue / sliderMax) * 100;
  return (
    <div className="space-y-2 border border-panel-border px-3 py-2 focus-within:border-panel-text-muted">
      <div className="flex items-start justify-between gap-3">
        <div className="flex shrink-0 flex-col items-start gap-2 pt-0.5">
          <FieldLabel htmlFor="perp-size" tooltip={tooltip}>
            Order Size
          </FieldLabel>
          <button
            aria-label={`Size in ${unit}; switch to ${unit === "cNGN" ? "USDC" : "cNGN"}`}
            className="flex cursor-pointer items-center gap-1.5 border border-panel-border bg-input-bg px-2 py-1 font-semibold text-[12px] text-panel-text-active transition-colors hover:bg-input-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canToggleUnit}
            onClick={onToggleUnit}
            title={
              canToggleUnit
                ? undefined
                : "Needs a price: type a limit price, or wait for the market"
            }
            type="button"
          >
            <SmartImage<string>
              alt=""
              className="size-4 animate-none rounded-full"
              src={TOKEN_ICONS[unit]}
            />
            {unit}
            <ArrowLeftRight aria-hidden className="size-3 text-panel-text-muted" />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-end">
          <input
            className="w-full bg-transparent text-right font-semibold text-[22px] text-panel-text-active tabular-nums outline-none placeholder:text-panel-text-muted"
            id="perp-size"
            inputMode="decimal"
            onChange={(event) => onInput(event.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0"
            value={shown}
          />
          <span className="text-[12px] text-panel-text-muted tabular-nums">{otherUnitText}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative flex min-w-0 flex-1 items-center">
          {SLIDER_MARKS.map((mark) => (
            <span
              aria-hidden
              className="pointer-events-none absolute size-1.5 -translate-x-1/2 rounded-full bg-panel-text-muted/50"
              key={mark}
              style={{ left: `${mark}%` }}
            />
          ))}
          <input
            aria-label="Order size slider"
            aria-valuetext={`${formatCngnAmount(sliderValue)} cNGN`}
            className="relative h-1 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-40 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-panel-text-active [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-panel-text-active"
            disabled={sliderDisabled}
            max={sliderMax}
            min={0}
            onChange={(event) => onSetCngn(Number(event.target.value))}
            step={1}
            style={{
              background: `linear-gradient(to right, var(--buy) ${fillPercent}%, var(--input-hover) ${fillPercent}%)`,
            }}
            type="range"
            value={sliderValue}
          />
        </div>
        <button
          className="shrink-0 cursor-pointer border border-panel-border bg-input-bg px-2.5 py-1 font-semibold text-[11px] text-panel-text-active transition-colors hover:bg-input-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={sliderDisabled}
          onClick={() => maxCngn !== null && onSetCngn(maxCngn)}
          title={
            maxCngn === null
              ? "Needs an account and a price"
              : `${formatCngnAmount(maxCngn)} cNGN: the most the account's margin can open at this price`
          }
          type="button"
        >
          MAX
        </button>
      </div>
    </div>
  );
}

/** The sign's colour: the long colour above zero, the short colour below, muted at zero. */
function signTone(value: number) {
  if (value > 0) {
    return "text-bid-text";
  }
  return value < 0 ? "text-ask-text" : "text-panel-text-muted";
}

/** The position now and after this order, in cNGN, each coloured by its side. */
function PositionFigure({ current, next }: { current: number; next: number }) {
  if (current === 0 && next === 0) {
    return <span className="text-panel-text">—</span>;
  }
  return (
    <span className="flex items-center gap-1 tabular-nums">
      <span className={signTone(current)}>{formatCngnAmount(Math.abs(current))}</span>
      <ArrowRight aria-hidden className="size-3 text-panel-text-muted" />
      <span className={signTone(next)}>{formatCngnAmount(Math.abs(next))} cNGN</span>
    </span>
  );
}

/**
 * The account's headroom and its position on one line: each is a label and a figure that never
 * breaks inside itself, and the pair wraps onto two lines when seven-figure values need the
 * room, rather than overlapping or clipping. Usually one line, which is the row this saves.
 */
function AccountRow({
  availableMargin,
  marginSources,
  onDepositRequest,
  positionChange,
}: {
  availableMargin: number | null;
  marginSources: string | null;
  onDepositRequest?: () => void;
  positionChange: { current: number; next: number };
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[12px]">
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        {/* The account's initial-margin headroom; what it is made of sits in the tooltip. */}
        <FieldLabel
          tooltip={[
            "Cross-margin: everything in your perp account backs every position. USDC counts in full, cNGN at its index value times its margin factor. Profit and loss settle in USDC.",
            marginSources,
          ]
            .filter((part) => part !== null)
            .join(" ")}
        >
          Available to Trade
        </FieldLabel>
        <span className="font-medium text-panel-text tabular-nums">
          {availableMargin === null ? "—" : formatUsd(Math.max(0, availableMargin))}
        </span>
        <button
          aria-label="Deposit margin"
          className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-input-bg text-[12px] text-panel-text-muted leading-none ring-1 ring-panel-border transition-colors hover:text-panel-text-active"
          onClick={onDepositRequest}
          type="button"
        >
          +
        </button>
      </span>
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <FieldLabel tooltip="Your cNGN position now, and what it becomes if this order fills in full. A long is positive.">
          Position
        </FieldLabel>
        <PositionFigure current={positionChange.current} next={positionChange.next} />
      </span>
    </div>
  );
}

/**
 * The account's leverage once this order fills, against the SRM's ceiling. Past the ceiling the
 * venue would refuse the order, and the Deposit remedy on the button says so: the figure turns
 * red and is marked "Above max" with a warning sign, so the state does not rest on colour alone.
 */
function PositionLeverageRow({
  leverage,
  state,
}: {
  leverage: number | null;
  state: PerpState | null;
}) {
  const overCeiling = leverage !== null && state !== null && leverage > state.maxLeverage;
  const tone =
    leverage === null || leverage === 0 ? "text-panel-text-muted" : "text-panel-text-active";
  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <FieldLabel
        tooltip={`Your whole account's leverage after this order: the position's value at the ticket's price over the margin the SRM credits you (USDC in full, cNGN at its factor). The SRM opens up to ${state === null ? "its ceiling" : formatLeverage(state.maxLeverage)}; it margins the account together, so there is no per-position leverage to set.`}
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
      </span>
    </div>
  );
}

/**
 * Why a 1x short has a liquidation price and a 1x long has none: the position is a fixed amount of
 * cNGN valued in USDC, so a short's loss grows without bound as cNGN strengthens while a long can
 * lose at most its notional. Solving equity = requirement at 1x puts the short's liquidation at
 * 2 / (1 + mm) of entry; the long's equity always exceeds the maintenance requirement.
 */
function liquidationTooltip(state: PerpState | null) {
  const base =
    "If this were your only position, backed by everything available in your perp account.";
  if (state === null) {
    return base;
  }
  const mm = state.maintenanceMarginRate;
  const shortMove = Math.round((2 / (1 + mm) - 1) * 100);
  return `${base} The position is a fixed amount of cNGN valued in USDC, so a short's loss grows without bound as cNGN strengthens while a long can lose at most its notional: at 1x a short is liquidated about ${shortMove}% above entry, and a long at no price.`;
}

/** A USDC amount as the summary prints it: "$593,142.80"; "—" when unknown. */
function formatUsd(value: number | null) {
  return value === null ? "—" : `$${USD.format(value)}`;
}

/** The taker fee as a rate, with what it comes to on this order once the order has a value. */
function describeFee(takerFeeBps: number | null, feeUsd: number | null) {
  if (takerFeeBps === null) {
    return "—";
  }
  const rate = `${(takerFeeBps / 100).toFixed(2)}%`;
  return feeUsd === null ? rate : `${rate} (${formatUsd(feeUsd)})`;
}

type TicketInputs = {
  asks: OrderBookLevel[];
  availableMargin: number | null;
  bids: OrderBookLevel[];
  limitPrice: string;
  orderType: PerpOrderType;
  position: PerpPosition | null;
  reduceOnly: boolean;
  referencePrice: number | null;
  side: PerpSide;
  size: string;
  state: PerpState | null;
  takerFeeBps: number | null;
};

/**
 * Everything the ticket shows that follows from its inputs: the expected price and slippage, the
 * order's USDC value, fee, margin needed, shortfall, the position and leverage after it, and the
 * liq. price. The size is cNGN; its value, and everything charged on it, is at the expected price
 * (the typed limit, else the walk through the book for a market order of this size), so without
 * one the fee and margin are unknown rather than zero.
 */
function deriveTicket(inputs: TicketInputs) {
  const sizeCngn = parseAmount(inputs.size);
  const entry = estimatePerpEntry({
    asks: inputs.asks,
    bids: inputs.bids,
    limitPrice: parseAmount(inputs.limitPrice),
    orderType: inputs.orderType,
    referencePrice: inputs.referencePrice,
    side: inputs.side,
    sizeCngn,
  });
  const entryPrice = entry.expectedPrice;
  const notionalUsd = sizeCngn !== null && entryPrice !== null ? sizeCngn * entryPrice : null;
  const feeUsd =
    notionalUsd !== null && inputs.takerFeeBps !== null
      ? (notionalUsd * inputs.takerFeeBps) / 10_000
      : null;
  const requiredMargin =
    notionalUsd !== null && inputs.state !== null
      ? notionalUsd * inputs.state.initialMarginRate + (feeUsd ?? 0)
      : null;
  const shortfall =
    requiredMargin !== null &&
    inputs.availableMargin !== null &&
    requiredMargin > inputs.availableMargin
      ? requiredMargin - inputs.availableMargin
      : null;
  // Backed by everything the account has available, as cross-margin backs it; a position already
  // open is not folded in, since the SRM keeps no entry price to fold it in at.
  const liquidation =
    inputs.state !== null &&
    sizeCngn !== null &&
    entryPrice !== null &&
    inputs.availableMargin !== null &&
    inputs.position === null
      ? estimateLiquidationPrice({
          entryPrice,
          maintenanceMarginRate: inputs.state.maintenanceMarginRate,
          margin: Math.max(0, inputs.availableMargin),
          side: inputs.side,
          sizeCngn,
        })
      : null;
  const needsPrice = inputs.orderType === "Limit" && parseAmount(inputs.limitPrice) === null;
  const positionChange = positionAfterOrder({
    position: inputs.position,
    reduceOnly: inputs.reduceOnly,
    side: inputs.side,
    sizeCngn,
  });
  const positionLeverage = estimatePositionLeverage({
    availableMargin: inputs.availableMargin,
    nextPositionCngn: positionChange.next,
    position: inputs.position,
    price: entryPrice,
    state: inputs.state,
  });
  const maxSizeCngn = maxOrderSizeCngn({
    availableMargin: inputs.availableMargin,
    position: inputs.position,
    price: entryPrice ?? inputs.referencePrice,
    side: inputs.side,
    state: inputs.state,
    takerFeeBps: inputs.takerFeeBps,
  });
  return {
    expectedPrice: sizeCngn === null ? null : entryPrice,
    feeUsd,
    liquidation,
    // A reduce-only order can only be as large as the position it shrinks.
    maxSizeCngn:
      inputs.reduceOnly && inputs.position !== null
        ? Math.floor(inputs.position.uiSize)
        : maxSizeCngn,
    needsPrice,
    notionalUsd,
    positionChange,
    positionLeverage,
    requiredMargin,
    shortfall,
    sizeCngn,
    slippage: entry.slippage,
  };
}

/** Everything the ticket needs before the button trades. */
function isTicketComplete(inputs: {
  hasWallet: boolean;
  isLive: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  needsPrice: boolean;
  sizeCngn: number | null;
}) {
  return (
    inputs.isLive &&
    inputs.hasWallet &&
    !inputs.isSubmitting &&
    !inputs.isPreparingAccount &&
    inputs.sizeCngn !== null &&
    !inputs.needsPrice
  );
}

type ButtonInputs = {
  availableMargin: number | null;
  canSubmit: boolean;
  hasWallet: boolean;
  isAccepted: boolean;
  isFilled: boolean;
  isLive: boolean;
  isPreparingAccount: boolean;
  isPaused: boolean;
  isSubmitting: boolean;
  shortfall: number | null;
  side: PerpSide;
  sizeCngn: number | null;
};

/** What the one button says: it connects, deposits, or trades, depending on what is missing. */
function submitLabel(inputs: ButtonInputs) {
  const trade = perpSubmitLabel(inputs.side, inputs.sizeCngn);
  if (inputs.isPaused) {
    return "Trading paused";
  }
  if (!inputs.isLive) {
    return trade;
  }
  if (!inputs.hasWallet) {
    return "Connect wallet";
  }
  if (inputs.isPreparingAccount) {
    return "Loading account…";
  }
  if (inputs.isSubmitting) {
    return "Submitting…";
  }
  if (inputs.isAccepted) {
    return "Accepted";
  }
  if (inputs.isFilled) {
    return "Filled";
  }
  if (inputs.availableMargin === null || inputs.shortfall !== null) {
    return "Deposit margin";
  }
  return trade;
}

function isButtonEnabled(inputs: ButtonInputs) {
  // Until the status clears or the ticket is edited, so the same order is not sent twice.
  if (!inputs.isLive || inputs.isAccepted || inputs.isFilled) {
    return false;
  }
  return (
    !inputs.hasWallet ||
    inputs.availableMargin === null ||
    inputs.shortfall !== null ||
    inputs.canSubmit
  );
}

function notLiveMessage(state: PerpState | null) {
  if (state?.paused) {
    return TRADING_PAUSED_MESSAGE;
  }
  if (state !== null && !state.tradingEnabled) {
    return "The market opens at launch. Prices are live; orders are not accepted yet.";
  }
  return "Perp trading isn't live yet. Orders open when the market launches.";
}

/** The side's colour only when the button would trade; a connect or deposit remedy reads neutral. */
function buttonTone(inputs: ButtonInputs): "buy" | "sell" | "neutral" {
  if (!inputs.hasWallet || inputs.availableMargin === null || inputs.shortfall !== null) {
    return "neutral";
  }
  return perpOrderUiSide(inputs.side);
}

/**
 * The perp order ticket. Without a live perp (`state` null) it renders the form but cannot submit.
 * With one, the size slides across what the account's margin can open, and the order is checked
 * against the account's initial-margin surplus before it is signed. Size is what trades, in cNGN
 * contracts: it is the one field and the number the button and the summary repeat; its USDC value
 * at the ticket's price is the alternative unit. There is no leverage to set: the SRM margins the
 * whole account together, so the ticket reports the account's leverage after the order instead.
 */
export function PerpOrderFormPanel({
  account = null,
  asks = [],
  availableMargin = null,
  bids = [],
  hasWallet = false,
  isAccepted = false,
  isFilled = false,
  isPreparingAccount = false,
  isSubmitting = false,
  lastAction = null,
  onConnect,
  onDepositRequest,
  onEdit,
  onSubmit,
  position = null,
  referencePrice = null,
  state = null,
  takerFeeBps = null,
}: {
  /** The perp account's margin, by asset: what "Available to trade" is made of. */
  account?: PerpAccountMargin | null;
  /** The resting book, from the touch outward, that a market order of the ticket's size would walk. */
  asks?: OrderBookLevel[];
  bids?: OrderBookLevel[];
  /** The perp account's initial-margin surplus, USD; null before an account exists or is read. */
  availableMargin?: number | null;
  hasWallet?: boolean;
  /** The venue accepted the last order and its fill has not shown yet. */
  isAccepted?: boolean;
  /** The last order's fill has shown; cleared after a few seconds or on any edit. */
  isFilled?: boolean;
  isPreparingAccount?: boolean;
  isSubmitting?: boolean;
  lastAction?: string | null;
  onConnect?: () => void;
  onDepositRequest?: () => void;
  /** Any change to the ticket: the host clears the order status line on it. */
  onEdit?: () => void;
  onSubmit?: (request: PerpOrderRequest) => void;
  /** The account's open perp position, if any: what the Position row starts from and reduce-only needs. */
  position?: PerpPosition | null;
  /** The price a market order would fill near, USDC per cNGN: the touch, else the mark. */
  referencePrice?: number | null;
  state?: PerpState | null;
  takerFeeBps?: number | null;
}) {
  const [side, setSide] = useState<PerpSide>("long");
  const [orderType, setOrderType] = useState<PerpOrderType>("Market");
  const [limitPrice, setLimitPrice] = useState("");
  const [reduceOnly, setReduceOnly] = useState(false);
  const [maxSlippage, setMaxSlippage] = useState(PERP_DEFAULT_MAX_SLIPPAGE);
  /** Wraps a field setter so every edit also tells the host. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      onEdit?.();
      set(value);
    };
  }

  const isLive = state?.tradingEnabled === true && onSubmit !== undefined;
  const hasPosition = position !== null;
  const marginSources = describePerpMarginSources(account);
  // The price in use, USDC per cNGN: the limit price when one is typed, else the price a market
  // order fills near. It values the cNGN size in USDC and so sets the margin either way.
  const ticketPrice =
    orderType === "Limit" ? (parseAmount(limitPrice) ?? referencePrice) : referencePrice;
  const fields = usePerpSize(ticketPrice);
  const { sizeCngn: size, sizeUnit } = fields;
  const {
    expectedPrice,
    feeUsd,
    liquidation,
    maxSizeCngn,
    needsPrice,
    notionalUsd,
    positionChange,
    positionLeverage,
    requiredMargin,
    shortfall,
    sizeCngn,
    slippage,
  } = deriveTicket({
    asks,
    availableMargin,
    bids,
    limitPrice,
    orderType,
    position,
    reduceOnly: reduceOnly && hasPosition,
    referencePrice,
    side,
    size,
    state,
    takerFeeBps,
  });

  const canSubmit = isTicketComplete({
    hasWallet,
    isLive,
    isPreparingAccount,
    isSubmitting,
    needsPrice,
    sizeCngn,
  });
  const buttonInputs: ButtonInputs = {
    availableMargin,
    canSubmit,
    hasWallet,
    isAccepted,
    isFilled,
    isLive,
    side,
    isPreparingAccount,
    isPaused: state?.paused === true,
    isSubmitting,
    shortfall,
    sizeCngn,
  };
  const buttonEnabled = isButtonEnabled(buttonInputs);

  function handleSubmitClick() {
    if (!isLive) {
      return;
    }
    if (!hasWallet) {
      onConnect?.();
      return;
    }
    if (availableMargin === null || shortfall !== null) {
      onDepositRequest?.();
      return;
    }
    if (canSubmit) {
      onSubmit({
        limitPrice,
        maxSlippage,
        orderType,
        reduceOnly: reduceOnly && hasPosition,
        side,
        size: fields.shown,
        sizeUnit,
      });
    }
  }

  const statusText = isLive ? lastAction : notLiveMessage(state);

  return (
    <OrderFormShell
      footer={
        <>
          <div className="space-y-0.5">
            <SummaryRow
              label="Est. Liquidation Price"
              tooltip={liquidationTooltip(state)}
              value={formatDollarPrice(liquidation)}
            />
            <SummaryRow
              label="Expected Price"
              tooltip={
                orderType === "Limit"
                  ? "A limit order trades at its limit or better"
                  : "Where a market order of this size is expected to fill, walked through the resting book"
              }
              value={formatDollarPrice(expectedPrice)}
            />
            <SummaryRow
              label="Order Value"
              tooltip="The size in cNGN valued at the expected price"
              value={formatUsd(notionalUsd)}
            />
            <SummaryRow
              label="Margin Required"
              tooltip="Initial margin on the order's value at the SRM's rate, plus the fee"
              value={formatUsd(requiredMargin)}
            />
            {orderType === "Limit" ? (
              <SummaryRow
                label="Slippage"
                tooltip="A limit order fills at its limit or better, so there is no slippage to allow for"
                value="—"
              />
            ) : (
              <SlippageRow
                estimate={slippage}
                max={maxSlippage}
                onMaxChange={edited(setMaxSlippage)}
              />
            )}
            <SummaryRow
              label="Fees"
              tooltip="The venue's taker fee, charged in USDC on the order's value"
              value={describeFee(takerFeeBps, feeUsd)}
            />
          </div>

          {shortfall !== null && hasWallet ? (
            <p className="text-[11px] text-panel-text-muted leading-snug" data-note="shortfall">
              Needs {USD.format(requiredMargin ?? 0)} USDC of margin; the account has{" "}
              {USD.format(availableMargin ?? 0)}.
            </p>
          ) : null}

          <SubmitButton
            disabled={!buttonEnabled}
            id="perp-submit-cta"
            onClick={handleSubmitClick}
            tone={buttonTone(buttonInputs)}
          >
            {submitLabel(buttonInputs)}
          </SubmitButton>

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
       * One rhythm below the tabs: the account line, then the price, size, leverage and switches,
       * each a block set the same distance from its neighbours. Set to fit the ticket under a
       * phone's fold and in a 700px-tall window beside the Account panel, with room to spare.
       */}
      <div className="space-y-2 pt-1 pb-0.5">
        <AccountRow
          availableMargin={availableMargin}
          marginSources={marginSources}
          onDepositRequest={onDepositRequest}
          positionChange={positionChange}
        />

        {orderType === "Limit" ? (
          <div className="space-y-1">
            <FormField
              adornment={<TokenUnit symbol="USDC" />}
              id="perp-limit-price"
              label="Limit price"
              onChange={edited(setLimitPrice)}
              placeholder="0.0000000"
              tooltip="USDC per cNGN"
              value={limitPrice}
            />
            {/* The same price the other way up, for traders who think in naira per dollar. */}
            <p className="text-[11px] text-panel-text-muted tabular-nums">
              {formatNairaPerUsdc(ticketPrice)}
            </p>
          </div>
        ) : null}
        <OrderSizeCard
          canToggleUnit={ticketPrice !== null && ticketPrice > 0}
          maxCngn={maxSizeCngn}
          onInput={edited(fields.onSizeInput)}
          onSetCngn={edited(fields.setCngn)}
          onToggleUnit={() => {
            onEdit?.();
            fields.toggleUnit();
          }}
          otherUnitText={
            sizeUnit === "cNGN"
              ? formatUsd(parseAmount(fields.sizeUsd))
              : `${sizeCngn === null ? "0" : formatCngnAmount(sizeCngn)} cNGN`
          }
          shown={fields.shown}
          sizeCngn={sizeCngn}
          tooltip={sizeTooltip(sizeUnit, ticketPrice)}
          unit={sizeUnit}
        />
        <PositionLeverageRow leverage={positionLeverage} state={state} />

        {/* The two switches side by side: one row, each half a 44px thumb target on a phone. */}
        <div className="grid grid-cols-2 gap-x-2 px-0.5">
          {/*
           * Without a position there is nothing to reduce and the venue would refuse the order, so
           * the switch is shown disabled and says why rather than letting a trader arm it.
           */}
          <CheckboxRow
            checked={reduceOnly && hasPosition}
            disabled={!hasPosition}
            id="perp-reduce-only"
            label="Reduce Only"
            onChange={edited(setReduceOnly)}
            tooltip={
              hasPosition
                ? "The venue clamps this order to your open position; it can never open or flip one"
                : "Needs an open position to reduce"
            }
          />
          {/*
           * The venue takes market and limit orders only; it has no trigger orders to attach a take
           * profit or stop loss to. Shown disabled rather than hidden so a trader can see the switch
           * exists and read why it is off, instead of arming something nothing would execute.
           */}
          <CheckboxRow
            checked={false}
            disabled
            id="perp-tp-sl"
            label="TP / SL"
            onChange={() => undefined}
            tooltip="Take profit / stop loss. Not available yet: the venue takes market and limit orders only, with no trigger orders to attach a take profit or stop loss to"
          />
        </div>
      </div>
    </OrderFormShell>
  );
}
