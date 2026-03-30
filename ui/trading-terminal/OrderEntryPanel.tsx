"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { useState } from "react";
import type { DeliveryTerm } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

function LabelValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3 text-[11px]">
      <span className="min-w-0 flex-1 text-[#738095]">{label}</span>
      <span
        className={cn(
          "wrap-break-word min-w-0 max-w-[60%] text-right font-medium text-[#D7DEE8] leading-snug",
          value.startsWith("+$") && "text-[#8AB899]",
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

function getSubmitLabel(isSubmitting: boolean, isSpotUSDIntent: boolean, isLong: boolean) {
  if (isSubmitting) {
    return "Submitting...";
  }

  if (isSpotUSDIntent) {
    return isLong ? "Buy" : "Sell";
  }

  return isLong ? "Long cNGN" : "Short cNGN";
}

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This panel intentionally coordinates several dense trading UI sections.
export function OrderEntryPanel({
  allocation,
  atExpiryDeliver,
  buyingPower,
  contractDetails,
  contractLabel,
  estimatedAverageExecution,
  estimatedFillPrice,
  fees,
  initialMargin,
  isSubmitting,
  isSubmitDisabled,
  isSpotUSDIntent,
  lastAction,
  limitPrice,
  liquidationPrice,
  orderValue,
  orderType,
  pnl,
  positionOverview,
  positionValue,
  postOnly,
  returnPercent,
  size,
  spotSizeCurrency,
  slippageEstimate,
  tradeSide,
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
  atExpiryDeliver: boolean;
  buyingPower: string;
  contractDetails: DeliveryTerm[];
  contractLabel: string;
  estimatedAverageExecution: string;
  estimatedFillPrice: string;
  fees: string;
  initialMargin: string;
  isSubmitting?: boolean;
  isSubmitDisabled?: boolean;
  isSpotUSDIntent: boolean;
  lastAction: string;
  limitPrice: string;
  liquidationPrice: string;
  orderValue: string;
  orderType: "Limit" | "Market" | "Stop";
  pnl: string;
  positionOverview: DeliveryTerm[];
  positionValue: string;
  postOnly: boolean;
  returnPercent: string;
  size: string;
  spotSizeCurrency?: "USDC" | "cNGN";
  slippageEstimate: string;
  tradeSide: "buy" | "sell";
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
  const isLong = tradeSide === "buy";
  const needsLimitPrice = orderType !== "Market";
  const directionCopy = getDirectionCopy(isSpotUSDIntent, isLong);
  const submitLabel = getSubmitLabel(Boolean(isSubmitting), isSpotUSDIntent, isLong);
  const activeSpotSizeCurrency = spotSizeCurrency ?? "USDC";
  let sizePlaceholder = "50,000";

  if (isSpotUSDIntent) {
    sizePlaceholder = activeSpotSizeCurrency === "USDC" ? "100" : "160,000";
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
              <span className="block font-semibold text-[12px] leading-none">{isSpotUSDIntent ? "Buy" : "Long"}</span>
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
              <span className="block font-semibold text-[12px] leading-none">{isSpotUSDIntent ? "Sell" : "Short"}</span>
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
                {isSpotUSDIntent ? `Size (${activeSpotSizeCurrency})` : "Size"}
              </label>
              <div className="flex items-center overflow-hidden rounded-2xl bg-white/4 ring-1 ring-white/6">
                <input
                  className="h-9.5 flex-1 bg-transparent px-3 text-[#D7DEE8] text-[12px] outline-none placeholder:text-[#6C798B]"
                  id="trade-size"
                  onChange={(event) =>
                    onSizeChange(
                      event.target.value.replace(isSpotUSDIntent ? /[^\d.]/g : /[^\d]/g, ""),
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
                    Contracts
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

        <section className="space-y-2 rounded-[20px] bg-white/[0.035] p-3 ring-1 ring-white/6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-[#E5ECF5] text-[12px]">{contractLabel}</div>
              <div className="mt-1 text-[#738095] text-[9px]">{directionCopy}</div>
            </div>
            <div className="rounded-xl bg-[#142030] px-2 py-1 text-[#A8C4F6] text-[8px]">
              {isSpotUSDIntent ? "Spot settled" : "Physically delivered"}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="text-[#6C798B] text-[9px] uppercase tracking-[0.18em]">Order Summary</div>
          <LabelValueRow label="Order Value" value={orderValue} />
          <LabelValueRow label="Initial Margin" value={initialMargin} />
          <LabelValueRow label="Fees" value={fees} />
          <LabelValueRow label="Available Buying Power" value={buyingPower} />
          <div className="flex items-center justify-between text-[10px]">
            <span className="inline-flex items-center gap-1 text-[#738095]">
              Slippage Estimate
              <Info className="size-2.5" />
            </span>
            <span className="font-medium text-[#D7DEE8]">{slippageEstimate}</span>
          </div>
          <LabelValueRow label="Estimated Fill Price" value={estimatedFillPrice} />
          <LabelValueRow label="Estimated Avg Execution" value={estimatedAverageExecution} />
          <LabelValueRow label="Liquidation Price" value={liquidationPrice} />
          </div>
        </section>

        <button
          className={cn(
            "flex h-9.5 w-full items-center justify-center rounded-2xl font-semibold text-[12px] transition-colors disabled:cursor-not-allowed disabled:opacity-80",
            isLong
              ? "bg-[#E9EEF7] text-[#081019] hover:bg-white"
              : "bg-[#E9EEF7] text-[#081019] hover:bg-white",
          )}
          onClick={() => onSubmit(tradeSide)}
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
            <div className="mt-2 font-semibold text-[#8AB899] text-[22px]">{pnl}</div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className="text-[#97A3B4]">{positionValue}</span>
              <span className="font-medium text-[#8AB899]">{returnPercent}</span>
            </div>
          </div>
          {positionOverview.map((item) => (
            <LabelValueRow key={item.label} label={item.label} value={item.value} />
          ))}
          <div className="grid grid-cols-2 gap-2 pt-1">
            {["Close Position", "Reduce 25%", "Reduce 50%", "Close All"].map((action) => (
              <button
                className="h-8 rounded-xl bg-white/4 text-[#738095] text-[9px] transition-colors"
                disabled
                key={action}
                type="button"
              >
                {action}
              </button>
            ))}
          </div>
          <div className="text-[#4F5D70] text-[10px]">TODO: wire position reductions to venue actions.</div>
        </section>
      </div>
    </section>
  );
}
