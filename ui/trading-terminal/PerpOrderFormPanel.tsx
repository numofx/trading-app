"use client";

import { useState } from "react";
import { formatNairaPerUsdc, formatPrice } from "@/lib/market-formatting";
import {
  describePerpMarginSources,
  estimateLiquidationPrice,
  getLeverageCeiling,
  perpOrderUiSide,
  perpSubmitLabel,
  TRADING_PAUSED_MESSAGE,
} from "@/lib/perp-market";
import type { PerpAccountMargin, PerpState } from "@/lib/perp-market.types";
import { PERP_LEVERAGE_PRESETS } from "@/lib/perp-terminal-config";
import { SPOT_ORDER_LIFETIME_LABEL } from "@/lib/spot-order-submission";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";
import { AmountSlider } from "@/ui/trading-terminal/order-form/AmountSlider";
import { AvailableRow } from "@/ui/trading-terminal/order-form/AvailableRow";
import { CheckboxRow } from "@/ui/trading-terminal/order-form/CheckboxRow";
import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";
import { FormField } from "@/ui/trading-terminal/order-form/FormField";
import { OrderFormShell } from "@/ui/trading-terminal/order-form/OrderFormShell";
import { SideToggle } from "@/ui/trading-terminal/order-form/SideToggle";
import { SubmitButton } from "@/ui/trading-terminal/order-form/SubmitButton";
import { SummaryRow } from "@/ui/trading-terminal/order-form/SummaryRow";
import type { TokenSymbol } from "@/ui/trading-terminal/order-form/TokenUnit";
import { TokenUnit, TokenUnitSelect } from "@/ui/trading-terminal/order-form/TokenUnit";

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
 * The ticket's size and margin fields, kept in step: the cNGN size is the figure underneath, its
 * USDC value follows through the ticket's price (USDC per cNGN), and the margin is that value
 * through the leverage. The USDC unit is a view of the size that the trader can also type into,
 * as can the margin.
 */
function usePerpSizeFields(leverage: number, price: number | null) {
  const [margin, setMargin] = useState("");
  const [sizeCngn, setSizeCngn] = useState("");
  const [sizeUsd, setSizeUsd] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("cNGN");
  const priced = price !== null && price > 0;

  function toUsd(cngn: number | null) {
    return cngn === null || !priced ? null : cngn * price;
  }

  /** Sets the USDC value and the margin from the cNGN size; both blank without a price. */
  function setFromCngn(cngn: number | null) {
    const usd = toUsd(cngn);
    setSizeUsd(usd === null ? "" : formatDerived(usd));
    setMargin(usd === null ? "" : formatDerived(usd / leverage));
  }

  /** Sets the cNGN size and the margin from a USDC value; the size is blank without a price. */
  function setFromUsd(usd: number | null) {
    setSizeCngn(usd === null || !priced ? "" : formatDerivedCngn(usd / price));
    setMargin(usd === null ? "" : formatDerived(usd / leverage));
  }

  function onSizeInput(value: string) {
    if (sizeUnit === "cNGN") {
      setSizeCngn(value);
      setFromCngn(parseAmount(value));
      return;
    }
    setSizeUsd(value);
    setFromUsd(parseAmount(value));
  }

  function onMargin(value: string) {
    setMargin(value);
    const parsed = parseAmount(value);
    const usd = parsed === null ? null : parsed * leverage;
    setSizeUsd(usd === null ? "" : formatDerived(usd));
    setSizeCngn(usd === null || !priced ? "" : formatDerivedCngn(usd / price));
  }

  function onUnit(unit: SizeUnit) {
    setSizeUnit(unit);
    const usd = toUsd(parseAmount(sizeCngn));
    setSizeUsd(usd === null ? "" : formatDerived(usd));
  }

  function onLeverage(next: number) {
    const parsed = parseAmount(margin);
    if (parsed !== null) {
      const usd = parsed * next;
      setSizeUsd(formatDerived(usd));
      setSizeCngn(priced ? formatDerivedCngn(usd / price) : "");
    }
  }

  return {
    margin,
    onLeverage,
    onMargin,
    onSizeInput,
    onUnit,
    /** What the Size field shows: the cNGN size, or its USDC value. */
    shown: sizeUnit === "cNGN" ? sizeCngn : sizeUsd,
    sizeCngn,
    sizeUnit,
  };
}

/**
 * Leverage as a typed value, a filled slider and presets, all driving one number, bounded by the
 * SRM's own ceiling (1 / initial margin) rather than a number of the app's choosing. A typed value
 * applies as soon as it is a whole number in range; blurring drops any draft that is not.
 */
function LeverageSelector({
  ceiling,
  leverage,
  onSelect,
}: {
  ceiling: number;
  leverage: number;
  onSelect: (leverage: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const presets = PERP_LEVERAGE_PRESETS.filter((preset) => preset <= ceiling).map((preset) => ({
    label: `${preset}x`,
    value: preset,
  }));

  function handleDraftChange(value: string) {
    const digits = value.replace(/\D/g, "");
    setDraft(digits);
    const parsed = Number(digits);
    if (digits !== "" && parsed >= 1 && parsed <= ceiling) {
      onSelect(parsed);
    }
  }

  function selectFromControl(value: number) {
    setDraft(null);
    onSelect(value);
  }

  return (
    <div>
      <AmountSlider
        disabled={ceiling <= 1}
        header={
          <div className="flex items-center justify-between gap-2">
            <FieldLabel
              htmlFor="perp-leverage-value"
              tooltip="Sizes the order only: the SRM margins your whole account together, so there is no per-position leverage on chain. The ceiling is the SRM's own."
            >
              Leverage
            </FieldLabel>
            <span className="flex items-baseline text-[13px] text-panel-text-active tabular-nums">
              <input
                className="w-8 bg-transparent text-right text-[16px] outline-none md:text-[13px]"
                id="perp-leverage-value"
                inputMode="numeric"
                onBlur={() => setDraft(null)}
                onChange={(event) => handleDraftChange(event.target.value)}
                value={draft ?? String(leverage)}
              />
              x
            </span>
          </div>
        }
        label="Leverage slider"
        max={ceiling}
        min={1}
        onChange={selectFromControl}
        presets={presets}
        step={1}
        value={leverage}
        valueText={`${leverage}x`}
      />
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
  const base = "For this margin alone; your whole perp account backs the position.";
  if (state === null) {
    return base;
  }
  const mm = state.maintenanceMarginRate;
  const shortMove = Math.round((2 / (1 + mm) - 1) * 100);
  return `${base} The position is a fixed amount of cNGN valued in USDC, so a short's loss grows without bound as cNGN strengthens while a long can lose at most its notional: at 1x a short is liquidated about ${shortMove}% above entry, and a long at no price.`;
}

/** Hourly funding from the chosen side's point of view: what it pays or receives. */
function describeFunding(state: PerpState | null, side: PerpSide) {
  if (state === null) {
    return "—";
  }
  const sideRate = side === "long" ? state.uiLongFundingRate1h : -state.uiLongFundingRate1h;
  if (sideRate === 0) {
    return "0%/h";
  }
  const pct = `${(Math.abs(sideRate) * 100).toFixed(4)}%/h`;
  return sideRate > 0 ? `pays ${pct}` : `receives ${pct}`;
}

type TicketInputs = {
  availableMargin: number | null;
  limitPrice: string;
  margin: string;
  orderType: PerpOrderType;
  referencePrice: number | null;
  side: PerpSide;
  size: string;
  state: PerpState | null;
  takerFeeBps: number | null;
};

/**
 * Everything the ticket shows that follows from its inputs: the USDC value, fee, margin needed,
 * shortfall and liq. price. The size is cNGN; its value, and everything charged on it, is at the
 * entry price (the typed limit, else where a market order fills), so without one the fee and
 * margin are unknown rather than zero.
 */
function deriveTicket(inputs: TicketInputs) {
  const sizeCngn = parseAmount(inputs.size);
  const marginUsd = parseAmount(inputs.margin);
  const entryPrice =
    inputs.orderType === "Limit" ? parseAmount(inputs.limitPrice) : inputs.referencePrice;
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
  const liquidation =
    inputs.state !== null && sizeCngn !== null && entryPrice !== null && marginUsd !== null
      ? estimateLiquidationPrice({
          entryPrice,
          maintenanceMarginRate: inputs.state.maintenanceMarginRate,
          margin: marginUsd,
          side: inputs.side,
          sizeCngn,
        })
      : null;
  const needsPrice = inputs.orderType === "Limit" && parseAmount(inputs.limitPrice) === null;
  return {
    feeUsd,
    liquidation,
    needsPrice,
    requiredMargin,
    shortfall,
    sizeCngn,
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
  if (inputs.availableMargin === null || inputs.shortfall !== null) {
    return "Deposit margin";
  }
  return trade;
}

function isButtonEnabled(inputs: ButtonInputs) {
  if (!inputs.isLive) {
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
 * With one, leverage is bounded by the SRM's ceiling, size and margin are linked through it
 * (margin = size × price / leverage), and the order is checked against the account's
 * initial-margin surplus before it is signed. Size is what trades, in cNGN contracts: it is the
 * first field and the number the button and the summary repeat; its USDC value at the ticket's
 * price is the alternative unit. Margin is what that size costs at the chosen leverage, editable
 * the other way round for traders who think in margin. Leverage only sizes the order: the SRM
 * margins the whole account together, so there is no per-position leverage to set on chain.
 */
export function PerpOrderFormPanel({
  account = null,
  availableMargin = null,
  hasPosition = false,
  hasWallet = false,
  isPreparingAccount = false,
  isSubmitting = false,
  lastAction = null,
  onConnect,
  onDepositRequest,
  onEdit,
  onSubmit,
  referencePrice = null,
  state = null,
  takerFeeBps = null,
}: {
  /** Whether the account holds a perp position: what a reduce-only order needs. */
  hasPosition?: boolean;
  /** The perp account's margin, by asset: what "Available to trade" is made of. */
  account?: PerpAccountMargin | null;
  /** The perp account's initial-margin surplus, USD; null before an account exists or is read. */
  availableMargin?: number | null;
  hasWallet?: boolean;
  isPreparingAccount?: boolean;
  isSubmitting?: boolean;
  lastAction?: string | null;
  onConnect?: () => void;
  onDepositRequest?: () => void;
  /** Any change to the ticket: the host clears the order status line on it. */
  onEdit?: () => void;
  onSubmit?: (request: PerpOrderRequest) => void;
  /** The price a market order would fill near, USDC per cNGN: the touch, else the mark. */
  referencePrice?: number | null;
  state?: PerpState | null;
  takerFeeBps?: number | null;
}) {
  const [side, setSide] = useState<PerpSide>("long");
  const [orderType, setOrderType] = useState<PerpOrderType>("Market");
  const [limitPrice, setLimitPrice] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [reduceOnly, setReduceOnly] = useState(false);
  /** Wraps a field setter so every edit also tells the host. */
  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      onEdit?.();
      set(value);
    };
  }

  const isLive = state?.tradingEnabled === true && onSubmit !== undefined;
  const marginSources = describePerpMarginSources(account);
  const ceiling = getLeverageCeiling(state);
  const effectiveLeverage = Math.min(leverage, ceiling);
  // The price in use, USDC per cNGN: the limit price when one is typed, else the price a market
  // order fills near. It values the cNGN size in USDC and so sets the margin either way.
  const ticketPrice =
    orderType === "Limit" ? (parseAmount(limitPrice) ?? referencePrice) : referencePrice;
  const fields = usePerpSizeFields(effectiveLeverage, ticketPrice);
  const { margin, sizeCngn: size, sizeUnit } = fields;

  function handleLeverageChange(next: number) {
    setLeverage(next);
    fields.onLeverage(next);
  }
  const { feeUsd, liquidation, needsPrice, requiredMargin, shortfall, sizeCngn } = deriveTicket({
    availableMargin,
    limitPrice,
    margin,
    orderType,
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
              label="Est. liq. price"
              tooltip={liquidationTooltip(state)}
              value={formatPrice(liquidation)}
            />
            <SummaryRow
              label="Funding"
              tooltip="Hourly, from this side's point of view: what it pays or receives at the current rate"
              value={describeFunding(state, side)}
            />
            <SummaryRow label="Fee" value={feeUsd === null ? "—" : `${USD.format(feeUsd)} USDC`} />
            <SummaryRow
              label="Expires"
              tooltip="An order that does not fill rests this long, then leaves the book on its own"
              value={`${SPOT_ORDER_LIFETIME_LABEL} after signing`}
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

      {/* The account's initial-margin headroom; what it is made of sits in the tooltip. */}
      <AvailableRow
        depositLabel="Deposit margin"
        label="Available to trade"
        onDeposit={onDepositRequest}
        tooltip={[
          "Cross-margin: everything in your perp account backs every position. USDC counts in full, cNGN at its index value times its margin factor. Profit and loss settle in USDC.",
          marginSources,
        ]
          .filter((part) => part !== null)
          .join(" ")}
        value={`${availableMargin === null ? "—" : USD.format(Math.max(0, availableMargin))} USDC`}
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
      <FormField
        adornment={
          <TokenUnitSelect
            disabledReason={
              ticketPrice !== null && ticketPrice > 0
                ? undefined
                : { USDC: "Needs a price: type a limit price, or wait for the market" }
            }
            label="Size unit"
            onSelect={edited((unit) => fields.onUnit(unit as SizeUnit))}
            options={SIZE_UNITS}
            selected={sizeUnit}
          />
        }
        id="perp-size"
        label="Size"
        onChange={edited(fields.onSizeInput)}
        placeholder="0"
        tooltip={sizeTooltip(sizeUnit, ticketPrice)}
        value={fields.shown}
      />
      <LeverageSelector
        ceiling={ceiling}
        leverage={effectiveLeverage}
        onSelect={edited(handleLeverageChange)}
      />
      <FormField
        adornment={<TokenUnit symbol="USDC" />}
        id="perp-margin"
        label="Margin"
        onChange={edited(fields.onMargin)}
        placeholder="0.0"
        tooltip={`What it costs you: the size's USDC value ÷ ${effectiveLeverage}x. Editable the other way round, for traders who think in margin.`}
        value={margin}
      />

      {/*
       * Without a position there is nothing to reduce and the venue would refuse the order, so
       * the switch is shown disabled and says why rather than letting a trader arm it.
       */}
      <CheckboxRow
        checked={reduceOnly && hasPosition}
        disabled={!hasPosition}
        id="perp-reduce-only"
        label="Reduce only"
        note={hasPosition ? "never opens or flips the position" : "no open position"}
        onChange={edited(setReduceOnly)}
        tooltip={
          hasPosition
            ? "The venue clamps this order to your open position; it can never open or flip one"
            : "Needs an open position to reduce"
        }
      />
    </OrderFormShell>
  );
}
