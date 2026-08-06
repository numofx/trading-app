"use client";

import { cn } from "@/lib/cn";
import type { DeliveryTerm } from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";
import {
  FUTURES_ORDER_TYPE_LABELS,
  FUTURES_ORDER_TYPES,
  OrderTypeTabs,
} from "@/ui/trading-terminal/OrderTypeTabs";

type FuturesOrderType = "Limit" | "Market" | "Stop";

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
    // The panel claims the column height itself so only the field list below can
    // scroll — the header and the submit footer stay in view without scrolling.
    <section className="flex flex-col overflow-clip rounded-[20px] bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0 xl:flex-1">
      <div className="flex shrink-0 items-center border-panel-border border-b px-3 py-2 font-medium text-[11px]">
        <span className="rounded-xl bg-input-bg px-2 py-1 text-panel-text-active">Order form</span>
      </div>

      <div className="space-y-3 p-3 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
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

        <OrderTypeTabs
          labels={FUTURES_ORDER_TYPE_LABELS}
          onSelect={onOrderTypeChange}
          orderTypes={FUTURES_ORDER_TYPES}
          selected={orderType}
        />

        <div className="flex items-center justify-between gap-2">
          <span className="text-[11px] text-panel-text-muted">Collateral</span>
          <span className="flex items-center gap-1.5 rounded-lg bg-input-bg px-2 py-1 text-[11px] text-panel-text-active ring-1 ring-panel-border">
            <SmartImage<string> alt="USDC" className="size-4 animate-none rounded-full" src="/tokens/usdc.svg" />
            USDC
          </span>
        </div>

        <div className="flex items-center justify-between gap-2 rounded-[12px] bg-input-bg/60 px-3 py-2 text-[11px]">
          <span className="text-panel-text-muted">Available</span>
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
          placeholder="1"
          unit="contracts"
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
      </div>

      {/* The submit CTA stays pinned so the primary action is never scrolled out of reach. */}
      <div className="shrink-0 space-y-3 border-panel-border border-t bg-panel-bg-muted px-3 pt-2.5 pb-3">
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
