"use client";

import { useState } from "react";
import {
  estimateFutureOrder,
  formatFuturePrice,
  futureNotionalUsdc,
  futureOrderUiSide,
  futureOrderUnits,
  futureTradingBlock,
  isOutsideFillBand,
  maxFutureNotional,
  toContracts,
} from "@/lib/future-market";
import type { FutureAccount, FutureSide, FutureState } from "@/lib/future-market.types";
import { PERP_DEFAULT_MAX_SLIPPAGE } from "@/lib/perp-market";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";
import { FormField } from "@/ui/trading-terminal/order-form/FormField";
import { OrderFormShell } from "@/ui/trading-terminal/order-form/OrderFormShell";
import { SideToggle } from "@/ui/trading-terminal/order-form/SideToggle";
import { SlippageRow } from "@/ui/trading-terminal/order-form/SlippageRow";
import { SubmitButton } from "@/ui/trading-terminal/order-form/SubmitButton";
import { SummaryRow } from "@/ui/trading-terminal/order-form/SummaryRow";

const ORDER_TYPES = ["Market", "Limit"] as const;

type FutureOrderType = (typeof ORDER_TYPES)[number];

const SIDES = [
  { label: "Long", tone: "buy", value: "long" },
  { label: "Short", tone: "sell", value: "short" },
] as const;

export type FutureOrderRequest = {
  side: FutureSide;
  orderType: FutureOrderType;
  /** cNGN per USDC; the limit for a limit order, ignored for a market order (priced off the touch). */
  limitPrice: string;
  /** The size in the venue's whole units, `unitUsdc` of notional each. */
  units: number;
  /** How far through the touch a market order is signed, as a fraction. */
  maxSlippage: number;
};

const USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });

function formatUsd(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${USD.format(value)} USDC`;
}

function parsePrice(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

const SIZE_PATTERN = /^\d+(\.\d+)?$/;

/** The typed size, USDC of notional, or null unless it is a positive decimal. */
function parseNotional(value: string) {
  const trimmed = value.replaceAll(",", "").trim();
  if (!SIZE_PATTERN.test(trimmed)) {
    return null;
  }
  const parsed = Number(trimmed);
  return parsed > 0 ? parsed : null;
}

const SIZE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

/** A signed notional as the position it is: "Long 10 USDC", "Flat". */
function formatPosition(notional: number) {
  if (Math.abs(notional) < 1e-9) {
    return "Flat";
  }
  return `${notional > 0 ? "Long" : "Short"} ${SIZE.format(Math.abs(notional))} USDC`;
}

/** Why the ticket's price cannot be signed, or null when it can. */
function describePriceProblem(inputs: {
  band: FutureState["fillBand"];
  hasState: boolean;
  orderType: FutureOrderType;
  touch: number | null;
  typedLimit: number | null;
}): string | null {
  if (inputs.hasState && inputs.band === null) {
    return "The venue cannot read the fill band right now; orders resume when it can.";
  }
  if (inputs.orderType === "Market") {
    return inputs.touch === null ? "No resting liquidity on that side. Use a limit order." : null;
  }
  if (inputs.typedLimit === null) {
    return "Enter a limit price in cNGN per USDC.";
  }
  return isOutsideFillBand(inputs.typedLimit, inputs.band)
    ? "Outside the fill band: the venue refuses a limit beyond it."
    : null;
}

/**
 * Everything the ticket shows that follows from its fields and the market: whether the series
 * takes orders, the size, the price it would trade at and what is wrong with it, and the margin.
 */
function deriveTicket(inputs: {
  account: FutureAccount | null;
  bestAsk: number | null;
  bestBid: number | null;
  limitPrice: string;
  nowMs: number;
  orderType: FutureOrderType;
  referencePrice: number | null;
  side: FutureSide;
  size: string;
  state: FutureState | null;
  takerFeeBps: number | null;
}) {
  const { account, orderType, side, state, takerFeeBps } = inputs;
  const notional = parseNotional(inputs.size);
  const units = state === null || notional === null ? null : futureOrderUnits(notional, state);
  const typedLimit = parsePrice(inputs.limitPrice);
  const touch = side === "long" ? inputs.bestAsk : inputs.bestBid;
  const priceError = describePriceProblem({
    band: state?.fillBand ?? null,
    hasState: state !== null,
    orderType,
    touch,
    typedLimit,
  });
  return {
    block:
      state === null
        ? "The future isn't listed on the venue right now."
        : futureTradingBlock(state, inputs.nowMs),
    estimate:
      state === null || notional === null || units === null
        ? null
        : estimateFutureOrder({ account, notional, side, state, takerFeeBps }),
    expectedPrice: orderType === "Limit" ? typedLimit : (touch ?? inputs.referencePrice),
    maxNotional: state === null ? 0 : maxFutureNotional({ account, side, state, takerFeeBps }),
    notional,
    position:
      account === null || state === null
        ? 0
        : futureNotionalUsdc(toContracts(account.positionUnits), state),
    priceError,
    // An empty limit field is not yet an error worth a line; the disabled button says enough.
    shownPriceError: orderType === "Limit" && inputs.limitPrice === "" ? null : priceError,
    units,
  };
}

/** The figures under the ticket: price, notional, margin, slippage, fees and the position after. */
function TicketSummary({
  contractSize,
  estimate,
  expectedPrice,
  hasAccount,
  maxSlippage,
  onMaxSlippageChange,
  orderType,
  position,
  takerFeeBps,
}: {
  contractSize: number;
  estimate: ReturnType<typeof estimateFutureOrder> | null;
  expectedPrice: number | null;
  hasAccount: boolean;
  maxSlippage: number;
  onMaxSlippageChange: (max: number) => void;
  orderType: FutureOrderType;
  position: number;
  takerFeeBps: number | null;
}) {
  const shortfall = estimate?.shortfall ?? 0;
  return (
    <>
      <div className="space-y-0.5">
        <SummaryRow
          label="Expected Price"
          tooltip={
            orderType === "Limit"
              ? "A limit order trades at its limit or better"
              : "The touch a market order crosses, cNGN per USDC"
          }
          value={formatFuturePrice(expectedPrice)}
        />
        <SummaryRow
          label="Notional"
          tooltip={`The size in USDC, whatever the price: one contract is ${USD.format(contractSize)} USDC`}
          value={formatUsd(estimate?.notional ?? null)}
        />
        <SummaryRow
          label="Initial Margin"
          tooltip="What the order adds to the position, at the engine's initial margin rate. Reducing a position needs none."
          value={formatUsd(estimate?.initialMargin ?? null)}
        />
        {orderType === "Limit" ? null : (
          <SlippageRow estimate={null} max={maxSlippage} onMaxChange={onMaxSlippageChange} />
        )}
        <SummaryRow
          label="Fees"
          tooltip="The venue's taker fee on the notional, in USDC. A resting limit that is hit pays none."
          value={
            takerFeeBps === null
              ? "—"
              : `${formatUsd(estimate?.fee ?? null)} (${takerFeeBps / 100}%)`
          }
        />
        <SummaryRow label="Position After" value={formatPosition(estimate?.after ?? position)} />
      </div>

      {shortfall > 0 && hasAccount ? (
        <p className="text-[11px] text-panel-text-muted leading-snug">
          Needs {USD.format(shortfall)} USDC more margin than the account has free.
        </p>
      ) : null}
    </>
  );
}

type ButtonState = { enabled: boolean; label: string; tone: "buy" | "sell" | "neutral" };

function resolveButton(inputs: {
  account: FutureAccount | null;
  blocked: boolean;
  notional: number | null;
  hasAccount: boolean;
  hasWallet: boolean;
  isAccepted: boolean;
  isFilled: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  priceError: string | null;
  shortfall: number | null;
  side: FutureSide;
}): ButtonState {
  const neutral = (label: string, enabled: boolean): ButtonState => ({
    enabled,
    label,
    tone: "neutral",
  });
  if (inputs.blocked) {
    return neutral("Trading closed", false);
  }
  if (!inputs.hasWallet) {
    return neutral("Connect wallet", true);
  }
  if (inputs.isPreparingAccount) {
    return neutral("Loading account…", false);
  }
  if (!inputs.hasAccount) {
    return neutral("Deposit to open your account", true);
  }
  if (inputs.isSubmitting) {
    return neutral("Submitting…", false);
  }
  if (inputs.isAccepted) {
    return neutral("Accepted", false);
  }
  if (inputs.isFilled) {
    return neutral("Filled", false);
  }
  if (inputs.shortfall !== null && inputs.shortfall > 0) {
    return neutral("Deposit margin", true);
  }
  const verb = inputs.side === "long" ? "Long" : "Short";
  const label = inputs.notional === null ? verb : `${verb} ${SIZE.format(inputs.notional)} USDC`;
  return {
    enabled: inputs.notional !== null && inputs.priceError === null && inputs.account !== null,
    label,
    tone: futureOrderUiSide(inputs.side),
  };
}

/**
 * The future's order ticket. Size is USDC of notional, in whole venue units (1 USDC; a contract is
 * 1,000), and the price is cNGN per USDC: a long gains as cNGN weakens, a short as it strengthens. Every order must sit inside the
 * fill band around the index, which the ticket checks before signing. The engine margins the whole
 * account at its initial rate on what an order adds to the position; reducing one is
 * always allowed. Without a live series (`state` null) the form renders but cannot submit.
 */
export function FutureOrderFormPanel({
  account,
  bestAsk,
  bestBid,
  hasAccount,
  hasWallet,
  isAccepted,
  isFilled,
  isPreparingAccount,
  isSubmitting,
  lastAction,
  nowMs,
  onConnect,
  onDepositRequest,
  onEdit,
  onSubmit,
  referencePrice,
  state,
  takerFeeBps,
}: {
  account: FutureAccount | null;
  bestAsk: number | null;
  bestBid: number | null;
  /** The wallet has its trading account under the MarginEngine. */
  hasAccount: boolean;
  hasWallet: boolean;
  isAccepted: boolean;
  isFilled: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  lastAction: string | null;
  nowMs: number;
  onConnect: () => void;
  onDepositRequest: () => void;
  onEdit: () => void;
  onSubmit?: (request: FutureOrderRequest) => void;
  /** The price a market order fills near, cNGN per USDC: the touch, else the mark. */
  referencePrice: number | null;
  state: FutureState | null;
  takerFeeBps: number | null;
}) {
  const [side, setSide] = useState<FutureSide>("long");
  const [orderType, setOrderType] = useState<FutureOrderType>("Market");
  const [limitPrice, setLimitPrice] = useState("");
  const [size, setSize] = useState("");
  const [maxSlippage, setMaxSlippage] = useState(PERP_DEFAULT_MAX_SLIPPAGE);

  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      onEdit();
      set(value);
    };
  }

  const {
    block,
    estimate,
    expectedPrice,
    maxNotional,
    notional,
    position,
    priceError,
    shownPriceError,
    units,
  } = deriveTicket({
    account,
    bestAsk,
    bestBid,
    limitPrice,
    nowMs,
    orderType,
    referencePrice,
    side,
    size,
    state,
    takerFeeBps,
  });

  const button = resolveButton({
    account,
    blocked: block !== null || onSubmit === undefined,
    notional: units === null ? null : notional,
    hasAccount,
    hasWallet,
    isAccepted,
    isFilled,
    isPreparingAccount,
    isSubmitting,
    priceError,
    shortfall: estimate?.shortfall ?? null,
    side,
  });

  function handleSubmit() {
    if (!hasWallet) {
      onConnect();
      return;
    }
    if (!hasAccount || (estimate?.shortfall ?? 0) > 0) {
      onDepositRequest();
      return;
    }
    if (onSubmit === undefined || units === null || priceError !== null) {
      return;
    }
    onSubmit({ limitPrice, maxSlippage, orderType, side, units });
  }

  const statusText = block ?? lastAction ?? shownPriceError;
  const band = state?.fillBand ?? null;
  const contractSize = state?.contractSizeUsdc ?? 1000;
  const unitUsdc = state?.unitUsdc ?? 1;

  return (
    <OrderFormShell
      footer={
        <>
          <TicketSummary
            contractSize={contractSize}
            estimate={estimate}
            expectedPrice={expectedPrice}
            hasAccount={hasAccount}
            maxSlippage={maxSlippage}
            onMaxSlippageChange={edited(setMaxSlippage)}
            orderType={orderType}
            position={position}
            takerFeeBps={takerFeeBps}
          />

          <SubmitButton
            busy={isSubmitting}
            disabled={!button.enabled}
            id="future-submit-cta"
            onClick={handleSubmit}
            tone={button.tone}
          >
            {button.label}
          </SubmitButton>

          {statusText === null ? null : (
            <p className="text-[11px] text-panel-text-muted leading-snug">{statusText}</p>
          )}
        </>
      }
    >
      <SideToggle onSelect={edited(setSide)} options={SIDES} selected={side} />
      <p className="px-0.5 text-[11px] text-panel-text-muted leading-snug">
        {side === "long"
          ? "Long gains if cNGN weakens (more cNGN per USDC)."
          : "Short gains if cNGN strengthens (fewer cNGN per USDC)."}
      </p>

      <OrderTypeTabs
        onSelect={edited(setOrderType)}
        orderTypes={ORDER_TYPES}
        selected={orderType}
      />

      <div className="space-y-2 pt-1 pb-0.5">
        <div className="flex items-center justify-between gap-2 px-0.5 text-[12px]">
          <span
            className="cursor-help text-[11px] text-panel-text-muted"
            title="The account's initial margin surplus, across spot holdings and futures positions: what new positions can draw on. Profit and loss arrive as variation margin at each hourly mark."
          >
            Available margin
          </span>
          <span className="flex items-center gap-2 tabular-nums">
            <span className="text-panel-text">
              {formatUsd(account?.initialMarginSurplus ?? null)}
            </span>
            <button
              className="cursor-pointer font-medium text-[11px] text-accent-text hover:underline"
              onClick={onDepositRequest}
              type="button"
            >
              Deposit
            </button>
          </span>
        </div>

        {orderType === "Limit" ? (
          <div className="space-y-1">
            <FormField
              adornment={<span className="font-medium text-[12px] text-panel-text">cNGN</span>}
              id="future-limit-price"
              label="Limit price"
              onChange={edited(setLimitPrice)}
              placeholder="0.00"
              tooltip="cNGN per USDC"
              value={limitPrice}
            />
            <p className="text-[11px] text-panel-text-muted tabular-nums">
              {band === null
                ? "Fill band unavailable"
                : `Fill band ${formatFuturePrice(band.low)} – ${formatFuturePrice(band.high)}`}
            </p>
          </div>
        ) : null}

        <div className="space-y-1">
          <FormField
            adornment={
              <span className="flex items-center gap-2">
                <span className="font-medium text-[12px] text-panel-text">USDC</span>
                <button
                  className="cursor-pointer font-medium text-[11px] text-accent-text hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={maxNotional < unitUsdc}
                  onClick={() => edited(setSize)(String(maxNotional))}
                  type="button"
                >
                  MAX
                </button>
              </span>
            }
            id="future-size"
            label="Size"
            onChange={edited(setSize)}
            placeholder="0"
            tooltip={`USDC of notional, in steps of ${SIZE.format(unitUsdc)} USDC. One contract is ${USD.format(contractSize)} USDC.`}
            value={size}
          />
          <p className="text-[11px] text-panel-text-muted tabular-nums">
            {units === null && size !== ""
              ? `Whole steps of ${SIZE.format(unitUsdc)} USDC, at least ${SIZE.format(unitUsdc)}.`
              : `Up to ${SIZE.format(maxNotional)} USDC on this side`}
          </p>
        </div>
      </div>
    </OrderFormShell>
  );
}
