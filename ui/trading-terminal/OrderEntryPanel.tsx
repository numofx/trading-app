"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ChevronUp, Info, Minus, Plus } from "lucide-react";
import { useState } from "react";
import type { DeliveryTerm } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

const FUTURE_LEVERAGE_OPTIONS = [1, 2, 5, 10, 20] as const;

function LabelValueRow({ label, value }: { label: string; value: string }) {
  const isNegative = value.startsWith("-");
  const isPositive = value.startsWith("+");

  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <span className="min-w-0 flex-1 text-[#738095]">{label}</span>
      <span
        className={cn(
          "wrap-break-word min-w-0 max-w-[60%] text-right font-medium text-[#D7DEE8] leading-snug",
          isPositive && "text-[#8AB899]",
          isNegative && "text-[#C89393]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

function getDirectionCopy(isSpotUSDIntent: boolean, isLong: boolean) {
  if (isSpotUSDIntent) {
    return isLong ? "Buy USDC / sell cNGN" : "Sell USDC / buy cNGN";
  }

  return isLong ? "Buy cNGN / sell USDC" : "Sell cNGN / buy USDC";
}

function getSubmitLabel(isSubmitting: boolean, isSpotUSDIntent: boolean, isLong: boolean, isFXFuture: boolean) {
  if (isSubmitting) {
    return "Submitting...";
  }

  if (isFXFuture) {
    return isLong ? "Long" : "Short";
  }

  if (isSpotUSDIntent) {
    return isLong ? "Buy" : "Sell";
  }

  return isLong ? "Long cNGN" : "Short cNGN";
}

function parseDisplayNumber(value: string) {
  const parsed = Number(value.replaceAll(",", "").replaceAll("$", "").replaceAll("₦", "").replaceAll("cNGN", "").replaceAll("USDC", ""));

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

function formatFutureRate(value: number) {
  if (!Number.isFinite(value)) {
    return "— / USDC";
  }

  return `₦${value.toLocaleString("en-US", { maximumFractionDigits: 0 })} / USDC`;
}

function getSummaryRowValue(rows: DeliveryTerm[], label: string) {
  return rows.find((row) => row.label === label)?.value ?? null;
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This panel intentionally coordinates several dense trading UI sections.
export function OrderEntryPanel({
  allocation,
  advancedSummaryRows,
  atExpiryDeliver,
  contractDetails,
  contractLabel,
  isSubmitting,
  isSubmitDisabled,
  isSpotUSDIntent,
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
  spotSizeCurrency,
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
  onSpotSizeCurrencyChange,
  onSubmit,
}: {
  allocation: number;
  advancedSummaryRows: DeliveryTerm[];
  atExpiryDeliver: boolean;
  contractDetails: DeliveryTerm[];
  contractLabel: string;
  isSubmitting?: boolean;
  isSubmitDisabled?: boolean;
  isSpotUSDIntent: boolean;
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
  spotSizeCurrency?: "USDC" | "cNGN";
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
  onSpotSizeCurrencyChange?: (value: "USDC" | "cNGN") => void;
  onSubmit: (side: "buy" | "sell") => void;
}) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [sizeCurrencyPickerOpen, setSizeCurrencyPickerOpen] = useState(false);
  const isLong = orderSide === "buy";
  const needsLimitPrice = orderType !== "Market";
  let directionCopy = getDirectionCopy(isSpotUSDIntent, isLong);
  if (isFXFuture) {
    directionCopy = isLong ? "Long" : "Short";
  }
  const submitLabel = getSubmitLabel(Boolean(isSubmitting), isSpotUSDIntent, isLong, isFXFuture);
  let buyDirectionLabel = isSpotUSDIntent ? "Buy" : "Long";
  let sellDirectionLabel = isSpotUSDIntent ? "Sell" : "Short";
  if (isFXFuture) {
    buyDirectionLabel = "Long";
    sellDirectionLabel = "Short";
  }
  const activeSpotSizeCurrency = spotSizeCurrency ?? "USDC";
  const isNegativePnl = pnl.startsWith("-");
  const isNegativeReturn = returnValue.startsWith("-");
  let sizeLabel = "Size";
  let sizePlaceholder = "5";

  if (isSpotUSDIntent) {
    sizeLabel = `Size (${activeSpotSizeCurrency})`;
    sizePlaceholder = activeSpotSizeCurrency === "USDC" ? "100" : "160,000";
  } else if (futureSizeUnit) {
    sizeLabel = `Size (${futureSizeUnit})`;
  }

  if (isFXFuture) {
    const leverage = FUTURE_LEVERAGE_OPTIONS.includes(allocation as (typeof FUTURE_LEVERAGE_OPTIONS)[number])
      ? allocation
      : 10;
    const amount = Number(size || "0");
    const displayedAmount = Number.isFinite(amount) ? amount : 0;
    const fallbackRate = parseDisplayNumber(limitPrice);
    const summaryRate = parseDisplayNumber(getSummaryRowValue(orderSummaryRows, "Est. Fill Price") ?? "");
    const forwardRate = Number.isFinite(fallbackRate) ? fallbackRate : summaryRate;
    const totalNotional = Number.isFinite(forwardRate) ? displayedAmount * forwardRate : Number.NaN;
    const initialMargin = displayedAmount / leverage;
    const maintenanceMargin = initialMargin / 2;
    const summaryLiquidationPrice = parseDisplayNumber(getSummaryRowValue(orderSummaryRows, "Liquidation Price") ?? "");
    const liquidationPrice = Number.isFinite(summaryLiquidationPrice)
      ? summaryLiquidationPrice
      : forwardRate - (isLong ? 160 : -160);
    const fee = displayedAmount * 0.000_75;
    const nextStepSize = displayedAmount >= 1000 ? 1000 : 1;
    return (
      <section className="flex h-full min-h-[300px] flex-col rounded-[18px] border border-white/10 bg-black/92 p-3 text-[#F5F5F5] shadow-[0_20px_70px_rgba(0,0,0,0.32)] xl:min-h-0">
        <div className="space-y-3.5 overflow-y-auto">
          <div className="grid grid-cols-2 overflow-hidden rounded-[12px] border border-white/14">
            <button
              className={cn(
                "min-h-11 px-3 font-semibold text-[14px] transition-colors",
                isLong ? "bg-white text-black" : "bg-transparent text-white hover:bg-white/6",
              )}
              onClick={() => onSideChange("buy")}
              type="button"
            >
              Long
            </button>
            <button
              className={cn(
                "min-h-11 border-white/14 border-l px-3 font-semibold text-[14px] transition-colors",
                isLong ? "bg-transparent text-white hover:bg-white/6" : "bg-white text-black",
              )}
              onClick={() => onSideChange("sell")}
              type="button"
            >
              Short
            </button>
          </div>

          <div className="grid grid-cols-3 rounded-[14px] bg-white/6 p-1">
            {(["Market", "Limit", "Stop"] as const).map((tab) => (
              <button
                className={cn(
                  "rounded-[10px] p-2 font-semibold text-[12px] transition-colors",
                  orderType === tab ? "bg-white/12 text-white" : "text-white/75 hover:bg-white/7",
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
              <label className="text-white/82" htmlFor="future-trade-size">
                Amount (USDC)
              </label>
              <span className="text-white/70">Balance: 250,000 USDC</span>
            </div>
            <div className="grid grid-cols-[42px_minmax(0,1fr)_66px_42px] overflow-hidden rounded-[12px] border border-white/10 bg-white/6">
              <button
                aria-label="Decrease amount"
                className="flex min-h-11 items-center justify-center border-white/10 border-r text-white transition-colors hover:bg-white/8"
                onClick={() => onSizeChange(String(Math.max(0, displayedAmount - nextStepSize)))}
                type="button"
              >
                <Minus className="size-4" />
              </button>
              <input
                className="min-h-11 bg-transparent px-3 text-center font-semibold text-[18px] text-white outline-none"
                id="future-trade-size"
                inputMode="decimal"
                onChange={(event) => onSizeChange(event.target.value.replace(/[^\d.]/g, ""))}
                value={size}
              />
              <div className="flex min-h-11 items-center justify-center border-white/10 border-l text-[12px] text-white/75">
                USDC
              </div>
              <button
                aria-label="Increase amount"
                className="flex min-h-11 items-center justify-center border-white/10 border-l text-white transition-colors hover:bg-white/8"
                onClick={() => onSizeChange(String(displayedAmount + nextStepSize))}
                type="button"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>

          {needsLimitPrice ? (
            <div className="space-y-2">
              <label className="block text-[12px] text-white/82" htmlFor="future-limit-price">
                {orderType === "Stop" ? "Stop Price" : "Limit Price"}
              </label>
              <div className="flex overflow-hidden rounded-[12px] border border-white/10 bg-white/6">
                <input
                  className="min-h-10 flex-1 bg-transparent px-3 font-semibold text-[14px] text-white outline-none"
                  id="future-limit-price"
                  inputMode="decimal"
                  onChange={(event) => onLimitPriceChange(event.target.value.replace(/[^\d.]/g, ""))}
                  value={limitPrice}
                />
                <div className="flex min-h-10 items-center border-white/10 border-l px-3 text-[11px] text-white/65">
                  cNGN / USDC
                </div>
              </div>
            </div>
          ) : null}

          <div className="space-y-2">
            <div className="text-[12px] text-white/82">Leverage</div>
            <div className="grid grid-cols-5 gap-2">
              {FUTURE_LEVERAGE_OPTIONS.map((option) => (
                <button
                  className={cn(
                    "min-h-10 rounded-[8px] border border-white/14 font-semibold text-[14px] transition-colors",
                    leverage === option ? "bg-white text-black" : "bg-transparent text-white hover:bg-white/7",
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

          <section className="space-y-2 rounded-[10px] border border-white/10 bg-white/[0.035] p-3">
            <LabelValueRow label="Position Notional" value={formatCompactAmount(displayedAmount, "USDC")} />
            <LabelValueRow label="Forward Rate" value={formatFutureRate(forwardRate)} />
            <LabelValueRow label="Total Notional" value={formatCompactAmount(totalNotional, "cNGN")} />
            <LabelValueRow label="Leverage" value={`${leverage}x`} />
            <div className="border-white/10 border-t pt-2">
              <LabelValueRow label={`Initial Margin (${Math.round(100 / leverage)}%)`} value={formatCompactAmount(initialMargin, "USDC")} />
              <LabelValueRow label={`Maintenance Margin (${Math.round(50 / leverage)}%)`} value={formatCompactAmount(maintenanceMargin, "USDC")} />
              <LabelValueRow label="Liquidation Price" value={formatFutureRate(liquidationPrice)} />
              <LabelValueRow label="Fee (0.075%)" value={formatCompactAmount(fee, "USDC", 1)} />
            </div>
          </section>

          <button
            className="min-h-13 w-full rounded-[10px] bg-white px-3 font-semibold text-[17px] text-black transition-colors hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting || isSubmitDisabled}
            onClick={() => onSubmit(orderSide)}
            type="button"
          >
            <span className="block">{isSubmitting ? "Submitting..." : "Review"}</span>
          </button>

          <div className="rounded-[12px] border border-white/10 bg-white/[0.035] px-3 py-2 text-[11px] text-white/65">
            {lastAction}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="flex h-full min-h-[300px] flex-col overflow-hidden rounded-[22px] bg-[#0D141E]/96 shadow-[0_20px_70px_rgba(0,0,0,0.32)] ring-1 ring-white/6 xl:min-h-0">
      <div className="space-y-2.5 overflow-y-auto p-3 text-[9px] lg:p-3.5">
        <section className="space-y-2">
          <div className="text-[#6C798B] text-[9px] uppercase tracking-[0.18em]">Direction</div>
          <div className="grid grid-cols-2 gap-2">
            <button
              className={cn(
                "flex min-h-10 items-center justify-center rounded-2xl px-2.5 py-2 text-center transition-colors",
                isLong
                  ? "bg-[#22BC87] text-[#081019] ring-1 ring-[#37D79F]"
                  : "bg-white/8 text-[#F4F7FB] ring-1 ring-white/6",
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
                  ? "bg-white/8 text-[#F4F7FB] ring-1 ring-white/6"
                  : "bg-white/16 text-white ring-1 ring-white/10 [text-shadow:0_1px_0_rgba(0,0,0,0.45)]",
              )}
              onClick={() => onSideChange("sell")}
              type="button"
            >
              <span className="block font-semibold text-[12px] leading-none">{sellDirectionLabel}</span>
            </button>
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-[#6C798B] text-[9px] uppercase tracking-[0.18em]">Order Type</div>
          <div className="grid grid-cols-3 gap-1 rounded-2xl bg-white/[0.035] p-1">
          {["Market", "Limit", "Stop"].map((tab) => (
            <button
              className={cn(
                "rounded-xl px-2 py-1 font-medium text-[9px] transition-colors",
                orderType === tab ? "bg-white/8 text-[#E7EDF6]" : "text-[#748195]",
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
              <label className="text-[#6C798B] text-[9px] uppercase tracking-[0.18em]" htmlFor="trade-size">
                {sizeLabel}
              </label>
              <div className="flex items-center overflow-hidden rounded-2xl bg-white/4 ring-1 ring-white/6">
                <input
                  className="h-9.5 flex-1 bg-transparent px-3 text-[#D7DEE8] text-[12px] outline-none placeholder:text-[#6C798B]"
                  id="trade-size"
                  onChange={(event) =>
                    onSizeChange(
                      event.target.value.replace(isSpotUSDIntent || futureSizeUnit ? /[^\d.]/g : /[^\d]/g, ""),
                    )
                  }
                  placeholder={sizePlaceholder}
                  value={size}
                />
                {isSpotUSDIntent ? (
                  <Popover.Root onOpenChange={setSizeCurrencyPickerOpen} open={sizeCurrencyPickerOpen}>
                    <Popover.Trigger className="flex h-9.5 items-center gap-1 border-white/6 border-l px-3 text-[#C2CCD9] text-[12px] transition-colors hover:bg-white/5 data-popup-open:bg-white/6">
                      {activeSpotSizeCurrency}
                      <ChevronDown className="size-3.5 text-[#6C798B]" />
                    </Popover.Trigger>
                    <Popover.Portal>
                      <Popover.Positioner align="end" sideOffset={8}>
                        <Popover.Popup className="z-50 overflow-hidden rounded-2xl border border-white/8 bg-[#111926] p-1 shadow-[0_20px_60px_rgba(0,0,0,0.45)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
                          {(["USDC", "cNGN"] as const).map((currency) => (
                            <button
                              className={cn(
                                "flex min-w-20 items-center justify-between rounded-xl px-2.5 py-1.5 text-left text-[11px] transition-colors",
                                activeSpotSizeCurrency === currency
                                  ? "bg-white/8 text-[#E7EDF6]"
                                  : "text-[#9BA8BA] hover:bg-white/5 hover:text-[#E7EDF6]",
                              )}
                              key={currency}
                              onClick={() => {
                                onSpotSizeCurrencyChange?.(currency);
                                setSizeCurrencyPickerOpen(false);
                              }}
                              type="button"
                            >
                              <span>{currency}</span>
                              {activeSpotSizeCurrency === currency ? <ChevronUp className="size-3 text-[#7BA7F4]" /> : null}
                            </button>
                          ))}
                        </Popover.Popup>
                      </Popover.Positioner>
                    </Popover.Portal>
                  </Popover.Root>
                ) : (
                  <div className="flex h-9.5 items-center gap-1 border-white/6 border-l px-3 text-[#C2CCD9] text-[12px]">
                    {futureSizeUnit ?? "Contracts"}
                  </div>
                )}
              </div>
            </div>

            {needsLimitPrice ? (
              <div className="space-y-1.5">
                <label className="text-[#6C798B] text-[9px] uppercase tracking-[0.18em]" htmlFor="trade-limit-price">
                  {orderType === "Stop" ? "Stop Price" : "Limit Price"}
                </label>
                <div className="flex items-center overflow-hidden rounded-2xl bg-white/4 ring-1 ring-white/6">
                  <input
                    className="h-9.5 flex-1 bg-transparent px-3 text-[#D7DEE8] text-[12px] outline-none placeholder:text-[#6C798B]"
                    id="trade-limit-price"
                    onChange={(event) => onLimitPriceChange(event.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="1,605.25"
                    value={limitPrice}
                  />
                  <div className="flex h-9.5 items-center border-white/6 border-l px-3 text-[#738095] text-[8px] uppercase tracking-[0.14em]">
                    cNGN / USDC
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-2.5">
            <input
              className="h-1.5 flex-1 accent-[#4277E8]"
              max="100"
              min="0"
              onChange={(event) => onAllocationChange(Number(event.target.value))}
              type="range"
              value={allocation}
            />
            <div className="rounded-xl bg-white/4 px-2.5 py-1 text-[#D7DEE8] text-[9px] ring-1 ring-white/6">
              {allocation}%
            </div>
          </div>
        </section>

        <section className="space-y-2 rounded-[18px] bg-[#0B121B] p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-[#E5ECF5] text-[12px]">{contractLabel}</div>
              <div className="mt-1 text-[#738095] text-[9px]">{directionCopy}</div>
            </div>
            <div className="rounded-full border border-white/8 px-2 py-1 text-[#6F7C90] text-[8px]">
              {isSpotUSDIntent ? "Spot settled" : "Physically delivered"}
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[#6C798B] text-[9px] uppercase tracking-[0.18em]">Order Summary</div>
            {orderSummaryRows.map((item) => (
              <LabelValueRow key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </section>

        {positionBuilderRows.length > 0 ? (
          <section className="space-y-2 rounded-[16px] border border-[#2A3B51] bg-[#101823] px-3 py-2.5">
            <div className="text-[#8FA4BE] text-[9px] uppercase tracking-[0.18em]">Position Builder</div>
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

        <div className="rounded-2xl bg-white/3 px-2.5 py-1.5 text-[#97A3B4] text-[9px] ring-1 ring-white/6">
          {lastAction}
        </div>

        <section className="rounded-[20px] bg-white/2.5 ring-1 ring-white/6">
          <button
            className="flex w-full items-center justify-between px-3 py-2 text-left"
            onClick={() => setAdvancedOpen((current) => !current)}
            type="button"
          >
            <span className="font-medium text-[#CBD5E1] text-[12px]">Advanced Settings</span>
            {advancedOpen ? <ChevronUp className="size-3.5 text-[#6C798B]" /> : <ChevronDown className="size-3.5 text-[#6C798B]" />}
          </button>

          {advancedOpen ? (
            <div className="space-y-2 border-white/6 border-t p-3">
              <div className="grid grid-cols-2 gap-2 text-[8px]">
                <button
                  className="flex items-center justify-between rounded-xl bg-white/4 px-2.5 py-1.5"
                  onClick={onPostOnlyToggle}
                  type="button"
                >
                  <span className="text-[#97A3B4]">Post Only</span>
                  <span className={cn("text-[#738095]", postOnly && "text-[#A8C4F6]")}>{postOnly ? "On" : "Off"}</span>
                </button>
                <button
                  className="flex items-center justify-between rounded-xl bg-white/4 px-2.5 py-1.5"
                  onClick={onAtExpiryDeliverToggle}
                  type="button"
                >
                  <span className="text-[#97A3B4]">At Expiry Deliver</span>
                  <span className={cn("text-[#738095]", atExpiryDeliver && "text-[#A8C4F6]")}>
                    {atExpiryDeliver ? "On" : "Off"}
                  </span>
                </button>
              </div>
              <div className="space-y-1.5 border-white/6 border-t pt-2">
                {advancedSummaryRows.map((item) => (
                  <LabelValueRow key={item.label} label={item.label} value={item.value} />
                ))}
                <div className="flex items-center justify-between text-[10px]">
                  <span className="inline-flex items-center gap-1 text-[#738095]">
                    Slippage Estimate
                    <Info className="size-2.5" />
                  </span>
                  <span className="font-medium text-[#D7DEE8]">{slippageEstimate}</span>
                </div>
              </div>
            </div>
          ) : null}
        </section>

        <section className="border-white/6 border-t pt-3.5">
          <div className="space-y-3">
            <div className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]">Contract Details</div>
            <div className="grid gap-x-3 gap-y-2 sm:grid-cols-2">
              {contractDetails.map((item) => (
                <LabelValueRow key={item.label} label={item.label} value={item.value} />
              ))}
            </div>
          </div>
        </section>

        <section className="space-y-2.5 border-white/6 border-t pt-3.5">
          <div className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]">Position Summary</div>
          <div className="rounded-[22px] bg-white/[0.035] p-3.5 ring-1 ring-white/6">
            <div className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]">Unrealized PnL</div>
            <div className={cn("mt-2 font-semibold text-[22px]", isNegativePnl ? "text-[#C89393]" : "text-[#8AB899]")}>
              {pnl}
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[11px]">
              <span className="min-w-0 flex-1 text-[#97A3B4]">{exposureLabel}</span>
              <span className={cn("font-medium", isNegativeReturn ? "text-[#C89393]" : "text-[#8AB899]")}>{returnValue}</span>
            </div>
          </div>
          {positionOverview.map((item) => (
            <LabelValueRow key={item.label} label={item.label} value={item.value} />
          ))}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {["Close Position", "Reduce 25%", "Reduce 50%", "Close All"].map((action) => (
              <button
                className="h-8 cursor-not-allowed rounded-xl bg-white/4 text-[#738095] text-[9px] opacity-50 transition-colors"
                disabled
                key={action}
                type="button"
              >
                {action}
              </button>
            ))}
          </div>
          <div className="text-[#4F5D70] text-[10px]">{`${returnLabel} uses preview math. Reduction controls stay disabled until venue actions are wired.`}</div>
        </section>
      </div>
    </section>
  );
}
