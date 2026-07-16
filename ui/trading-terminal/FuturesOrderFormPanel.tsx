"use client";

import { cn } from "@/lib/cn";
import type { DeliveryTerm } from "@/lib/trading.types";

type FuturesOrderType = "Limit" | "Market" | "Stop";

const ORDER_TYPES = ["Limit", "Market", "Stop"] as const satisfies readonly FuturesOrderType[];

function FormInput({
  id,
  label,
  onChange,
  placeholder,
  unit,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  unit: string;
  value: string;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-[11px] text-panel-text-muted" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center overflow-hidden rounded-[12px] bg-input-bg ring-1 ring-panel-border">
        <input
          className="h-10 min-w-0 flex-1 bg-transparent px-3 font-semibold text-[13px] text-panel-text outline-none placeholder:text-panel-text-muted"
          id={id}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
          placeholder={placeholder}
          value={value}
        />
        <div className="flex h-10 shrink-0 items-center border-panel-border border-l px-2.5 text-[10px] text-panel-text-muted">
          {unit}
        </div>
      </div>
    </div>
  );
}

export function FuturesOrderFormPanel({
  availableLabel,
  contractSizeLabel,
  isSubmitting,
  lastAction,
  limitPrice,
  onLimitPriceChange,
  onOrderTypeChange,
  onSideChange,
  onSizeChange,
  onSubmit,
  orderSide,
  orderType,
  size,
  summaryRows,
}: {
  availableLabel: string;
  contractSizeLabel: string;
  isSubmitting: boolean;
  lastAction: string;
  limitPrice: string;
  onLimitPriceChange: (value: string) => void;
  onOrderTypeChange: (orderType: FuturesOrderType) => void;
  onSideChange: (side: "buy" | "sell") => void;
  onSizeChange: (value: string) => void;
  onSubmit: (side: "buy" | "sell") => void;
  orderSide: "buy" | "sell";
  orderType: FuturesOrderType;
  size: string;
  summaryRows: DeliveryTerm[];
}) {
  const isBuy = orderSide === "buy";

  function getSubmitLabel() {
    if (isSubmitting) {
      return "Submitting...";
    }

    return isBuy ? "Buy now" : "Sell now";
  }

  return (
    <section className="flex min-h-[430px] shrink-0 flex-col overflow-hidden rounded-[20px] bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 xl:flex-1">
      <div className="flex items-center border-panel-border border-b px-3 py-2 font-medium text-[11px]">
        <span className="rounded-xl bg-input-bg px-2 py-1 text-panel-text-active">Order form</span>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        <div className="grid grid-cols-2 gap-1 rounded-[14px] bg-input-bg p-1">
          <button
            className={cn(
              "h-9 cursor-pointer rounded-[10px] font-semibold text-[12px] transition-colors",
              isBuy ? "bg-buy text-background" : "text-buy hover:bg-input-hover"
            )}
            onClick={() => onSideChange("buy")}
            type="button"
          >
            Buy | Long
          </button>
          <button
            className={cn(
              "h-9 cursor-pointer rounded-[10px] font-semibold text-[12px] transition-colors",
              isBuy ? "text-sell hover:bg-input-hover" : "bg-sell text-white"
            )}
            onClick={() => onSideChange("sell")}
            type="button"
          >
            Sell | Short
          </button>
        </div>

        <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-input-bg p-1">
          {ORDER_TYPES.map((type) => (
            <button
              className={cn(
                "h-8 cursor-pointer rounded-[10px] font-medium text-[10px] transition-colors",
                orderType === type
                  ? "bg-toolbar-active-bg text-toolbar-active-fg"
                  : "text-panel-text-muted hover:bg-input-hover"
              )}
              key={type}
              onClick={() => onOrderTypeChange(type)}
              type="button"
            >
              {type}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2 rounded-[12px] bg-input-bg/60 px-3 py-2 text-[11px]">
          <span className="text-panel-text-muted">Available (USDC)</span>
          <span className="font-medium text-panel-text">{availableLabel}</span>
        </div>

        {orderType === "Market" ? null : (
          <FormInput
            id="futures-limit-price"
            label={orderType === "Stop" ? "Stop price" : "Limit price"}
            onChange={onLimitPriceChange}
            placeholder="1,545.00"
            unit="cNGN / USDC"
            value={limitPrice}
          />
        )}

        <FormInput
          id="futures-amount"
          label="Amount"
          onChange={onSizeChange}
          placeholder="10,000"
          unit="USDC"
          value={size}
        />

        <div className="space-y-2 rounded-[12px] bg-input-bg/60 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="text-panel-text-muted">Contract size</span>
            <span className="font-medium text-panel-text">{contractSizeLabel}</span>
          </div>
          {summaryRows.map((item) => (
            <div className="flex items-center justify-between gap-2 text-[11px]" key={item.label}>
              <span className="text-panel-text-muted">{item.label}</span>
              <span className="text-right font-medium text-panel-text">{item.value}</span>
            </div>
          ))}
        </div>

        <button
          className={cn(
            "h-11 w-full cursor-pointer rounded-[14px] font-semibold text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
            isBuy
              ? "bg-buy text-background ring-1 ring-buy/50 hover:bg-buy/90"
              : "bg-sell text-white ring-1 ring-sell/50 hover:bg-sell/90"
          )}
          disabled={isSubmitting}
          onClick={() => onSubmit(orderSide)}
          type="button"
        >
          {getSubmitLabel()}
        </button>

        <p className="rounded-[12px] bg-input-bg px-3 py-2 text-[10px] text-panel-text-muted ring-1 ring-panel-border">
          {lastAction}
        </p>
      </div>
    </section>
  );
}
