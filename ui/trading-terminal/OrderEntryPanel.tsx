import { ChevronDown, ChevronUp, Info } from "lucide-react";
import { useState } from "react";
import type { DeliveryTerm } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

function LabelValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-[#738095]">{label}</span>
      <span
        className={cn(
          "font-medium text-[#D7DEE8]",
          value.startsWith("+$") && "text-[#8AB899]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

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
  slippageEstimate,
  tradeSide,
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
  atExpiryDeliver: boolean;
  buyingPower: string;
  contractDetails: DeliveryTerm[];
  contractLabel: string;
  estimatedAverageExecution: string;
  estimatedFillPrice: string;
  fees: string;
  initialMargin: string;
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
  slippageEstimate: string;
  tradeSide: "buy" | "sell";
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
  const isLong = tradeSide === "buy";
  const needsLimitPrice = orderType !== "Market";
  const directionCopy = isLong
    ? "Buy cNGN / sell USDC"
    : "Sell cNGN / buy USDC";

  return (
    <section className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-[24px] bg-[#0D141E]/96 shadow-[0_20px_70px_rgba(0,0,0,0.32)] ring-1 ring-white/6 xl:min-h-0">
      <div className="space-y-3 overflow-y-auto p-3.5 text-[10px] lg:p-4">
        <section className="space-y-3">
          <div className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]">Direction</div>
          <div className="grid grid-cols-2 gap-2.5">
            <button
              className={cn(
                "rounded-2xl px-3.5 py-3.5 text-left transition-colors",
                isLong
                  ? "bg-[#153425] text-[#EAF7EF] ring-1 ring-[#21583E]"
                  : "bg-white/[0.035] text-[#D7DEE8] ring-1 ring-white/6",
              )}
              onClick={() => onSideChange("buy")}
              type="button"
            >
              <span className="block font-semibold text-[13px]">Long cNGN</span>
              <span className={cn("mt-1 block text-[10px]", isLong ? "text-[#9CC7A9]" : "text-[#768397]")}>Buy cNGN / sell USDC</span>
            </button>
            <button
              className={cn(
                "rounded-2xl px-3.5 py-3.5 text-left transition-colors",
                isLong
                  ? "bg-white/[0.035] text-[#D7DEE8] ring-1 ring-white/6"
                  : "bg-[#401C1F] text-[#FFF0F0] ring-1 ring-[#683235]",
              )}
              onClick={() => onSideChange("sell")}
              type="button"
            >
              <span className="block font-semibold text-[13px]">Short cNGN</span>
              <span className={cn("mt-1 block text-[10px]", isLong ? "text-[#768397]" : "text-[#D0A0A0]")}>Sell cNGN / buy USDC</span>
            </button>
          </div>
        </section>

        <section className="space-y-3">
          <div className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]">Order Type</div>
          <div className="grid grid-cols-3 gap-1.5 rounded-2xl bg-white/[0.035] p-1.5">
          {["Market", "Limit", "Stop"].map((tab) => (
            <button
              className={cn(
                "rounded-xl px-2.5 py-1.5 font-medium text-[10px] transition-colors",
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

        <section className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-1">
            <div className="space-y-2">
              <label className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]" htmlFor="trade-size">
                Size
              </label>
              <div className="flex items-center overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/6">
            <input
              className="h-11 flex-1 bg-transparent px-3.5 text-[#D7DEE8] text-[13px] outline-none placeholder:text-[#6C798B]"
              id="trade-size"
              onChange={(event) => onSizeChange(event.target.value.replace(/[^\d]/g, ""))}
              placeholder="50,000"
              value={size}
            />
                <button
                  className="flex h-11 items-center gap-1 border-white/6 border-l px-3.5 text-[#C2CCD9] text-[13px]"
              type="button"
            >
              Contracts
                  <ChevronDown className="size-4 text-[#6C798B]" />
            </button>
          </div>
            </div>

            {needsLimitPrice ? (
              <div className="space-y-2">
                <label className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]" htmlFor="trade-limit-price">
                  {orderType === "Stop" ? "Stop Price" : "Limit Price"}
                </label>
                <div className="flex items-center overflow-hidden rounded-2xl bg-white/[0.04] ring-1 ring-white/6">
                  <input
                    className="h-11 flex-1 bg-transparent px-3.5 text-[#D7DEE8] text-[13px] outline-none placeholder:text-[#6C798B]"
                    id="trade-limit-price"
                    onChange={(event) => onLimitPriceChange(event.target.value.replace(/[^\d.]/g, ""))}
                    placeholder="1,605.25"
                    value={limitPrice}
                  />
                  <div className="flex h-11 items-center border-white/6 border-l px-3.5 text-[#738095] text-[9px] uppercase tracking-[0.14em]">
                    cNGN / USDC
                  </div>
                </div>
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <input
              className="h-1.5 flex-1 accent-[#4277E8]"
              max="100"
              min="0"
              onChange={(event) => onAllocationChange(Number(event.target.value))}
              type="range"
              value={allocation}
            />
            <div className="rounded-xl bg-white/[0.04] px-3 py-1.5 text-[#D7DEE8] text-[10px] ring-1 ring-white/6">
              {allocation}%
            </div>
          </div>
        </section>

        <section className="space-y-2.5 rounded-[22px] bg-white/[0.035] p-3.5 ring-1 ring-white/6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-semibold text-[#E5ECF5] text-[13px]">{contractLabel}</div>
              <div className="mt-1 text-[#738095] text-[10px]">{directionCopy}</div>
            </div>
            <div className="rounded-xl bg-[#142030] px-2.5 py-1 text-[#A8C4F6] text-[9px]">
              Physically delivered
            </div>
          </div>
          <div className="space-y-2">
            <div className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]">Order Summary</div>
          <LabelValueRow label="Order Value" value={orderValue} />
          <LabelValueRow label="Initial Margin" value={initialMargin} />
          <LabelValueRow label="Fees" value={fees} />
          <LabelValueRow label="Available Buying Power" value={buyingPower} />
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1 text-[#738095]">
              Slippage Estimate
              <Info className="size-3" />
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
            "flex h-11 w-full items-center justify-center rounded-2xl font-semibold text-[13px] transition-colors",
            isLong
              ? "bg-[#E9EEF7] text-[#081019] hover:bg-white"
              : "bg-[#E9EEF7] text-[#081019] hover:bg-white",
          )}
          onClick={() => onSubmit(tradeSide)}
          type="button"
        >
          {isLong ? "Long cNGN" : "Short cNGN"}
        </button>

        <section className="rounded-[22px] bg-white/[0.025] ring-1 ring-white/6">
          <button
            className="flex w-full items-center justify-between px-3.5 py-2.5 text-left"
            onClick={() => setAdvancedOpen((current) => !current)}
            type="button"
          >
            <span className="text-[#CBD5E1] text-[13px] font-medium">Advanced Settings</span>
            {advancedOpen ? <ChevronUp className="size-4 text-[#6C798B]" /> : <ChevronDown className="size-4 text-[#6C798B]" />}
          </button>

          {advancedOpen ? (
            <div className="space-y-2.5 border-white/6 border-t px-3.5 py-3.5">
              <div className="grid grid-cols-2 gap-2 text-[9px]">
                <button
                  className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2"
                  onClick={onPostOnlyToggle}
                  type="button"
                >
                  <span className="text-[#97A3B4]">Post Only</span>
                  <span className={cn("text-[#738095]", postOnly && "text-[#A8C4F6]")}>{postOnly ? "On" : "Off"}</span>
                </button>
                <button
                  className="flex items-center justify-between rounded-xl bg-white/[0.04] px-3 py-2"
                  onClick={onAtExpiryDeliverToggle}
                  type="button"
                >
                  <span className="text-[#97A3B4]">At Expiry Deliver</span>
                  <span className={cn("text-[#738095]", atExpiryDeliver && "text-[#A8C4F6]")}>
                    {atExpiryDeliver ? "On" : "Off"}
                  </span>
                </button>
              </div>

              <div className="rounded-2xl bg-white/[0.03] px-3 py-2 text-[#97A3B4] text-[10px]">
                {lastAction}
              </div>
            </div>
          ) : null}
        </section>

        <section className="border-white/6 border-t pt-3.5">
          <div className="space-y-3">
            <div className="text-[#6C798B] text-[10px] uppercase tracking-[0.18em]">Contract Details</div>
            <div className="grid grid-cols-2 gap-x-3 gap-y-2">
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
                className="h-8 rounded-xl bg-white/[0.04] text-[#738095] text-[9px] transition-colors"
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
