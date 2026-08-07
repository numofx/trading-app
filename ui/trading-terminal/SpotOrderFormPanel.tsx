"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import { SPOT_TAKER_FEE_RATE } from "@/lib/spot-order-submission";
import { SmartImage } from "@/ui/SmartImage";
import { ConfirmOrderDialog } from "@/ui/trading-terminal/ConfirmOrderDialog";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";

type SpotOrderType = "Limit" | "Market" | "Stop Limit";
type PayCurrency = "cNGN" | "USDC";

const ORDER_TYPES = ["Limit", "Market", "Stop Limit"] as const satisfies readonly SpotOrderType[];
const PAY_CURRENCY_ICONS = {
  cNGN: "/tokens/cngn.svg",
  USDC: "/tokens/usdc.svg",
} satisfies Record<PayCurrency, string>;

/** 5 bps taker tier as basis points, derived from the engine-bound rate so the two stay in sync. */
const SPOT_TAKER_FEE_BPS = Number(SPOT_TAKER_FEE_RATE) * 10_000;

/** Market orders execute at the mark; everything else executes at the entered limit price. */
function resolveOrderPrice({
  limitPrice,
  markPrice,
  orderType,
}: {
  limitPrice: string;
  markPrice: number | null;
  orderType: SpotOrderType;
}) {
  if (orderType !== "Market") {
    return limitPrice;
  }

  return markPrice === null ? "" : String(markPrice);
}

function parseAmount(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

/**
 * Copy and rows for the submit confirmation. Lives outside the component so its branching does
 * not count against the panel's cognitive complexity budget.
 */
function buildSpotConfirmation({
  amount,
  isBuy,
  orderType,
  takerFeeLabel,
  totalLabel,
}: {
  amount: string;
  isBuy: boolean;
  orderType: SpotOrderType;
  takerFeeLabel: string;
  totalLabel: string;
}) {
  const action = isBuy ? "buy" : "sell";

  return {
    confirmLabel: `Confirm ${action}`,
    description: `This submits a ${orderType.toLowerCase()} order for USDC/cNGN. Once filled it cannot be reversed from this screen.`,
    directionLabel: isBuy ? "Buy USDC" : "Sell USDC",
    sizeLabel: `${amount || "0"} USDC`,
    title: `Confirm ${action}`,
    // The pay-with currency is deliberately omitted: it reads as "paying with" on a buy but the
    // trader receives that currency on a sell, and a confirmation should not assert either.
    summaryRows: [
      { label: isBuy ? "You pay" : "You receive", value: totalLabel },
      { label: `Taker fee (${SPOT_TAKER_FEE_BPS} bps)`, value: takerFeeLabel },
    ],
  };
}

/** Taker fee is charged on the USDC notional (the order Amount), matching the signed worstFee bound. */
function formatSpotFee(usdc: number) {
  return `${usdc.toLocaleString("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 })} USDC`;
}

function FormInput({
  id,
  label,
  onChange,
  placeholder,
  readOnly,
  unit,
  value,
}: {
  id: string;
  label: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  readOnly?: boolean;
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
          className={cn(
            "h-10 min-w-0 flex-1 bg-transparent px-3 font-semibold text-[13px] text-panel-text outline-none placeholder:text-panel-text-muted",
            readOnly && "text-panel-text-muted"
          )}
          id={id}
          inputMode="decimal"
          onChange={(event) => onChange?.(event.target.value.replace(/[^\d.,]/g, ""))}
          placeholder={placeholder}
          readOnly={readOnly}
          value={value}
        />
        <div className="flex h-10 shrink-0 items-center border-panel-border border-l px-2.5 text-[10px] text-panel-text-muted">
          {unit}
        </div>
      </div>
    </div>
  );
}

export function SpotOrderFormPanel({
  availableCngnLabel,
  availableUsdcLabel,
  markPrice,
  onSubmitOrder,
  isSubmitting = false,
  lastAction = null,
}: {
  availableCngnLabel: string;
  availableUsdcLabel: string;
  markPrice: number | null;
  onSubmitOrder?: (args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: SpotOrderType;
  }) => void;
  isSubmitting?: boolean;
  lastAction?: string | null;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<SpotOrderType>("Limit");
  const [payWith, setPayWith] = useState<PayCurrency>("cNGN");
  const [payWithOpen, setPayWithOpen] = useState(false);
  const [limitPrice, setLimitPrice] = useState(
    markPrice === null ? "" : String(markPrice.toFixed(2))
  );
  const [stopPrice, setStopPrice] = useState("");
  const [amount, setAmount] = useState("100");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const isBuy = side === "buy";
  const needsLimitPrice = orderType !== "Market";
  const effectivePrice = orderType === "Market" ? markPrice : parseAmount(limitPrice);
  const parsedAmount = parseAmount(amount);
  const total =
    effectivePrice !== null && Number.isFinite(effectivePrice) && Number.isFinite(parsedAmount)
      ? parsedAmount * effectivePrice
      : null;
  const availableLabel = payWith === "USDC" ? availableUsdcLabel : availableCngnLabel;
  const takerFee = Number.isFinite(parsedAmount) ? parsedAmount * Number(SPOT_TAKER_FEE_RATE) : 0;
  const totalLabel = total === null ? "—" : `${formatNaira(total, 0).replace("₦", "")} cNGN`;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const confirmation = buildSpotConfirmation({
    amount,
    isBuy,
    orderType,
    takerFeeLabel: formatSpotFee(takerFee),
    totalLabel,
  });

  /**
   * Preview mode submits nothing, so it keeps the direct path — a confirmation step for a no-op
   * would be friction without a decision behind it. Live submission goes through the dialog.
   */
  function handleSubmit() {
    if (!onSubmitOrder) {
      setStatusMessage(
        `${isBuy ? "Buy" : "Sell"} ${amount || "0"} USDC (${orderType}) previewed. Order execution is not enabled yet.`
      );
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    setConfirmOpen(false);
    if (!onSubmitOrder) {
      return;
    }
    setStatusMessage(null);
    onSubmitOrder({
      orderType,
      price: resolveOrderPrice({ limitPrice, markPrice, orderType }),
      side,
      size: amount,
    });
  }

  const statusText = lastAction ?? statusMessage;
  const sideLabel = isBuy ? "Buy USDC" : "Sell USDC";
  const submitLabel = isSubmitting ? "Submitting…" : sideLabel;

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
            onClick={() => setSide("buy")}
            type="button"
          >
            Buy
          </button>
          <button
            className={cn(
              "h-9 cursor-pointer rounded-[10px] font-semibold text-[12px] transition-colors",
              isBuy ? "text-sell hover:bg-input-hover" : "bg-sell text-white"
            )}
            onClick={() => setSide("sell")}
            type="button"
          >
            Sell
          </button>
        </div>

        <OrderTypeTabs onSelect={setOrderType} orderTypes={ORDER_TYPES} selected={orderType} />

        {orderType === "Stop Limit" ? (
          <FormInput
            id="spot-stop-price"
            label="Stop price"
            onChange={setStopPrice}
            placeholder="1,600.00"
            unit="cNGN / USDC"
            value={stopPrice}
          />
        ) : null}

        {needsLimitPrice ? (
          <FormInput
            id="spot-limit-price"
            label="Limit price"
            onChange={setLimitPrice}
            placeholder="1,600.00"
            unit="cNGN / USDC"
            value={limitPrice}
          />
        ) : null}

        <FormInput
          id="spot-amount"
          label="Amount"
          onChange={setAmount}
          placeholder="100"
          unit="USDC"
          value={amount}
        />

        {/*
         * Funding source and its balance are one thought — `availableLabel` is
         * the balance of whichever currency is selected here — so they share a
         * row. It sits below the amount fields because the trader picks a
         * funding currency once, but types an amount on every order.
         */}
        <div className="flex items-center justify-between gap-2 rounded-[12px] bg-input-bg/60 py-1.5 pr-1.5 pl-3 text-[11px]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-panel-text-muted">Pay with</span>
            <Popover.Root onOpenChange={setPayWithOpen} open={payWithOpen}>
              <Popover.Trigger
                className="flex cursor-pointer items-center gap-1.5 rounded-lg bg-input-bg px-2 py-1 text-panel-text-active ring-1 ring-panel-border transition-colors hover:bg-input-hover"
                id="spot-pay-with-trigger"
              >
                <SmartImage<string>
                  alt={payWith}
                  className="size-4 animate-none rounded-full"
                  src={PAY_CURRENCY_ICONS[payWith]}
                />
                {payWith}
                <ChevronDown
                  className={cn(
                    "size-3 text-panel-text-muted transition-transform",
                    payWithOpen && "rotate-180"
                  )}
                />
              </Popover.Trigger>
              <Popover.Portal>
                <Popover.Positioner align="start" sideOffset={6}>
                  <Popover.Popup className="z-50 min-w-[140px] overflow-hidden rounded-xl border border-panel-border bg-panel-bg-darker p-1 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
                    {(["cNGN", "USDC"] as const).map((currency) => (
                      <button
                        className={cn(
                          "flex w-full cursor-pointer items-center gap-2 rounded-lg p-2 text-left text-[11px] transition-colors hover:bg-input-hover",
                          payWith === currency ? "text-panel-text-active" : "text-panel-text"
                        )}
                        key={currency}
                        onClick={() => {
                          setPayWith(currency);
                          setPayWithOpen(false);
                        }}
                        type="button"
                      >
                        <SmartImage<string>
                          alt={currency}
                          className="size-4 animate-none rounded-full"
                          src={PAY_CURRENCY_ICONS[currency]}
                        />
                        {currency}
                      </button>
                    ))}
                  </Popover.Popup>
                </Popover.Positioner>
              </Popover.Portal>
            </Popover.Root>
          </span>

          <span className="truncate font-medium text-panel-text">{availableLabel}</span>
        </div>
      </div>

      {/* Fees and the submit CTA stay pinned so the primary action is never scrolled out of reach. */}
      <div className="shrink-0 space-y-3 border-panel-border border-t bg-panel-bg-muted px-3 pt-2.5 pb-3">
        {/*
         * Total lives here rather than in the scrolling field list: it is
         * read-only output, and what the order costs belongs next to the fees
         * and the button that commits to it.
         */}
        <div className="rounded-[12px] bg-input-bg/60 px-3 py-2 text-[11px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-panel-text-muted">Total</span>
            <span className="truncate font-semibold text-[13px] text-panel-text-active">
              {totalLabel}
            </span>
          </div>

          <div className="mt-2 space-y-1.5 border-panel-border border-t pt-2">
            <div className="flex items-center justify-between gap-2">
              <span className="text-panel-text-muted">Taker fee ({SPOT_TAKER_FEE_BPS} bps)</span>
              <span className="font-medium text-panel-text">{formatSpotFee(takerFee)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-panel-text-muted">Maker fee</span>
              <span className="font-semibold text-panel-text-active">Free</span>
            </div>
          </div>
        </div>

        <button
          className={cn(
            "h-11 w-full cursor-pointer rounded-[14px] font-semibold text-[13px] transition-colors",
            isBuy
              ? "bg-buy text-background ring-1 ring-buy/50 hover:bg-buy/90"
              : "bg-sell text-white ring-1 ring-sell/50 hover:bg-sell/90",
            isSubmitting && "cursor-wait opacity-70"
          )}
          disabled={isSubmitting}
          onClick={handleSubmit}
          type="button"
        >
          {submitLabel}
        </button>

        <ConfirmOrderDialog
          {...confirmation}
          isSubmitting={isSubmitting}
          onConfirm={handleConfirm}
          onOpenChange={setConfirmOpen}
          open={confirmOpen}
          orderSide={side}
        />

        {statusText !== null ? (
          <p className="rounded-[12px] bg-input-bg px-3 py-2 text-[10px] text-panel-text-muted ring-1 ring-panel-border">
            {statusText}
          </p>
        ) : null}
      </div>
    </section>
  );
}
