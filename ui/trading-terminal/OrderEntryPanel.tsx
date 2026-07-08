"use client";

import { ChevronDown, ChevronUp, Info, Minus, Plus } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { TAKER_FEE_RATE } from "@/lib/future-order-submission";
import type { DeliveryTerm } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

const FUTURE_LEVERAGE_OPTIONS = [1, 2, 5] as const;

function LabelValueRow({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  const isNegative = value.startsWith("-");
  const isPositive = value.startsWith("+");

  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <span className="min-w-0 flex-1 text-panel-text-muted">{label}</span>
      <span
        className={cn(
          "wrap-break-word min-w-0 max-w-[60%] text-right font-medium text-panel-text leading-snug",
          isPositive && "text-panel-text-active",
          isNegative && "text-panel-text-muted",
          valueClassName,
        )}
      >
        {value}
      </span>
    </div>
  );
}

function getDirectionCopy(isLong: boolean, quoteCurrency: string) {
  return isLong ? `Buy ${quoteCurrency} / sell USDC` : `Sell ${quoteCurrency} / buy USDC`;
}

function getSubmitLabel(isSubmitting: boolean, isLong: boolean, isFXFuture: boolean, quoteCurrency: string) {
  if (isSubmitting) {
    return "Submitting...";
  }

  if (isFXFuture) {
    return isLong ? "Long" : "Short";
  }

  return isLong ? `Long ${quoteCurrency}` : `Short ${quoteCurrency}`;
}

function parseDisplayNumber(value: string) {
  const parsed = Number(
    value
      .replaceAll(",", "")
      .replaceAll("$", "")
      .replaceAll("₦", "")
      .replaceAll("€", "")
      .replaceAll("R$", "")
      .replaceAll("cNGN", "")
      .replaceAll("EURC", "")
      .replaceAll("BRZ", "")
      .replaceAll("USDC", "")
  );

  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function formatCompactAmount(value: number, unit: string, maximumFractionDigits = 0) {
  if (!Number.isFinite(value)) {
    return `— ${unit}`;
  }

  return `${value.toLocaleString("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: maximumFractionDigits > 0 ? 1 : 0,
  })} ${unit}`;
}

function formatFutureRate(value: number, quoteCurrency: string) {
  if (!Number.isFinite(value)) {
    return "— / USDC";
  }

  let symbol = "₦";
  if (quoteCurrency === "EURC") {
    symbol = "€";
  } else if (quoteCurrency === "BRZ") {
    symbol = "R$";
  }
  const digits = quoteCurrency === "EURC" || quoteCurrency === "BRZ" ? 4 : 0;
  return `${symbol}${value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits })} / USDC`;
}

function getSummaryRowValue(rows: DeliveryTerm[], label: string) {
  return rows.find((row) => row.label === label)?.value ?? null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This panel intentionally coordinates several dense trading UI sections.
export function OrderEntryPanel({
  allocation,
  advancedSummaryRows,
  atExpiryDeliver,
  balanceLabel,
  contractDetails,
  contractLabel,
  depositControl,
  isSubmitting,
  isSubmitDisabled,
  lastAction,
  limitPrice,
  orderSummaryRows,
  orderType,
  pnl,
  positionOverview,
  exposureLabel,
  isFXFuture,
  postOnly,
  positionBuilderRows,
  returnLabel,
  returnValue,
  size,
  slippageEstimate,
  futureSizeUnit,
  orderSide,
  onAllocationChange,
  onAtExpiryDeliverToggle,
  onLimitPriceChange,
  onOrderTypeChange,
  onPostOnlyToggle,
  onSideChange,
  onSizeChange,
  onSubmit,
}: {
  allocation: number;
  advancedSummaryRows: DeliveryTerm[];
  atExpiryDeliver: boolean;
  balanceLabel?: string | null;
  contractDetails: DeliveryTerm[];
  contractLabel: string;
  depositControl?: ReactNode;
  isSubmitting?: boolean;
  isSubmitDisabled?: boolean;
  lastAction: string;
  limitPrice: string;
  orderSummaryRows: DeliveryTerm[];
  orderType: "Limit" | "Market" | "Stop";
  pnl: string;
  positionOverview: DeliveryTerm[];
  exposureLabel: string;
  isFXFuture: boolean;
  postOnly: boolean;
  positionBuilderRows: DeliveryTerm[];
  returnLabel: string;
  returnValue: string;
  size: string;
  slippageEstimate: string;
  futureSizeUnit?: string;
  orderSide: "buy" | "sell";
  onAllocationChange: (value: number) => void;
  onAtExpiryDeliverToggle: () => void;
  onLimitPriceChange: (value: string) => void;
  onOrderTypeChange: (type: "Limit" | "Market" | "Stop") => void;
  onPostOnlyToggle: () => void;
  onSideChange: (side: "buy" | "sell") => void;
  onSizeChange: (value: string) => void;
  onSubmit: (side: "buy" | "sell") => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const isLong = orderSide === "buy";
  const needsLimitPrice = orderType !== "Market";
  let quoteCurrency = "cNGN";
  if (contractLabel.includes("EURC")) {
    quoteCurrency = "EURC";
  } else if (contractLabel.includes("BRZ")) {
    quoteCurrency = "BRZ";
  }
  let directionCopy = getDirectionCopy(isLong, quoteCurrency);
  if (isFXFuture) {
    directionCopy = isLong ? "Long" : "Short";
  }
  const submitLabel = getSubmitLabel(Boolean(isSubmitting), isLong, isFXFuture, quoteCurrency);
  const buyDirectionLabel = "Long";
  const sellDirectionLabel = "Short";
  const isNegativePnl = pnl.startsWith("-");
  const isNegativeReturn = returnValue.startsWith("-");
  let sizeLabel = "Size";
  const sizePlaceholder = "5";

  if (futureSizeUnit) {
    sizeLabel = `Size (${futureSizeUnit})`;
  }

  if (isFXFuture) {
    const leverage = FUTURE_LEVERAGE_OPTIONS.includes(allocation as (typeof FUTURE_LEVERAGE_OPTIONS)[number])
      ? allocation
      : 5;
    const amount = Number(size || "0");
    const displayedAmount = Number.isFinite(amount) ? amount : 0;
    const fallbackRate = parseDisplayNumber(limitPrice);
    const summaryRate = parseDisplayNumber(getSummaryRowValue(orderSummaryRows, "Est. Fill Price") ?? "");
    const forwardRate = Number.isFinite(fallbackRate) ? fallbackRate : summaryRate;
    const totalNotional = Number.isFinite(forwardRate) ? displayedAmount * forwardRate : Number.NaN;
    const initialMargin = displayedAmount / leverage;
    const maintenanceMargin = initialMargin / 2;
    const summaryLiquidationPrice = parseDisplayNumber(getSummaryRowValue(orderSummaryRows, "Liquidation Price") ?? "");
    const liquidationOffset = quoteCurrency === "EURC" || quoteCurrency === "BRZ" ? 0.09 : 160;
    const liquidationPrice = Number.isFinite(summaryLiquidationPrice)
      ? summaryLiquidationPrice
      : forwardRate - (isLong ? liquidationOffset : -liquidationOffset);
    const fee = displayedAmount * Number(TAKER_FEE_RATE);
    const nextStepSize = displayedAmount >= 1000 ? 1000 : 1;
    return (
      <section className="flex h-full min-h-[300px] flex-col rounded-[28px] bg-panel-bg p-4 text-foreground shadow-[0_28px_90px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0">
        <div className="space-y-5 overflow-y-auto">
          <div className="grid grid-cols-2 overflow-hidden rounded-[16px] bg-input-bg p-1 ring-1 ring-panel-border">
            <button
              className={cn(
                "min-h-12 rounded-[12px] px-3 font-semibold text-[14px] transition-colors",
                isLong ? "bg-foreground text-background" : "text-panel-text hover:bg-input-hover",
              )}
              onClick={() => onSideChange("buy")}
              type="button"
            >
              Long
            </button>
            <button
              className={cn(
                "min-h-12 rounded-[12px] px-3 font-semibold text-[14px] transition-colors",
                isLong ? "text-panel-text hover:bg-input-hover" : "bg-foreground text-background",
              )}
              onClick={() => onSideChange("sell")}
              type="button"
            >
              Short
            </button>
          </div>

          <div className="grid grid-cols-3 rounded-[16px] bg-input-bg p-1">
            {(["Market", "Limit", "Stop"] as const).map((tab) => (
              <button
                className={cn(
                  "rounded-[12px] p-2.5 font-semibold text-[12px] transition-colors",
                  orderType === tab ? "bg-toolbar-active-bg text-panel-text-active" : "text-panel-text-muted hover:bg-input-hover",
                )}
                key={tab}
                onClick={() => onOrderTypeChange(tab)}
                type="button"
              >
                {tab}
              </button>
            ))}
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 text-[12px]">
              <label className="text-panel-text-muted" htmlFor="future-trade-size">
                Amount (USDC)
              </label>
              <span className="flex items-center gap-2 text-panel-text-muted/80">
                Balance: {balanceLabel ?? "—"}
                {depositControl}
              </span>
            </div>
            <div className="grid grid-cols-[44px_minmax(0,1fr)_68px_44px] overflow-hidden rounded-[16px] bg-input-bg ring-1 ring-panel-border">
              <button
                aria-label="Decrease amount"
                className="flex min-h-12 items-center justify-center text-panel-text transition-colors hover:bg-input-hover"
                onClick={() => onSizeChange(String(Math.max(0, displayedAmount - nextStepSize)))}
                type="button"
              >
                <Minus className="size-4" />
              </button>
              <input
                className="min-h-12 bg-transparent px-3 text-center font-semibold text-[18px] text-panel-text outline-none"
                id="future-trade-size"
                inputMode="decimal"
                onChange={(event) => onSizeChange(event.target.value.replace(/[^\d.]/g, ""))}
                value={size}
              />
              <div className="flex min-h-12 items-center justify-center text-[12px] text-panel-text-muted">
                USDC
              </div>
              <button
                aria-label="Increase amount"
                className="flex min-h-12 items-center justify-center text-panel-text transition-colors hover:bg-input-hover"
                onClick={() => onSizeChange(String(displayedAmount + nextStepSize))}
                type="button"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          {needsLimitPrice ? (
            <div className="space-y-2">
              <label className="block text-[12px] text-panel-text" htmlFor="future-limit-price">
                {orderType === "Stop" ? "Stop Price" : "Limit Price"}
              </label>
              <div className="flex overflow-hidden rounded-[12px] border border-input-border bg-input-bg">
                <input
                  className="min-h-10 flex-1 bg-transparent px-3 font-semibold text-[14px] text-panel-text outline-none"
                  id="future-limit-price"
                  inputMode="decimal"
                  onChange={(event) => onLimitPriceChange(event.target.value.replace(/[^\d.]/g, ""))}
                  value={limitPrice}
                />
                <div className="flex min-h-10 items-center border-input-border border-l px-3 text-[11px] text-panel-text-muted">
                  {quoteCurrency} / USDC
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-[12px] text-panel-text-muted">Leverage</div>
            <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))" }}>
              {FUTURE_LEVERAGE_OPTIONS.map((option) => (
                <button
                  className={cn(
                    "min-h-11 rounded-[12px] bg-input-bg font-semibold text-[14px] transition-all",
                    leverage === option
                      ? "border-2 border-panel-text-active text-panel-text-active"
                      : "border border-panel-border text-panel-text hover:border-panel-text-active/60 hover:bg-input-hover",
                  )}
                  key={option}
                  onClick={() => onAllocationChange(option)}
                  type="button"
                >
                  {option}x
                </button>
              ))}
            </div>
          </div>

          <section className="space-y-2 rounded-[18px] bg-input-bg p-4 ring-1 ring-panel-border">
            <LabelValueRow label="Position Notional" value={formatCompactAmount(displayedAmount, "USDC")} />
            <LabelValueRow label="Forward Rate" value={formatFutureRate(forwardRate, quoteCurrency)} />
            <LabelValueRow label="Total Notional" value={formatCompactAmount(totalNotional, quoteCurrency)} />
            <LabelValueRow label="Leverage" value={`${leverage}x`} />
            <div className="space-y-2 border-panel-border border-t pt-3">
              <LabelValueRow label="Initial Margin" value={formatCompactAmount(initialMargin, "USDC")} />
              <LabelValueRow label="Maintenance Margin" value={formatCompactAmount(maintenanceMargin, "USDC")} />
              <LabelValueRow label="Liquidation Price" value={formatFutureRate(liquidationPrice, quoteCurrency)} />
              <LabelValueRow label="Taker Fee" value={formatCompactAmount(fee, "USDC", 1)} />
              <LabelValueRow label="Maker Fee" value="Free" valueClassName="font-bold text-panel-text-active" />
            </div>
          </section>

          <button
            className="min-h-14 w-full rounded-[16px] bg-foreground px-3 font-semibold text-[17px] text-background transition-colors hover:bg-foreground/90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting || isSubmitDisabled}
            onClick={() => onSubmit(orderSide)}
            type="button"
          >
            <span className="block">{isSubmitting ? "Submitting..." : "Review"}</span>
          </button>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-[22px] bg-panel-bg-darker shadow-[0_20px_70px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0">
      <div className="space-y-2.5 overflow-y-auto p-3 text-[9px] lg:p-3.5">
        <section className="space-y-2">
          <div className="text-[9px] text-panel-text-muted uppercase tracking-[0.18em]">Direction</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={cn(
                "flex min-h-10 items-center justify-center rounded-2xl px-2.5 py-2 text-center transition-colors",
                isLong
                  ? "bg-[#1FCB84] text-[#081019] ring-1 ring-[#46E6A4]"
                  : "bg-input-bg text-panel-text ring-1 ring-panel-border hover:bg-input-hover",
              )}
              onClick={() => onSideChange("buy")}
              type="button"
            >
              <span className="block font-semibold text-[12px] leading-none">{buyDirectionLabel}</span>
            </button>
            <button
              className={cn(
                "flex min-h-10 items-center justify-center rounded-2xl px-2.5 py-2 text-center transition-colors",
                isLong
                  ? "bg-input-bg text-panel-text ring-1 ring-panel-border hover:bg-input-hover"
                  : "bg-[#E15B64] text-white ring-1 ring-[#F07C84]",
              )}
              onClick={() => onSideChange("sell")}
              type="button"
            >
              <span className="block font-semibold text-[12px] leading-none">{sellDirectionLabel}</span>
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-[9px] text-panel-text-muted uppercase tracking-[0.18em]">Order Type</div>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-input-bg p-1">
          {["Market", "Limit", "Stop"].map((tab) => (
            <button
              className={cn(
                "rounded-xl px-2 py-1 font-medium text-[9px] transition-colors",
                orderType === tab ? "bg-toolbar-active-bg text-panel-text-active" : "text-panel-text-muted hover:bg-input-hover",
              )}
              key={tab}
              onClick={() => onOrderTypeChange(tab as "Limit" | "Market" | "Stop")}
              type="button"
            >
              {tab}
            </button>
          ))}
          </div>
        </section>

        <section className="space-y-2.5">
          <div className="grid gap-2.5 md:grid-cols-2 xl:grid-cols-1">
            <div className="space-y-1.5">
              <label className="text-[9px] text-panel-text-muted uppercase tracking-[0.18em]" htmlFor="trade-size">
                {sizeLabel}
              </label>
              <div className="flex items-center overflow-hidden rounded-2xl bg-input-bg ring-1 ring-panel-border">
                <input
                  className="h-9.5 flex-1 bg-transparent px-3 text-[12px] text-panel-text outline-none placeholder:text-panel-text-muted"
                  id="trade-size"
                  onChange={(event) =>
                    onSizeChange(
                      event.target.value.replace(futureSizeUnit ? /[^\d.]/g : /[^\d]/g, ""),
                    )
                  }
                  placeholder={sizePlaceholder}
                  value={size}
                />
                <div className="flex h-9.5 items-center gap-1 border-panel-border border-l px-3 text-[12px] text-panel-text">
                  {futureSizeUnit ?? "Contracts"}
                </div>
              </div>
            </div>

            {needsLimitPrice ? (
              <div className="space-y-1.5">
                <label className="text-[9px] text-panel-text-muted uppercase tracking-[0.18em]" htmlFor="trade-limit-price">
                  {orderType === "Stop" ? "Stop Price" : "Limit Price"}
                </label>
                <div className="flex items-center overflow-hidden rounded-2xl bg-input-bg ring-1 ring-panel-border">
                  <input
                    className="h-9.5 flex-1 bg-transparent px-3 text-[12px] text-panel-text outline-none placeholder:text-panel-text-muted"
                    id="trade-limit-price"
                    onChange={(event) => onLimitPriceChange(event.target.value.replace(/[^\d.]/g, ""))}
                    placeholder={quoteCurrency === "EURC" || quoteCurrency === "BRZ" ? "0.9250" : "1,605.25"}
                    value={limitPrice}
                  />
                  <div className="flex h-9.5 items-center border-panel-border border-l px-3 text-[8px] text-panel-text-muted uppercase tracking-[0.14em]">
                    {quoteCurrency} / USDC
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2.5">
            <input
              className="h-1.5 flex-1 bg-input-bg accent-[#4277E8]"
              max="100"
              min="0"
              onChange={(event) => onAllocationChange(Number(event.target.value))}
              type="range"
              value={allocation}
            />
            <div className="rounded-xl bg-input-bg px-2.5 py-1 text-[9px] text-panel-text ring-1 ring-panel-border">
              {allocation}%
            </div>
          </div>
        </section>

        <section className="space-y-2 rounded-[18px] bg-input-bg p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-[12px] text-panel-text-active">{contractLabel}</div>
              <div className="mt-1 text-[9px] text-panel-text-muted">{directionCopy}</div>
            </div>
            <div className="rounded-full border border-panel-border px-2 py-1 text-[8px] text-panel-text-muted">
              Physically delivered
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[9px] text-panel-text-muted uppercase tracking-[0.18em]">Order Summary</div>
            {orderSummaryRows.map((item) => (
              <LabelValueRow key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </section>

        {positionBuilderRows.length > 0 ? (
          <section className="space-y-2 rounded-[16px] border border-panel-border bg-input-bg px-3 py-2.5">
            <div className="text-[9px] text-panel-text uppercase tracking-[0.18em]">Position Builder</div>
            {positionBuilderRows.map((item) => (
              <LabelValueRow key={item.label} label={item.label} value={item.value} />
            ))}
          </section>
        ) : null}

        <button
          className={cn(
            "flex h-12 w-full items-center justify-center rounded-2xl font-semibold text-[13px] shadow-[0_12px_30px_rgba(0,0,0,0.28)] transition-all disabled:cursor-not-allowed disabled:opacity-60",
            isLong
              ? "bg-[#1FCB84] text-[#081019] ring-1 ring-[#46E6A4] hover:bg-[#31DA95]"
              : "bg-[#E15B64] text-white ring-1 ring-[#F07C84] hover:bg-[#EA6B74]",
          )}
          onClick={() => onSubmit(orderSide)}
          disabled={isSubmitting || isSubmitDisabled}
          type="button"
        >
          {submitLabel}
        </button>

        <div className="rounded-2xl bg-input-bg px-2.5 py-1.5 text-[9px] text-panel-text-muted ring-1 ring-panel-border">
          {lastAction}
        </div>

        <section className="rounded-[20px] bg-input-bg/50 ring-1 ring-panel-border">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-left"
            onClick={() => setAdvancedOpen((current) => !current)}
            type="button"
          >
            <span className="font-medium text-[12px] text-panel-text">Advanced Settings</span>
            {advancedOpen ? <ChevronUp className="size-3.5 text-panel-text-muted" /> : <ChevronDown className="size-3.5 text-panel-text-muted" />}
          </button>

          {advancedOpen ? (
            <div className="space-y-2 border-panel-border border-t p-3">
              <div className="grid grid-cols-2 gap-2 text-[8px]">
                <button
                  className="flex items-center justify-between rounded-xl bg-input-bg px-2.5 py-1.5"
                  onClick={onPostOnlyToggle}
                  type="button"
                >
                  <span className="text-panel-text-muted">Post Only</span>
                  <span className={cn("text-panel-text-muted", postOnly && "text-spread-percent")}>{postOnly ? "On" : "Off"}</span>
                </button>
                <button
                  className="flex items-center justify-between rounded-xl bg-input-bg px-2.5 py-1.5"
                  onClick={onAtExpiryDeliverToggle}
                  type="button"
                >
                  <span className="text-panel-text-muted">At Expiry Deliver</span>
                  <span className={cn("text-panel-text-muted", atExpiryDeliver && "text-spread-percent")}>
                    {atExpiryDeliver ? "On" : "Off"}
                  </span>
                </button>
              </div>
              <div className="space-y-1.5 border-panel-border border-t pt-2">
                {advancedSummaryRows.map((item) => (
                  <LabelValueRow key={item.label} label={item.label} value={item.value} />
                ))}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="inline-flex items-center gap-1 text-panel-text-muted">
                    Slippage Estimate
                    <Info className="size-2.5" />
                  </span>
                  <span className="font-medium text-panel-text">{slippageEstimate}</span>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="border-panel-border border-t pt-3.5">
          <div className="space-y-3">
            <div className="text-[10px] text-panel-text-muted uppercase tracking-[0.18em]">Contract Details</div>
            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
              {contractDetails.map((item) => (
                <LabelValueRow key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-2.5 border-panel-border border-t pt-3.5">
          <div className="text-[10px] text-panel-text-muted uppercase tracking-[0.18em]">Position Summary</div>
          <div className="rounded-[22px] bg-input-bg p-3.5 ring-1 ring-panel-border">
            <div className="text-[10px] text-panel-text-muted uppercase tracking-[0.18em]">Unrealized PnL</div>
            <div className={cn("mt-2 font-semibold text-[22px]", isNegativePnl ? "text-ask-text" : "text-bid-text")}>
              {pnl}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 flex-1 text-panel-text-muted">{exposureLabel}</span>
              <span className={cn("font-medium", isNegativeReturn ? "text-ask-text" : "text-bid-text")}>{returnValue}</span>
            </div>
          </div>
          {positionOverview.map((item) => (
            <LabelValueRow key={item.label} label={item.label} value={item.value} />
          ))}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {["Close Position", "Reduce 25%", "Reduce 50%", "Close All"].map((action) => (
              <button
                className="h-8 cursor-not-allowed rounded-xl bg-input-bg text-[9px] text-panel-text-muted opacity-50 transition-colors"
                disabled
                key={action}
                type="button"
              >
                {action}
              </button>
            ))}
          </div>
          <div className="text-[10px] text-panel-text-muted">{`${returnLabel} uses preview math. Reduction controls stay disabled until venue actions are wired.`}</div>
        </section>
      </div>
    </section>
  );
}
