"use client";

import { useState } from "react";
import type { OptionOverviewRow } from "@/lib/option-chain";
import { formatPremium, optionUnitBase } from "@/lib/option-chain";
import type { OptionSide } from "@/lib/option-order";
import {
  estimateOptionOrder,
  OPTION_DEFAULT_SLIPPAGE,
  optionBreakeven,
  optionLimitError,
  optionMarketLimit,
  optionOrderUnits,
  optionTouch,
  optionTradingBlock,
} from "@/lib/option-order";
import { ConfirmOrderDialog } from "@/ui/trading-terminal/ConfirmOrderDialog";
import { OrderTypeTabs } from "@/ui/trading-terminal/OrderTypeTabs";
import { FormField } from "@/ui/trading-terminal/order-form/FormField";
import { OrderFormShell } from "@/ui/trading-terminal/order-form/OrderFormShell";
import { OrderSizeCard } from "@/ui/trading-terminal/order-form/OrderSizeCard";
import { SideToggle } from "@/ui/trading-terminal/order-form/SideToggle";
import { SlippageRow } from "@/ui/trading-terminal/order-form/SlippageRow";
import { SubmitButton } from "@/ui/trading-terminal/order-form/SubmitButton";
import { SummaryRow } from "@/ui/trading-terminal/order-form/SummaryRow";
import type { TokenSymbol } from "@/ui/trading-terminal/order-form/TokenUnit";

const ORDER_TYPES = ["Market", "Limit"] as const;
export type OptionOrderType = (typeof ORDER_TYPES)[number];

export type OptionOrderRequest = {
  orderType: OptionOrderType;
  /** The limit the order is signed at, premium in USDC per base unit. */
  price: number;
  side: OptionSide;
  /** Whole venue units. */
  units: number;
};

const SIDES = [
  { label: "Buy", tone: "buy", tooltip: "Pay the premium and hold the option", value: "buy" },
  {
    label: "Sell",
    tone: "sell",
    tooltip: "Sell an option you hold. Writing a new option isn't offered here",
    value: "sell",
  },
] as const;

const SIZE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const USD = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4, minimumFractionDigits: 2 });

function formatUsdc(value: number | null) {
  return value === null || !Number.isFinite(value) ? "—" : `${USD.format(value)} USDC`;
}

function formatHolding(size: number, symbol: string) {
  return Math.abs(size) < 1e-9 ? "Flat" : `${SIZE.format(size)} ${symbol}`;
}

function parseNumber(value: string) {
  const parsed = Number(value.replaceAll(",", "").trim());
  return value.trim() !== "" && Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type ButtonState = { enabled: boolean; label: string; tone: "buy" | "sell" | "neutral" };

function resolveButton(inputs: {
  block: string | null;
  error: string | null;
  hasAccount: boolean;
  hasWallet: boolean;
  isAccepted: boolean;
  isFilled: boolean;
  isPreparingAccount: boolean;
  isSubmitting: boolean;
  ready: boolean;
  shortfall: number;
  side: OptionSide;
  sizeLabel: string | null;
}): ButtonState {
  const neutral = (label: string, enabled: boolean): ButtonState => ({
    enabled,
    label,
    tone: "neutral",
  });
  if (inputs.block !== null) {
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
  if (inputs.shortfall > 0) {
    return neutral("Deposit USDC", true);
  }
  const verb = inputs.side === "buy" ? "Buy" : "Sell";
  return {
    enabled: inputs.ready && inputs.error === null,
    label: inputs.sizeLabel === null ? verb : `${verb} ${inputs.sizeLabel}`,
    tone: inputs.side,
  };
}

type TicketInputs = {
  cash: number | null;
  limitInput: string;
  maxSlippage: number;
  nowMs: number;
  orderType: OptionOrderType;
  position: number;
  restingSells: number;
  row: OptionOverviewRow;
  side: OptionSide;
  sizeInput: string;
  surplus: number | null;
};

/** What the ticket's inputs come to: the order's figures, and what is wrong with it. */
function deriveTicket(inputs: TicketInputs) {
  const { maxSlippage, orderType, row, side } = inputs;
  const base = (row.baseSymbol || "cNGN") as TokenSymbol;
  const unitBase = optionUnitBase(row.amountScale ?? undefined);
  const isLimit = orderType === "Limit";
  const typedLimit = parseNumber(inputs.limitInput);
  const size = parseNumber(inputs.sizeInput);
  const units = size === null ? null : optionOrderUnits(size, unitBase);
  const touch = optionTouch(row, side);
  const estimate = estimateOptionOrder({
    cash: inputs.cash,
    position: inputs.position,
    // What the order is expected to trade at.
    price: isLimit ? typedLimit : touch,
    restingSells: inputs.restingSells,
    side,
    size: units === null ? null : size,
    surplus: inputs.surplus,
    takerFeeBps: row.takerFeeBps,
    unitBase,
  });
  const expected = isLimit ? typedLimit : touch;
  const depth = side === "buy" ? row.askSize : row.bidSize;
  return {
    base,
    block: optionTradingBlock(row, inputs.nowMs),
    depthNote:
      !isLimit && size !== null && depth !== null && size > depth
        ? `${SIZE.format(depth)} ${base} rests at the touch. The rest fills further through it, up to your slippage, or lapses in 2 minutes.`
        : null,
    error: ticketError({
      base,
      estimate,
      isLimit,
      row,
      side,
      size,
      touch,
      typedLimit,
      units,
      unitBase,
    }),
    estimate,
    expected,
    signedLimit: isLimit ? typedLimit : optionMarketLimit(row, side, maxSlippage),
    size,
    unitBase,
    units,
  };
}

function ticketError(inputs: {
  base: string;
  estimate: ReturnType<typeof estimateOptionOrder>;
  isLimit: boolean;
  row: OptionOverviewRow;
  side: OptionSide;
  size: number | null;
  touch: number | null;
  typedLimit: number | null;
  unitBase: number | null;
  units: number | null;
}) {
  const { base, estimate, isLimit, side, size, touch, unitBase, units } = inputs;
  if (isLimit) {
    const limitError = optionLimitError(inputs.row, inputs.typedLimit);
    if (limitError !== null) {
      return limitError;
    }
  } else if (touch === null) {
    return `Nothing resting on the ${side === "buy" ? "ask" : "bid"}. Use a limit order.`;
  }
  if (estimate.oversold) {
    return `You can sell at most ${SIZE.format(estimate.closable)} ${base}: what you hold, less what already rests to sell it. Writing a new option isn't offered here.`;
  }
  return size !== null && units === null
    ? `Sizes come in steps of ${SIZE.format(unitBase ?? 1)} ${base}.`
    : null;
}

type Ticket = ReturnType<typeof deriveTicket>;

function breakevenText(row: OptionOverviewRow, price: number | null) {
  return price === null ? "—" : formatPremium(optionBreakeven(row, price));
}

/** The confirm popup's rows: the contract and price, what it costs, and the position it leaves. */
function confirmRows(
  ticket: Ticket,
  orderType: OptionOrderType,
  row: OptionOverviewRow,
  side: OptionSide
) {
  const { base, estimate, expected, signedLimit } = ticket;
  const isLimit = orderType === "Limit";
  return [
    { label: "Contract", value: row.symbol },
    { label: isLimit ? "Limit price" : "Expected price", value: formatPremium(expected) },
    ...(isLimit ? [] : [{ label: "Worst price", value: formatPremium(signedLimit) }]),
    { label: "Premium", value: formatUsdc(estimate.premium) },
    { label: isLimit ? "Fee if it crosses" : "Fee", value: formatUsdc(estimate.fee) },
    ...(side === "buy"
      ? [
          { label: "Max loss", value: formatUsdc(estimate.total) },
          { label: "Breakeven", value: breakevenText(row, expected) },
        ]
      : []),
    { label: "Position after", value: formatHolding(estimate.positionAfter, base) },
  ];
}

function TicketSummary({
  maxSlippage,
  onMaxSlippageChange,
  orderType,
  position,
  row,
  side,
  ticket,
}: {
  maxSlippage: number;
  onMaxSlippageChange: (max: number) => void;
  orderType: OptionOrderType;
  position: number;
  row: OptionOverviewRow;
  side: OptionSide;
  ticket: Ticket;
}) {
  const { base, estimate, expected } = ticket;
  return (
    <div className="space-y-1">
      {orderType === "Market" ? (
        <SlippageRow estimate={null} max={maxSlippage} onMaxChange={onMaxSlippageChange} />
      ) : null}
      <SummaryRow
        label={orderType === "Limit" ? "Limit price" : "Expected price"}
        value={formatPremium(expected)}
      />
      <SummaryRow label="Premium" value={formatUsdc(estimate.premium)} />
      <SummaryRow
        label="Fees"
        tooltip={`${row.takerFeeBps ?? "—"} bps of the premium when the order crosses. Resting and being filled costs nothing.`}
        value={formatUsdc(estimate.fee)}
      />
      {side === "buy" ? (
        <>
          <SummaryRow
            label="Max loss"
            tooltip="The premium and fee: what you pay, and the most a bought option can lose."
            value={formatUsdc(estimate.total)}
          />
          <SummaryRow
            label="Breakeven"
            tooltip="The settlement price at expiry where the option returns its premium, fees aside. USDC per cNGN."
            value={breakevenText(row, expected)}
          />
        </>
      ) : null}
      <SummaryRow label="Position" value={formatHolding(position, base)} />
    </div>
  );
}

function ContractRows({
  onDepositRequest,
  row,
  surplus,
}: {
  onDepositRequest: () => void;
  row: OptionOverviewRow;
  surplus: number | null;
}) {
  return (
    <>
      <div className="flex items-center justify-between gap-2 px-0.5 text-[12px]">
        <span className="text-[11px] text-panel-text-muted">Contract</span>
        <span className="truncate font-medium text-panel-text-active tabular-nums">
          {row.symbol}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2 px-0.5 text-[12px]">
        <span
          className="cursor-help text-[11px] text-panel-text-muted"
          title="The account's initial margin surplus: what a new order can draw on."
        >
          Available margin
        </span>
        <span className="flex items-center gap-2 tabular-nums">
          <span className="text-panel-text">{formatUsdc(surplus)}</span>
          <button
            className="cursor-pointer font-medium text-[11px] text-accent-text hover:underline"
            onClick={onDepositRequest}
            type="button"
          >
            Deposit
          </button>
        </span>
      </div>
    </>
  );
}

/**
 * The option ticket. The contract comes from the chain: clicking an ask opens a buy of it, a bid a sell. Premium is
 * in USDC per cNGN and size in cNGN, in whole venue units. A sell can only close what the account holds: the venue
 * takes no reduce-only order on an option, so this ticket is what stops an oversized sell from writing one. Keyed by
 * the contract by its parent, so a limit typed for one strike never carries to another.
 */
export function OptionOrderFormPanel({
  cash,
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
  onSideChange,
  onSubmit,
  position,
  restingSells,
  row,
  side,
  surplus,
}: {
  cash: number | null;
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
  onSideChange: (side: OptionSide) => void;
  onSubmit: (request: OptionOrderRequest) => void;
  /** Held in this contract, signed, in base units. */
  position: number;
  /** Unfilled resting sells of this contract, in base units. */
  restingSells: number;
  row: OptionOverviewRow;
  side: OptionSide;
  surplus: number | null;
}) {
  const [orderType, setOrderType] = useState<OptionOrderType>("Market");
  const [limitInput, setLimitInput] = useState("");
  const [sizeInput, setSizeInput] = useState("");
  const [maxSlippage, setMaxSlippage] = useState(OPTION_DEFAULT_SLIPPAGE);
  const [pending, setPending] = useState<OptionOrderRequest | null>(null);

  const ticket = deriveTicket({
    cash,
    limitInput,
    maxSlippage,
    nowMs,
    orderType,
    position,
    restingSells,
    row,
    side,
    sizeInput,
    surplus,
  });
  const { base, block, depthNote, error, estimate, signedLimit, size, unitBase, units } = ticket;
  const sizeLabel = units === null || size === null ? null : `${SIZE.format(size)} ${base}`;

  const button = resolveButton({
    block,
    error,
    hasAccount,
    hasWallet,
    isAccepted,
    isFilled,
    isPreparingAccount,
    isSubmitting,
    ready: units !== null && signedLimit !== null && cash !== null,
    shortfall: estimate.shortfall,
    side,
    sizeLabel,
  });

  function edited<T>(set: (value: T) => void) {
    return (value: T) => {
      onEdit();
      set(value);
    };
  }

  function handleSubmit() {
    if (!hasWallet) {
      onConnect();
      return;
    }
    if (!hasAccount || estimate.shortfall > 0) {
      onDepositRequest();
      return;
    }
    if (units !== null && signedLimit !== null && error === null) {
      setPending({ orderType, price: signedLimit, side, units });
    }
  }

  const statusText = block ?? lastAction ?? depthNote;

  return (
    <OrderFormShell
      footer={
        <>
          <TicketSummary
            maxSlippage={maxSlippage}
            onMaxSlippageChange={edited(setMaxSlippage)}
            orderType={orderType}
            position={position}
            row={row}
            side={side}
            ticket={ticket}
          />

          <SubmitButton
            busy={isSubmitting}
            disabled={!button.enabled}
            id="option-submit-cta"
            onClick={handleSubmit}
            tone={button.tone}
          >
            {button.label}
          </SubmitButton>

          <ConfirmOrderDialog
            confirmLabel={`Confirm ${side}`}
            directionLabel={side === "buy" ? "Buy" : "Sell"}
            isSubmitting={isSubmitting}
            onConfirm={() => {
              if (pending !== null) {
                onSubmit(pending);
              }
              setPending(null);
            }}
            onOpenChange={(open) => {
              if (!open) {
                setPending(null);
              }
            }}
            open={pending !== null}
            orderSide={side}
            sizeLabel={sizeLabel ?? "—"}
            summaryRows={confirmRows(ticket, orderType, row, side)}
            title={`Confirm ${side}`}
          />

          {statusText === null ? null : (
            <p className="text-[11px] text-panel-text-muted leading-snug">{statusText}</p>
          )}
        </>
      }
    >
      <SideToggle onSelect={edited(onSideChange)} options={SIDES} selected={side} />
      <OrderTypeTabs
        onSelect={edited(setOrderType)}
        orderTypes={ORDER_TYPES}
        selected={orderType}
      />
      <div className="space-y-2 pt-1 pb-0.5">
        <ContractRows onDepositRequest={onDepositRequest} row={row} surplus={surplus} />

        {orderType === "Limit" ? (
          <FormField
            adornment={<span className="font-medium text-[12px] text-panel-text">USDC</span>}
            id="option-limit-price"
            label="Limit price"
            onChange={edited(setLimitInput)}
            placeholder="0.00000000"
            tooltip={`The premium in USDC per ${base}. A resting order runs until it fills, you cancel it, or last trade.`}
            value={limitInput}
          />
        ) : null}

        <OrderSizeCard
          baseUnit={base}
          canToggleUnit={false}
          formatBase={(value) => SIZE.format(value)}
          inputId="option-order-size"
          max={estimate.maxSize}
          maxTitle={
            side === "buy"
              ? "The most your cash and margin can buy at this price"
              : "The most you can sell: what you hold, less what already rests to sell it"
          }
          onInput={edited(setSizeInput)}
          onSetBase={edited((value: number) => setSizeInput(value > 0 ? String(value) : ""))}
          onToggleUnit={() => undefined}
          otherUnitText={formatUsdc(estimate.premium ?? 0)}
          shown={sizeInput}
          size={size}
          step={unitBase ?? 1}
          tooltip={`The size in ${base}, in steps of ${SIZE.format(unitBase ?? 1)}.`}
          unit={base}
        />
        {error === null ? null : (
          <p className="text-[11px] text-ask-text leading-snug" role="alert">
            {error}
          </p>
        )}
      </div>
    </OrderFormShell>
  );
}
