"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import type { DeliveryTerm } from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";
import { ConfirmOrderDialog } from "@/ui/trading-terminal/ConfirmOrderDialog";
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
  isPreparingAccount = false,
  isSubmitting,
  lastAction,
  limitPrice,
  marketLabel,
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
  /** Shown only in the confirmation dialog; the ticker bar carries it for the ticket itself. */
  contractSizeLabel: string;
  /** The trading subaccount is still being resolved — distinct from an order in flight. */
  isPreparingAccount?: boolean;
  isSubmitting: boolean;
  lastAction: string | null;
  limitPrice: string;
  marketLabel: string;
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const directionLabel = isBuy ? "Long" : "Short";
  // Liquidation decides whether the position survives, so it is lifted out of the summary list.
  const liquidationRow = summaryRows.find((row) => row.label === "Liquidation Price");

  // Both states block submission, but they are not the same thing: "Submitting..." on a button the
  // user never pressed reads as a stuck order rather than a subaccount lookup still in flight.
  const isBusy = isSubmitting || isPreparingAccount;

  function getSubmitLabel() {
    if (isSubmitting) {
      return "Submitting...";
    }

    if (isPreparingAccount) {
      return "Loading account...";
    }

    return isBuy ? "Buy now" : "Sell now";
  }

  function handleConfirm() {
    setConfirmOpen(false);
    onSubmit(orderSide);
  }

  return (
    // The panel claims the column height itself so only the field list below can
    // scroll — the header and the submit footer stay in view without scrolling.
    <section className="flex flex-col overflow-clip rounded-[20px] bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 xl:min-h-0 xl:flex-1">
      {/*
       * The panel label only earns its space next to sibling panels. In the stacked
       * sub-xl layout this is the only form on screen, so the row is dropped there to
       * keep the submit button within the first screenful.
       */}
      <div className="hidden shrink-0 items-center border-panel-border border-b px-3 py-2 font-medium text-[11px] xl:flex">
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

        {/*
         * Collateral and its balance share a row, below the amount field: the
         * collateral currency is fixed, so it is reference material rather than
         * something the trader sets on each order.
         */}
        <div className="flex items-center justify-between gap-2 rounded-[12px] bg-input-bg/60 py-1.5 pr-3 pl-1.5 text-[11px]">
          <span className="flex shrink-0 items-center gap-1.5 rounded-lg bg-input-bg px-2 py-1 text-panel-text-active ring-1 ring-panel-border">
            <SmartImage<string>
              alt="USDC"
              className="size-4 animate-none rounded-full"
              src="/tokens/usdc.svg"
            />
            USDC
          </span>
          <span className="truncate font-medium text-panel-text">{availableLabel}</span>
        </div>
      </div>

      {/* The submit CTA stays pinned so the primary action is never scrolled out of reach. */}
      <div className="shrink-0 space-y-3 border-panel-border border-t bg-panel-bg-muted px-3 pt-2.5 pb-3">
        {/*
         * What the order commits and risks belongs next to the button that
         * commits to it, so these sit in the footer rather than the scrolling
         * field list. Contract size is omitted — the ticker bar already shows it.
         */}
        <div className="space-y-1 rounded-[12px] bg-input-bg/60 px-3 py-2 text-[11px]">
          {summaryRows.map((item) => (
            <div className="flex items-center justify-between gap-2" key={item.label}>
              <span className="truncate text-panel-text-muted">{item.label}</span>
              <span className="truncate text-right font-medium text-panel-text">{item.value}</span>
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
          disabled={isBusy}
          onClick={() => setConfirmOpen(true)}
          type="button"
        >
          {getSubmitLabel()}
        </button>

        <ConfirmOrderDialog
          confirmLabel={`Confirm ${directionLabel.toLowerCase()}`}
          description={`This submits a ${orderType.toLowerCase()} order for ${marketLabel}. Once filled it cannot be closed from this screen.`}
          directionLabel={directionLabel}
          highlightedRow={
            liquidationRow
              ? {
                  label: liquidationRow.label,
                  note: "The position is liquidated if the mark reaches this price.",
                  value: liquidationRow.value,
                }
              : null
          }
          isSubmitting={isSubmitting}
          onConfirm={handleConfirm}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
          orderSide={orderSide}
          sizeLabel={`${size || "0"} × ${contractSizeLabel}`}
          summaryRows={summaryRows.filter((row) => row.label !== "Liquidation Price")}
          title={`Confirm ${directionLabel.toLowerCase()} position`}
        />

        {lastAction === null ? null : (
          <p className="rounded-[12px] bg-input-bg px-3 py-2 text-[10px] text-panel-text-muted ring-1 ring-panel-border">
            {lastAction}
          </p>
        )}
      </div>
    </section>
  );
}
