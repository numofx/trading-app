"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { estimateLiquidationPrice, getLeverageCeiling } from "@/lib/perp-market";
import type { PerpState } from "@/lib/perp-market.types";
import { PERP_LEVERAGE_PRESETS } from "@/lib/perp-terminal-config";
import { SmartImage } from "@/ui/SmartImage";

type PerpSide = "long" | "short";

const ORDER_TYPES = ["Market", "Limit"] as const;

type PerpOrderType = (typeof ORDER_TYPES)[number];

export type PerpOrderRequest = {
  side: PerpSide;
  orderType: PerpOrderType;
  /** cNGN per USDC; the limit for a limit order, ignored for a market order (priced off the touch). */
  limitPrice: string;
  /** USD notional. */
  size: string;
};

const USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
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

function PerpSideTabs({ onSelect, side }: { onSelect: (side: PerpSide) => void; side: PerpSide }) {
  const isLong = side === "long";

  return (
    <div className="grid grid-cols-2 gap-1 rounded-sm bg-input-bg p-0.5">
      <button
        className={cn(
          "h-8 cursor-pointer rounded-sm font-semibold text-[12px] transition-colors",
          isLong
            ? "bg-bid-bg text-buy ring-1 ring-buy/40"
            : "text-panel-text-muted hover:bg-input-hover"
        )}
        onClick={() => onSelect("long")}
        type="button"
      >
        Long
      </button>
      <button
        className={cn(
          "h-8 cursor-pointer rounded-sm font-semibold text-[12px] transition-colors",
          isLong
            ? "text-panel-text-muted hover:bg-input-hover"
            : "bg-ask-bg text-sell ring-1 ring-sell/40"
        )}
        onClick={() => onSelect("short")}
        type="button"
      >
        Short
      </button>
    </div>
  );
}

/** A segmented control in a bordered well, the selected type filled. */
function PerpOrderTypeTabs({
  onSelect,
  selected,
}: {
  onSelect: (orderType: PerpOrderType) => void;
  selected: PerpOrderType;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-sm p-1 ring-1 ring-panel-border">
      {ORDER_TYPES.map((type) => (
        <button
          aria-pressed={type === selected}
          className={cn(
            "h-8 cursor-pointer rounded-sm font-semibold text-[12px] transition-colors",
            type === selected
              ? "bg-input-hover text-panel-text-active"
              : "text-panel-text-muted hover:text-panel-text"
          )}
          key={type}
          onClick={() => onSelect(type)}
          type="button"
        >
          {type}
        </button>
      ))}
    </div>
  );
}

/** A token mark and ticker, set beside the input it denominates. */
function TokenUnit({ icon, symbol }: { icon: string; symbol: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-semibold text-[13px] text-panel-text-active">
      <SmartImage<string> alt={symbol} className="size-5 animate-none rounded-full" src={icon} />
      {symbol}
    </span>
  );
}

/** One section of the ticket's grouped card: a label over a large numeric input and its unit. */
function PerpCardField({
  id,
  label,
  onChange,
  unit,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  unit: ReactNode;
  value: string;
}) {
  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <label className="block text-[11px] text-panel-text-muted" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center justify-between gap-2">
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-[16px] text-panel-text-active outline-none placeholder:text-panel-text-muted/60"
          id={id}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
          placeholder="0.0"
          value={value}
        />
        {unit}
      </div>
    </div>
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
  const fillPercent = ceiling > 1 ? ((leverage - 1) / (ceiling - 1)) * 100 : 0;
  const presets = PERP_LEVERAGE_PRESETS.filter((preset) => preset <= ceiling);

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
    <div className="space-y-2.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] text-panel-text-muted" htmlFor="perp-leverage-value">
          Leverage
        </label>
        <span className="flex items-baseline font-mono font-semibold text-[16px] text-panel-text-active">
          <input
            className="w-8 bg-transparent text-right outline-none"
            id="perp-leverage-value"
            inputMode="numeric"
            onBlur={() => setDraft(null)}
            onChange={(event) => handleDraftChange(event.target.value)}
            value={draft ?? String(leverage)}
          />
          x
        </span>
      </div>
      {/* The fill is a gradient stop at the thumb, since a range input has no styleable progress part in WebKit. */}
      <input
        aria-label="Leverage slider"
        aria-valuetext={`${leverage}x`}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-panel-text-active [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-panel-text-active"
        disabled={ceiling <= 1}
        id="perp-leverage"
        max={ceiling}
        min={1}
        onChange={(event) => selectFromControl(Number(event.target.value))}
        step={1}
        style={{
          background: `linear-gradient(to right, var(--buy) ${fillPercent}%, var(--input-hover) ${fillPercent}%)`,
        }}
        type="range"
        value={leverage}
      />
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}
      >
        {presets.map((option) => (
          <button
            aria-pressed={option === leverage}
            className={cn(
              "h-7 cursor-pointer rounded-sm bg-input-bg font-mono text-[11px] transition-colors",
              option === leverage
                ? "text-panel-text-active"
                : "text-panel-text-muted hover:text-panel-text"
            )}
            key={option}
            onClick={() => selectFromControl(option)}
            type="button"
          >
            {option}x
          </button>
        ))}
      </div>
    </div>
  );
}

function SummaryRow({ label, title, value }: { label: string; title?: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span
        className={cn(
          "text-panel-text-muted",
          title && "cursor-help underline decoration-dotted underline-offset-4"
        )}
        title={title}
      >
        {label}
      </span>
      <span className="truncate text-panel-text">{value}</span>
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
  return { feeUsd, liquidation, needsPrice, requiredMargin, shortfall, sizeUsd };
}

type ButtonInputs = {
  availableMargin: number | null;
  canSubmit: boolean;
  hasWallet: boolean;
  isLive: boolean;
  isLong: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  shortfall: number | null;
};

/** What the one button says: it connects, deposits, or trades, depending on what is missing. */
function submitLabel(inputs: ButtonInputs) {
  const trade = `${inputs.isLong ? "Long" : "Short"} USDC-cNGN-PERP`;
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
  if (state !== null && !state.tradingEnabled) {
    return "The market opens at launch. Prices are live; orders are not accepted yet.";
  }
  return "Perp trading isn't live yet. Orders open when the market launches.";
}

function buttonClassName(enabled: boolean, isLong: boolean) {
  if (!enabled) {
    return "cursor-not-allowed bg-input-bg text-panel-text-muted ring-1 ring-panel-border";
  }
  return isLong
    ? "cursor-pointer bg-buy text-background hover:bg-buy/90"
    : "cursor-pointer bg-sell text-white hover:bg-sell/90";
}

/**
 * The perp order ticket. Without a live perp (`state` null) it renders the form but cannot submit.
 * With one, leverage is bounded by the SRM's ceiling, margin and size are linked through it
 * (size = margin × leverage), and the order is checked against the account's initial-margin surplus
 * before it is signed. Leverage only sizes the order: the SRM margins the whole account together,
 * so there is no per-position leverage to set on chain.
 */
export function PerpOrderFormPanel({
  availableMargin = null,
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
  /** The perp account's initial-margin surplus, USD; null before an account exists or is read. */
  availableMargin?: number | null;
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
  const [margin, setMargin] = useState("");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(1);

  const isLive = state?.tradingEnabled === true && onSubmit !== undefined;
  const ceiling = getLeverageCeiling(state);
  const effectiveLeverage = Math.min(leverage, ceiling);
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

  function handleMarginChange(value: string) {
    setMargin(value);
    const parsed = parseAmount(value);
    setSize(parsed === null ? "" : formatDerived(parsed * effectiveLeverage));
  }

  function handleSizeChange(value: string) {
    setSize(value);
    const parsed = parseAmount(value);
    setMargin(parsed === null ? "" : formatDerived(parsed / effectiveLeverage));
  }

  function handleLeverageChange(next: number) {
    setLeverage(next);
    const parsed = parseAmount(margin);
    if (parsed !== null) {
      setSize(formatDerived(parsed * next));
    }
  }

  const canSubmit =
    isLive && hasWallet && !isSubmitting && !isPreparingAccount && sizeUsd !== null && !needsPrice;
  const buttonInputs: ButtonInputs = {
    availableMargin,
    canSubmit,
    hasWallet,
    isLive,
    isLong,
    isPreparingAccount,
    isSubmitting,
    shortfall,
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
      onSubmit({ limitPrice, orderType, side, size });
    }
  }

  return (
    <section className="flex flex-col overflow-clip bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 md:min-h-fit md:flex-1">
      <div className="hidden shrink-0 items-center border-panel-border border-b px-3 py-1.5 font-medium text-[11px] md:flex">
        <span className="rounded-sm bg-input-bg px-2 py-0.5 text-panel-text-active">
          Order form
        </span>
      </div>

      <div className="space-y-2.5 px-3 py-2 md:min-h-0 md:flex-1">
        <PerpSideTabs onSelect={setSide} side={side} />

        <PerpOrderTypeTabs onSelect={setOrderType} selected={orderType} />

        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span
            className="cursor-help text-panel-text-muted underline decoration-dotted underline-offset-4"
            title="Initial-margin headroom in your perp account: what can back new positions"
          >
            Available to trade
          </span>
          <span className="font-mono text-panel-text">
            {availableMargin === null ? "—" : USD.format(Math.max(0, availableMargin))} USDC
          </span>
        </div>

        <div className="divide-y divide-panel-border rounded-sm bg-input-bg ring-1 ring-panel-border">
          {orderType === "Limit" ? (
            <PerpCardField
              id="perp-limit-price"
              label="Limit price"
              onChange={setLimitPrice}
              unit={<TokenUnit icon="/tokens/cngn.svg" symbol="cNGN" />}
              value={limitPrice}
            />
          ) : null}
          <PerpCardField
            id="perp-margin"
            label="Margin"
            onChange={handleMarginChange}
            unit={<TokenUnit icon="/tokens/usdc.svg" symbol="USDC" />}
            value={margin}
          />
          <PerpCardField
            id="perp-size"
            label="Estimated size"
            onChange={handleSizeChange}
            unit={<TokenUnit icon="/tokens/usdc.svg" symbol="USDC" />}
            value={size}
          />
          <LeverageSelector
            ceiling={ceiling}
            leverage={effectiveLeverage}
            onSelect={handleLeverageChange}
          />
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-panel-border border-t bg-panel-bg-muted px-3 pt-1.5 pb-2 md:sticky md:bottom-0 md:z-10">
        <div className="space-y-1 text-[11px]">
          <SummaryRow
            label="Est. liquidation price"
            title="For this margin alone; your whole perp account backs the position"
            value={liquidation === null ? "—" : PRICE.format(liquidation)}
          />
          <SummaryRow label="Funding rate" value={describeFunding(state, side)} />
          <SummaryRow label="Fee" value={feeUsd === null ? "—" : `${USD.format(feeUsd)} USDC`} />
        </div>

        {shortfall !== null && hasWallet ? (
          <p className="text-[10px] text-sell leading-snug">
            Needs {USD.format(requiredMargin ?? 0)} USDC of margin; the account has{" "}
            {USD.format(availableMargin ?? 0)}.
          </p>
        ) : null}

        <button
          className={cn(
            "h-10 w-full rounded-sm font-semibold text-[13px] transition-colors",
            buttonClassName(buttonEnabled, isLong)
          )}
          disabled={!buttonEnabled}
          id="perp-submit-cta"
          onClick={handleSubmitClick}
          type="button"
        >
          {submitLabel(buttonInputs)}
        </button>

        <p className="text-[10px] text-panel-text-muted leading-snug">
          {isLive
            ? (lastAction ?? "Orders rest for 24 hours unless filled or cancelled.")
            : notLiveMessage(state)}
        </p>
      </div>
    </section>
  );
}
