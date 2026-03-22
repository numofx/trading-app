import { ChevronDown, Info } from "lucide-react";
import type { DeliveryTerm } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

function LabelValueRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-[11px]">
      <span className="text-[#6B7280]">{label}</span>
      <span
        className={cn(
          "font-medium text-[#D1D5DB]",
          value.startsWith("+$") && "text-[#8CC9A3]",
        )}
      >
        {value}
      </span>
    </div>
  );
}

export function TradePanel({
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
  const isLong = tradeSide === "buy";
  const needsLimitPrice = orderType !== "Market";
  const directionCopy = isLong
    ? "Buy cNGN / sell USDC"
    : "Sell cNGN / buy USDC";

  return (
    <section className="flex h-full min-h-[420px] flex-col overflow-hidden rounded-md border border-[#1B2430] bg-[#0F1720] xl:min-h-0">
      <div className="space-y-2 overflow-y-auto p-2 text-[11px]">
        <div className="space-y-1 rounded-sm border border-[#1B2430] bg-[#11161D] p-1">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.16em]">Direction</div>
          <div className="grid grid-cols-2 gap-1">
            <button
              className={cn(
                "rounded-sm border px-3 py-2.5 text-left transition-colors",
                isLong
                  ? "border-[#14532D] bg-[#123524]"
                  : "border-[#1B2430] bg-[#101820]",
              )}
              onClick={() => onSideChange("buy")}
              type="button"
            >
              <span className="block font-semibold text-[#D1FAE5] text-sm">Long cNGN</span>
              <span className="mt-0.5 block text-[#8CC9A3] text-[10px]">Buy cNGN / sell USDC</span>
            </button>
            <button
              className={cn(
                "rounded-sm border px-3 py-2.5 text-left transition-colors",
                isLong
                  ? "border-[#1B2430] bg-[#101820]"
                  : "border-[#7F1D1D] bg-[#4D1717]",
              )}
              onClick={() => onSideChange("sell")}
              type="button"
            >
              <span className="block font-semibold text-[#FDE2E2] text-sm">Short cNGN</span>
              <span className="mt-0.5 block text-[#D59C9C] text-[10px]">Sell cNGN / buy USDC</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-sm bg-[#11161D] p-1">
          {["Market", "Limit", "Stop"].map((tab) => (
            <button
              className={cn(
                "rounded-sm px-2 py-1.5 font-medium text-[11px] transition-colors",
                orderType === tab ? "bg-[#151B23] text-[#D1D5DB]" : "text-[#6B7280]",
              )}
              key={tab}
              onClick={() => onOrderTypeChange(tab as "Limit" | "Market" | "Stop")}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>

        <div className="space-y-1 rounded-sm border border-[#1B2430] bg-[#11161D] p-2">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-[#E5E7EB] text-[12px]">{contractLabel}</div>
              <div className="mt-0.5 text-[#6B7280] text-[10px]">{directionCopy}</div>
            </div>
            <div className="rounded-sm border border-[#223043] bg-[#0D131A] px-2 py-1 text-[#93C5FD] text-[10px]">
              Physically delivered
            </div>
          </div>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1 pt-1">
            {contractDetails.map((item) => (
              <LabelValueRow key={item.label} label={item.label} value={item.value} />
            ))}
          </div>
        </div>

        <div className="space-y-1.5">
          <label className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]" htmlFor="trade-size">
            Size
          </label>
          <div className="flex items-center overflow-hidden rounded-sm border border-[#1B2430] bg-[#11161D]">
            <input
              className="h-10 flex-1 bg-transparent px-3 text-[#D1D5DB] text-sm outline-none placeholder:text-[#6B7280]"
              id="trade-size"
              onChange={(event) => onSizeChange(event.target.value.replace(/[^\d]/g, ""))}
              placeholder="50,000"
              value={size}
            />
            <button
              className="flex h-10 items-center gap-1 border-[#1B2430] border-l px-3 text-[#D1D5DB] text-sm"
              type="button"
            >
              Contracts
              <ChevronDown className="size-4 text-[#6B7280]" />
            </button>
          </div>

          <div className="flex items-center gap-2">
            <input
              className="h-1.5 flex-1 accent-[#3B82F6]"
              max="100"
              min="0"
              onChange={(event) => onAllocationChange(Number(event.target.value))}
              type="range"
              value={allocation}
            />
            <div className="rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1 text-[#D1D5DB] text-[11px]">
              {allocation} %
            </div>
          </div>
        </div>

        {needsLimitPrice ? (
          <div className="space-y-1.5">
            <label className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]" htmlFor="trade-limit-price">
              {orderType === "Stop" ? "Stop Price" : "Limit Price"}
            </label>
            <div className="flex items-center overflow-hidden rounded-sm border border-[#1B2430] bg-[#11161D]">
              <input
                className="h-10 flex-1 bg-transparent px-3 text-[#D1D5DB] text-sm outline-none placeholder:text-[#6B7280]"
                id="trade-limit-price"
                onChange={(event) => onLimitPriceChange(event.target.value.replace(/[^\d.]/g, ""))}
                placeholder="1,605.25"
                value={limitPrice}
              />
              <div className="flex h-10 items-center border-[#1B2430] border-l px-3 text-[#6B7280] text-[10px] uppercase tracking-[0.12em]">
                cNGN / USDC
              </div>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-1 text-[10px]">
          <button
            className="flex items-center justify-between rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1.5"
            onClick={onPostOnlyToggle}
            type="button"
          >
            <span className="text-[#9CA3AF]">Post Only</span>
            <span className={cn("text-[#6B7280]", postOnly && "text-[#BFDBFE]")}>{postOnly ? "On" : "Off"}</span>
          </button>
          <button
            className="flex items-center justify-between rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1.5"
            onClick={onAtExpiryDeliverToggle}
            type="button"
          >
            <span className="text-[#9CA3AF]">At Expiry Deliver</span>
            <span className={cn("text-[#6B7280]", atExpiryDeliver && "text-[#BFDBFE]")}>
              {atExpiryDeliver ? "On" : "Off"}
            </span>
          </button>
        </div>

        <div className="space-y-1 rounded-sm border border-[#1B2430] bg-[#11161D] p-2">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Order Economics</div>
          <LabelValueRow label="Order Value" value={orderValue} />
          <LabelValueRow label="Initial Margin" value={initialMargin} />
          <LabelValueRow label="Fees" value={fees} />
          <LabelValueRow label="Available Buying Power" value={buyingPower} />
          <div className="flex items-center justify-between text-[11px]">
            <span className="inline-flex items-center gap-1 text-[#6B7280]">
              Slippage Estimate
              <Info className="size-3" />
            </span>
            <span className="font-medium text-[#D1D5DB]">{slippageEstimate}</span>
          </div>
          <LabelValueRow label="Estimated Fill Price" value={estimatedFillPrice} />
          <LabelValueRow label="Estimated Avg Execution" value={estimatedAverageExecution} />
          <LabelValueRow label="Liquidation Price" value={liquidationPrice} />
        </div>

        <button
          className={cn(
            "flex h-10 items-center justify-center rounded-sm border font-medium text-sm transition-colors",
            isLong
              ? "border-[#14532D] bg-[#123524] text-[#86EFAC] hover:bg-[#17412c]"
              : "border-[#7F1D1D] bg-[#4D1717] text-[#FDE2E2] hover:bg-[#5b1b1b]",
          )}
          onClick={() => onSubmit(tradeSide)}
          type="button"
        >
          {isLong ? "Long cNGN" : "Short cNGN"}
        </button>

        <div className="rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1.5 text-[#9CA3AF] text-[11px]">
          {lastAction}
        </div>

        <div className="space-y-2 rounded-sm border border-[#1B2430] bg-[#11161D] p-2">
          <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Position Summary</div>
          <div className="rounded-sm border border-[#1B2430] bg-[#0D131A] p-2">
            <div className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">Unrealized PnL</div>
            <div className="mt-1 font-semibold text-[#86EFAC] text-xl">{pnl}</div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-[#9CA3AF]">{positionValue}</span>
              <span className="font-medium text-[#86EFAC]">{returnPercent}</span>
            </div>
          </div>
          {positionOverview.map((item) => (
            <LabelValueRow key={item.label} label={item.label} value={item.value} />
          ))}
          <div className="grid grid-cols-2 gap-1 pt-1">
            {["Close Position", "Reduce 25%", "Reduce 50%", "Close All"].map((action) => (
              <button
                className="h-8 rounded-sm border border-[#1B2430] bg-[#0D131A] text-[#6B7280] text-[10px] transition-colors"
                disabled
                key={action}
                type="button"
              >
                {action}
              </button>
            ))}
          </div>
          <div className="text-[#4B5563] text-[10px]">TODO: wire position reductions to venue actions.</div>
        </div>
      </div>
    </section>
  );
}
