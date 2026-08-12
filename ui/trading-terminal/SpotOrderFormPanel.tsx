"use client";

import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import { getCrossingPrice } from "@/lib/spot-market";
import { SPOT_TAKER_FEE_RATE } from "@/lib/spot-order-submission";
import { SmartImage } from "@/ui/SmartImage";
import { ConfirmOrderDialog } from "@/ui/trading-terminal/ConfirmOrderDialog";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";

/*
 * No "Stop Limit". The signed envelope this ticket produces is a plain limit action — it carries
 * a limit price, size, side, fee bound, nonce and expiry, and the `Matching` contract has no
 * trigger field to hang a stop on. The tab used to be offered anyway: the stop price was collected
 * into state that nothing read, so submitting sent an ordinary limit order at the limit price and
 * discarded the stop. A trader setting downside protection got a resting order instead.
 */
type SpotOrderType = "Limit" | "Market";
type PayCurrency = "cNGN" | "USDC";

const ORDER_TYPES = ["Limit", "Market"] as const satisfies readonly SpotOrderType[];
const PAY_CURRENCY_ICONS = {
  cNGN: "/tokens/cngn.svg",
  USDC: "/tokens/usdc.svg",
} satisfies Record<PayCurrency, string>;

/** 5 bps taker tier as basis points, derived from the engine-bound rate so the two stay in sync. */
const SPOT_TAKER_FEE_BPS = Number(SPOT_TAKER_FEE_RATE) * 10_000;

/**
 * Market orders cross the opposing touch; everything else executes at the entered limit price.
 *
 * This previously sent the last traded price, which on a quiet market is days old and can rest
 * past the touch — a "market" order priced behind the book does not cross, so it silently rests
 * as a limit instead of filling.
 */
function resolveOrderPrice({
  crossingPrice,
  limitPrice,
  orderType,
}: {
  crossingPrice: number | null;
  limitPrice: string;
  orderType: SpotOrderType;
}) {
  if (orderType !== "Market") {
    return limitPrice;
  }

  return crossingPrice === null ? "" : String(crossingPrice);
}

function parseAmount(value: string) {
  // An empty field is "not entered", not zero: `Number("")` is 0, which rendered a total of
  // "0 cNGN" for an order with no price rather than leaving the row blank.
  if (value.trim() === "") {
    return Number.NaN;
  }

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

/**
 * Resolves the CTA label. The wallet comes first — without one there is nothing to submit or
 * prepare, and submission rejects on the same condition. After that an in-flight order wins over
 * account preparation: once a submission starts, that is the more specific thing to wait on.
 */
function getSpotSubmitLabel({
  hasWallet,
  isPreparingAccount,
  isSubmitting,
  sideLabel,
}: {
  hasWallet: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  sideLabel: string;
}) {
  if (!hasWallet) {
    return "Deposit";
  }
  if (isSubmitting) {
    return "Submitting…";
  }
  if (isPreparingAccount) {
    return "Loading account…";
  }
  return sideLabel;
}

export function SpotOrderFormPanel({
  anchorPrice,
  availableCngnLabel,
  availableUsdcLabel,
  bestAsk,
  bestBid,
  onDepositRequest,
  onSubmitOrder,
  isPreparingAccount = false,
  hasWallet = false,
  isSubmitting = false,
  lastAction = null,
}: {
  /** Mid of the displayed book — seeds the limit price, and cannot cross on either side. */
  anchorPrice: number | null;
  availableCngnLabel: string;
  availableUsdcLabel: string;
  /** The touch as displayed in the ladder, so the ticket quotes the book on screen. */
  bestAsk: number | null;
  bestBid: number | null;
  /** Opens the deposit dialog — what the CTA does before a wallet is connected. */
  onDepositRequest?: () => void;
  onSubmitOrder: (args: {
    side: "buy" | "sell";
    price: string;
    size: string;
    orderType: SpotOrderType;
  }) => void;
  /** The trading subaccount is still being resolved — distinct from an order in flight. */
  isPreparingAccount?: boolean;
  /**
   * Whether a wallet is connected. This, not a Privy session, is what order submission and the
   * deposit flow require, so the CTA points at funding whenever it is false.
   */
  hasWallet?: boolean;
  isSubmitting?: boolean;
  lastAction?: string | null;
}) {
  const [side, setSide] = useState<"buy" | "sell">("buy");
  const [orderType, setOrderType] = useState<SpotOrderType>("Limit");
  // Seeded from the mid, not the last trade: a prefill past the touch turns the trader's chosen
  // "Limit" into a taker on submit — an immediate fill at the 5 bps tier instead of resting free.
  const [limitPrice, setLimitPrice] = useState(
    anchorPrice === null ? "" : String(anchorPrice.toFixed(2))
  );
  const [amount, setAmount] = useState("100");

  const isBuy = side === "buy";
  const needsLimitPrice = orderType !== "Market";
  const crossingPrice = getCrossingPrice(side, bestAsk, bestBid);
  // A market order costs what it crosses at, so the total quotes the touch rather than a price
  // the order will never trade at.
  const effectivePrice = orderType === "Market" ? crossingPrice : parseAmount(limitPrice);
  const parsedAmount = parseAmount(amount);
  const total =
    effectivePrice !== null && Number.isFinite(effectivePrice) && Number.isFinite(parsedAmount)
      ? parsedAmount * effectivePrice
      : null;
  /*
   * Not a choice. This market has two legs and the side fixes which one leaves the trader's hands:
   * a UI BUY acquires USDC and pays cNGN, a UI SELL disposes of USDC. The dropdown that used to sit
   * here let either currency be picked and changed nothing but this label — the signed envelope was
   * identical either way — so it offered a decision the venue does not have.
   */
  const spendCurrency: PayCurrency = isBuy ? "cNGN" : "USDC";
  const availableLabel = spendCurrency === "USDC" ? availableUsdcLabel : availableCngnLabel;
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

  function handleSubmit() {
    // Without a wallet there is nothing to submit against, so the CTA funds an account instead.
    if (!hasWallet) {
      onDepositRequest?.();
      return;
    }
    setConfirmOpen(true);
  }

  function handleConfirm() {
    setConfirmOpen(false);
    onSubmitOrder({
      orderType,
      price: resolveOrderPrice({ crossingPrice, limitPrice, orderType }),
      side,
      size: amount,
    });
  }

  const statusText = lastAction;
  const sideLabel = isBuy ? "Buy USDC" : "Sell USDC";
  // Both states block submission, but they are not the same thing: "Submitting…" on a button the
  // user never pressed reads as a stuck order rather than a subaccount lookup still in flight.
  const isBusy = isSubmitting || isPreparingAccount;
  const submitLabel = getSpotSubmitLabel({
    hasWallet,
    isPreparingAccount,
    isSubmitting,
    sideLabel,
  });

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

        {needsLimitPrice ? (
          <FormInput
            id="spot-limit-price"
            label="Limit price"
            onChange={setLimitPrice}
            placeholder="0.00"
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
         * Funding currency and its balance are one thought — `availableLabel` is the balance of
         * whichever currency this side spends — so they share a row.
         */}
        <div className="flex items-center justify-between gap-2 rounded-[12px] bg-input-bg/60 px-3 py-1.5 text-[11px]">
          <span className="flex min-w-0 items-center gap-2">
            <span className="shrink-0 text-panel-text-muted">Pay with</span>
            <span className="flex items-center gap-1.5 font-medium text-panel-text-active">
              <SmartImage<string>
                alt={spendCurrency}
                className="size-4 animate-none rounded-full"
                src={PAY_CURRENCY_ICONS[spendCurrency]}
              />
              {spendCurrency}
            </span>
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            {/* "Wallet", because the Account strip below shows the same tokens for the trading
                subaccount. Deposited collateral leaves this at 0 while the account is funded. */}
            <span className="shrink-0 text-panel-text-muted">Wallet</span>
            <span className="truncate font-medium text-panel-text">{availableLabel}</span>
          </span>
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
            isBusy && "cursor-wait opacity-70"
          )}
          disabled={isBusy}
          // Stable hook for the layout invariant check: the label changes with wallet and
          // submission state ("Deposit", "Submitting…", "Buy USDC"), so text is not an identifier.
          id="spot-submit-cta"
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
