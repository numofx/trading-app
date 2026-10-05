"use client";

import { useState } from "react";
import { formatNaira } from "@/lib/market-formatting";
import {
  describePerpMarginSources,
  estimateLiquidationPrice,
  getLeverageCeiling,
  TRADING_PAUSED_MESSAGE,
} from "@/lib/perp-market";
import type { PerpAccountMargin, PerpCngnExposure, PerpState } from "@/lib/perp-market.types";
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
  /** cNGN per USDC; the limit for a limit order, ignored for a market order (priced off the touch). */
  limitPrice: string;
  /** USD notional. */
  size: string;
  /** Only shrink the open position: the venue clamps the fill to it and never opens or flips one. */
  reduceOnly: boolean;
};

const USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
/** The button's size: up to two decimals, no trailing zeros ("10", "10.5", "10.25"). */
const SIZE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const PRICE = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});

function parseAmount(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** A derived amount as the input shows it: at most two decimals, no trailing zeros. */
function formatDerived(value: number) {
  return String(Number(value.toFixed(2)));
}

const SIZE_UNITS = ["USDC", "cNGN"] as const satisfies readonly TokenSymbol[];

type SizeUnit = (typeof SIZE_UNITS)[number];

/** What the Size field counts, for its tooltip: USD notional, or the same in cNGN at the ticket's price. */
function sizeTooltip(unit: SizeUnit, conversion: number | null) {
  if (unit === "USDC") {
    return "What you trade: USD notional.";
  }
  const at = conversion === null ? "" : ` at ₦${PRICE.format(conversion)}`;
  return `What you trade, as cNGN notional${at}. The order is signed in USDC.`;
}

/**
 * The ticket's size and margin fields, kept in step: size and margin through the leverage, and the
 * size's cNGN rendering through the ticket's price. USD notional is the figure underneath; the
 * cNGN unit is a view of it that the trader can also type into.
 */
function usePerpSizeFields(leverage: number, conversion: number | null) {
  const [margin, setMargin] = useState("");
  const [size, setSize] = useState("");
  const [sizeCngn, setSizeCngn] = useState("");
  const [sizeUnit, setSizeUnit] = useState<SizeUnit>("USDC");

  function toCngn(usd: number | null) {
    return usd === null || conversion === null ? "" : formatDerived(usd * conversion);
  }

  function setUsd(usd: number | null) {
    setSize(usd === null ? "" : formatDerived(usd));
    setMargin(usd === null ? "" : formatDerived(usd / leverage));
  }

  function onSizeInput(value: string) {
    if (sizeUnit === "USDC") {
      setSize(value);
      const parsed = parseAmount(value);
      setMargin(parsed === null ? "" : formatDerived(parsed / leverage));
      setSizeCngn(toCngn(parsed));
      return;
    }
    setSizeCngn(value);
    const parsed = parseAmount(value);
    setUsd(parsed === null || conversion === null || conversion <= 0 ? null : parsed / conversion);
  }

  function onMargin(value: string) {
    setMargin(value);
    const parsed = parseAmount(value);
    const usd = parsed === null ? null : parsed * leverage;
    setSize(usd === null ? "" : formatDerived(usd));
    setSizeCngn(toCngn(usd));
  }

  function onUnit(unit: SizeUnit) {
    setSizeUnit(unit);
    setSizeCngn(toCngn(parseAmount(size)));
  }

  function onLeverage(next: number) {
    const parsed = parseAmount(margin);
    if (parsed !== null) {
      const usd = parsed * next;
      setSize(formatDerived(usd));
      setSizeCngn(toCngn(usd));
    }
  }

  return {
    margin,
    onLeverage,
    onMargin,
    onSizeInput,
    onUnit,
    /** What the Size field shows: the USD notional, or its cNGN rendering. */
    shown: sizeUnit === "USDC" ? size : sizeCngn,
    size,
    sizeUnit,
  };
}

/** Long naira on an account that holds cNGN adds naira exposure on top of the collateral's. */
function NairaDoublingNote({
  cngn,
  isLong,
  sizeUsd,
}: {
  cngn: PerpCngnExposure | null;
  isLong: boolean;
  sizeUsd: number | null;
}) {
  if (cngn === null || isLong || sizeUsd === null || sizeUsd <= 0) {
    return null;
  }
  return (
    <p className="text-[10px] text-sell leading-snug">
      This doubles your naira exposure: your {USD.format(cngn.collateralCngn)} cNGN is already long
      the naira, and a short here is long the naira again. It still has to clear the margin check,
      with cNGN counted at half its value.
    </p>
  );
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

/** Everything the ticket shows that follows from its inputs: fee, margin needed, shortfall, liq. price. */
function deriveTicket(inputs: TicketInputs) {
  const sizeUsd = parseAmount(inputs.size);
  const marginUsd = parseAmount(inputs.margin);
  const entryPrice =
    inputs.orderType === "Limit" ? parseAmount(inputs.limitPrice) : inputs.referencePrice;
  const feeUsd =
    sizeUsd !== null && inputs.takerFeeBps !== null
      ? (sizeUsd * inputs.takerFeeBps) / 10_000
      : null;
  const requiredMargin =
    sizeUsd !== null && inputs.state !== null
      ? sizeUsd * inputs.state.initialMarginRate + (feeUsd ?? 0)
      : null;
  const shortfall =
    requiredMargin !== null &&
    inputs.availableMargin !== null &&
    requiredMargin > inputs.availableMargin
      ? requiredMargin - inputs.availableMargin
      : null;
  const liquidation =
    inputs.state !== null && sizeUsd !== null && entryPrice !== null && marginUsd !== null
      ? estimateLiquidationPrice({
          entryPrice,
          maintenanceMarginRate: inputs.state.maintenanceMarginRate,
          margin: marginUsd,
          side: inputs.side,
          sizeUsd,
        })
      : null;
  const needsPrice = inputs.orderType === "Limit" && parseAmount(inputs.limitPrice) === null;
  return {
    feeUsd,
    liquidation,
    needsPrice,
    requiredMargin,
    shortfall,
    sizeUsd,
  };
}

/** Everything the ticket needs before the button trades. */
function isTicketComplete(inputs: {
  hasWallet: boolean;
  isLive: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  needsPrice: boolean;
  sizeUsd: number | null;
}) {
  return (
    inputs.isLive &&
    inputs.hasWallet &&
    !inputs.isSubmitting &&
    !inputs.isPreparingAccount &&
    inputs.sizeUsd !== null &&
    !inputs.needsPrice
  );
}

type ButtonInputs = {
  availableMargin: number | null;
  canSubmit: boolean;
  hasWallet: boolean;
  isLive: boolean;
  isLong: boolean;
  isPreparingAccount: boolean;
  isPaused: boolean;
  isSubmitting: boolean;
  shortfall: number | null;
  sizeUsd: number | null;
};

/** What the one button says: it connects, deposits, or trades, depending on what is missing. */
function submitLabel(inputs: ButtonInputs) {
  // Amount and unit, as brief as spot's "Buy USDC": the market is named in the header already.
  const amount = inputs.sizeUsd === null ? "" : ` ${SIZE.format(inputs.sizeUsd)}`;
  const trade = `${inputs.isLong ? "Long" : "Short"}${amount} USDC`;
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
  return inputs.isLong ? "buy" : "sell";
}

/**
 * The perp order ticket. Without a live perp (`state` null) it renders the form but cannot submit.
 * With one, leverage is bounded by the SRM's ceiling, size and margin are linked through it
 * (margin = size / leverage), and the order is checked against the account's initial-margin surplus
 * before it is signed. Size is what trades: it is the first field and the number the button and the
 * summary repeat. Margin is what that size costs at the chosen leverage, editable the other way
 * round for traders who think in margin. Leverage only sizes the order: the SRM margins the whole
 * account together, so there is no per-position leverage to set on chain.
 */
export function PerpOrderFormPanel({
  account = null,
  availableMargin = null,
  cngn = null,
  hasPosition = false,
  hasWallet = false,
  isPreparingAccount = false,
  isSubmitting = false,
  lastAction = null,
  onConnect,
  onDepositRequest,
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
  /** What the account's cNGN offsets, for an account holding any; informational. */
  cngn?: PerpCngnExposure | null;
  hasWallet?: boolean;
  isPreparingAccount?: boolean;
  isSubmitting?: boolean;
  lastAction?: string | null;
  onConnect?: () => void;
  onDepositRequest?: () => void;
  onSubmit?: (request: PerpOrderRequest) => void;
  /** The price a market order would fill near, cNGN per USDC: the touch, else the mark. */
  referencePrice?: number | null;
  state?: PerpState | null;
  takerFeeBps?: number | null;
}) {
  const [side, setSide] = useState<PerpSide>("long");
  const [orderType, setOrderType] = useState<PerpOrderType>("Market");
  const [limitPrice, setLimitPrice] = useState("");
  const [leverage, setLeverage] = useState(1);
  const [reduceOnly, setReduceOnly] = useState(false);

  const isLive = state?.tradingEnabled === true && onSubmit !== undefined;
  const marginSources = describePerpMarginSources(account);
  const ceiling = getLeverageCeiling(state);
  const effectiveLeverage = Math.min(leverage, ceiling);
  // cNGN per USDC for the Size field's cNGN unit: the limit price when one is typed, else the
  // price a market order fills near. The field keeps USD notional underneath either way.
  const sizeConversion =
    orderType === "Limit" ? (parseAmount(limitPrice) ?? referencePrice) : referencePrice;
  const fields = usePerpSizeFields(effectiveLeverage, sizeConversion);
  const { margin, size, sizeUnit } = fields;

  function handleLeverageChange(next: number) {
    setLeverage(next);
    fields.onLeverage(next);
  }
  const isLong = side === "long";

  const { feeUsd, liquidation, needsPrice, requiredMargin, shortfall, sizeUsd } = deriveTicket({
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
    sizeUsd,
  });
  const buttonInputs: ButtonInputs = {
    availableMargin,
    canSubmit,
    hasWallet,
    isLive,
    isLong,
    isPreparingAccount,
    isPaused: state?.paused === true,
    isSubmitting,
    shortfall,
    sizeUsd,
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
      onSubmit({ limitPrice, orderType, reduceOnly: reduceOnly && hasPosition, side, size });
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
              tooltip="For this margin alone; your whole perp account backs the position"
              value={formatNaira(liquidation)}
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
            <p className="text-[10px] text-sell leading-snug">
              Needs {USD.format(requiredMargin ?? 0)} USDC of margin; the account has{" "}
              {USD.format(availableMargin ?? 0)}.
            </p>
          ) : null}
          <NairaDoublingNote cngn={cngn} isLong={isLong} sizeUsd={sizeUsd} />

          <SubmitButton
            disabled={!buttonEnabled}
            id="perp-submit-cta"
            onClick={handleSubmitClick}
            tone={buttonTone(buttonInputs)}
          >
            {submitLabel(buttonInputs)}
          </SubmitButton>

          {statusText === null ? null : (
            <p className="text-[10px] text-panel-text-muted leading-snug">{statusText}</p>
          )}
        </>
      }
    >
      <SideToggle onSelect={setSide} options={SIDES} selected={side} />

      <OrderTypeTabs onSelect={setOrderType} orderTypes={ORDER_TYPES} selected={orderType} />

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
        <FormField
          adornment={<TokenUnit symbol="cNGN" />}
          id="perp-limit-price"
          label="Limit price"
          onChange={setLimitPrice}
          tooltip="cNGN per USDC"
          value={limitPrice}
        />
      ) : null}
      <FormField
        adornment={
          <TokenUnitSelect
            disabledReason={
              sizeConversion !== null && sizeConversion > 0
                ? undefined
                : { cNGN: "Needs a price: type a limit price, or wait for the market" }
            }
            label="Size unit"
            onSelect={(unit) => fields.onUnit(unit as SizeUnit)}
            options={SIZE_UNITS}
            selected={sizeUnit}
          />
        }
        id="perp-size"
        label="Size"
        onChange={fields.onSizeInput}
        placeholder="0.0"
        tooltip={sizeTooltip(sizeUnit, sizeConversion)}
        value={fields.shown}
      />
      <LeverageSelector
        ceiling={ceiling}
        leverage={effectiveLeverage}
        onSelect={handleLeverageChange}
      />
      <FormField
        adornment={<TokenUnit symbol="USDC" />}
        id="perp-margin"
        label="Margin"
        onChange={fields.onMargin}
        placeholder="0.0"
        tooltip={`What it costs you: size ÷ ${effectiveLeverage}x. Editable the other way round, for traders who think in margin.`}
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
        onChange={setReduceOnly}
        tooltip={
          hasPosition
            ? "The venue clamps this order to your open position; it can never open or flip one"
            : "Needs an open position to reduce"
        }
      />
    </OrderFormShell>
  );
}
