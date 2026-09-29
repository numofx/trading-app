"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { PERP_LEVERAGE_PRESETS, PERP_MAX_LEVERAGE } from "@/lib/perp-terminal-config";
import { SmartImage } from "@/ui/SmartImage";

type PerpSide = "long" | "short";

const ORDER_TYPES = ["Market", "Limit"] as const;

type PerpOrderType = (typeof ORDER_TYPES)[number];

function parseAmount(value: string) {
  const parsed = Number(value.replaceAll(",", ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** A derived amount as the input shows it: at most two decimals, no trailing zeros. */
function formatDerived(value: number) {
  return String(Number(value.toFixed(2)));
}

function PerpSideTabs({ onSelect, side }: { onSelect: (side: PerpSide) => void; side: PerpSide }) {
  const isLong = side === "long";

  return (
    <div className="grid grid-cols-2 gap-1 rounded-sm bg-input-bg p-0.5">
      <button
        className={cn(
          "h-8 cursor-pointer rounded-sm font-semibold text-[12px] transition-colors",
          isLong
            ? "bg-bid-bg text-buy ring-1 ring-buy/40"
            : "text-panel-text-muted hover:bg-input-hover"
        )}
        onClick={() => onSelect("long")}
        type="button"
      >
        Long
      </button>
      <button
        className={cn(
          "h-8 cursor-pointer rounded-sm font-semibold text-[12px] transition-colors",
          isLong
            ? "text-panel-text-muted hover:bg-input-hover"
            : "bg-ask-bg text-sell ring-1 ring-sell/40"
        )}
        onClick={() => onSelect("short")}
        type="button"
      >
        Short
      </button>
    </div>
  );
}

/** A segmented control in a bordered well, the selected type filled. */
function PerpOrderTypeTabs({
  onSelect,
  selected,
}: {
  onSelect: (orderType: PerpOrderType) => void;
  selected: PerpOrderType;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-sm p-1 ring-1 ring-panel-border">
      {ORDER_TYPES.map((type) => (
        <button
          aria-pressed={type === selected}
          className={cn(
            "h-8 cursor-pointer rounded-sm font-semibold text-[12px] transition-colors",
            type === selected
              ? "bg-input-hover text-panel-text-active"
              : "text-panel-text-muted hover:text-panel-text"
          )}
          key={type}
          onClick={() => onSelect(type)}
          type="button"
        >
          {type}
        </button>
      ))}
    </div>
  );
}

/** A token mark and ticker, set beside the input it denominates. */
function TokenUnit({ icon, symbol }: { icon: string; symbol: string }) {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-semibold text-[13px] text-panel-text-active">
      <SmartImage<string> alt={symbol} className="size-5 animate-none rounded-full" src={icon} />
      {symbol}
    </span>
  );
}

/** One section of the ticket's grouped card: a label over a large numeric input and its unit. */
function PerpCardField({
  id,
  label,
  onChange,
  unit,
  value,
}: {
  id: string;
  label: string;
  onChange: (value: string) => void;
  unit: ReactNode;
  value: string;
}) {
  return (
    <div className="space-y-1.5 px-3 py-2.5">
      <label className="block text-[11px] text-panel-text-muted" htmlFor={id}>
        {label}
      </label>
      <div className="flex items-center justify-between gap-2">
        <input
          className="min-w-0 flex-1 bg-transparent font-mono text-[16px] text-panel-text-active outline-none placeholder:text-panel-text-muted/60"
          id={id}
          inputMode="decimal"
          onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
          placeholder="0.0"
          value={value}
        />
        {unit}
      </div>
    </div>
  );
}

/**
 * Leverage as a typed value, a filled slider and presets, all driving one number. A typed value
 * applies as soon as it is a whole number in range; blurring drops any draft that is not.
 */
function LeverageSelector({
  leverage,
  onSelect,
}: {
  leverage: number;
  onSelect: (leverage: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const fillPercent = ((leverage - 1) / (PERP_MAX_LEVERAGE - 1)) * 100;

  function handleDraftChange(value: string) {
    const digits = value.replace(/\D/g, "");
    setDraft(digits);
    const parsed = Number(digits);
    if (digits !== "" && parsed >= 1 && parsed <= PERP_MAX_LEVERAGE) {
      onSelect(parsed);
    }
  }

  function selectFromControl(value: number) {
    setDraft(null);
    onSelect(value);
  }

  return (
    <div className="space-y-2.5 px-3 py-2.5">
      <div className="flex items-center justify-between gap-2">
        <label className="text-[11px] text-panel-text-muted" htmlFor="perp-leverage-value">
          Leverage
        </label>
        <span className="flex items-baseline font-mono font-semibold text-[16px] text-panel-text-active">
          <input
            className="w-8 bg-transparent text-right outline-none"
            id="perp-leverage-value"
            inputMode="numeric"
            onBlur={() => setDraft(null)}
            onChange={(event) => handleDraftChange(event.target.value)}
            value={draft ?? String(leverage)}
          />
          x
        </span>
      </div>
      {/* The fill is a gradient stop at the thumb, since a range input has no styleable progress part in WebKit. */}
      <input
        aria-label="Leverage slider"
        aria-valuetext={`${leverage}x`}
        className="h-1.5 w-full cursor-pointer appearance-none rounded-full [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-panel-text-active [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-panel-text-active"
        id="perp-leverage"
        max={PERP_MAX_LEVERAGE}
        min={1}
        onChange={(event) => selectFromControl(Number(event.target.value))}
        step={1}
        style={{
          background: `linear-gradient(to right, var(--buy) ${fillPercent}%, var(--input-hover) ${fillPercent}%)`,
        }}
        type="range"
        value={leverage}
      />
      <div className="grid grid-cols-5 gap-1.5">
        {PERP_LEVERAGE_PRESETS.map((option) => (
          <button
            aria-pressed={option === leverage}
            className={cn(
              "h-7 cursor-pointer rounded-sm bg-input-bg font-mono text-[11px] transition-colors",
              option === leverage
                ? "text-panel-text-active"
                : "text-panel-text-muted hover:text-panel-text"
            )}
            key={option}
            onClick={() => selectFromControl(option)}
            type="button"
          >
            {option}x
          </button>
        ))}
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-panel-text-muted">{label}</span>
      <span className="truncate text-panel-text">{value}</span>
    </div>
  );
}

/**
 * The perp order ticket. Every field works so the ticket can be read and filled in, but it cannot
 * submit: markets-service serves no perp market, so there is no order spec to sign against, no perp
 * account to report available collateral from, and no mark, funding rate or margin config to
 * quote. Those read `—` rather than an estimate.
 *
 * Margin and size are linked through leverage (size = margin × leverage), and either can be typed:
 * editing one rewrites the other, and moving leverage keeps the margin and resizes the position.
 */
export function PerpOrderFormPanel() {
  const [side, setSide] = useState<PerpSide>("long");
  const [orderType, setOrderType] = useState<PerpOrderType>("Market");
  const [limitPrice, setLimitPrice] = useState("");
  const [margin, setMargin] = useState("");
  const [size, setSize] = useState("");
  const [leverage, setLeverage] = useState(1);

  const isLong = side === "long";

  function handleMarginChange(value: string) {
    setMargin(value);
    const parsed = parseAmount(value);
    setSize(parsed === null ? "" : formatDerived(parsed * leverage));
  }

  function handleSizeChange(value: string) {
    setSize(value);
    const parsed = parseAmount(value);
    setMargin(parsed === null ? "" : formatDerived(parsed / leverage));
  }

  function handleLeverageChange(next: number) {
    setLeverage(next);
    const parsed = parseAmount(margin);
    if (parsed !== null) {
      setSize(formatDerived(parsed * next));
    }
  }

  return (
    <section className="flex flex-col overflow-clip bg-panel-bg-muted ring-1 ring-panel-ring transition-colors duration-300 md:min-h-fit md:flex-1">
      <div className="hidden shrink-0 items-center border-panel-border border-b px-3 py-1.5 font-medium text-[11px] md:flex">
        <span className="rounded-sm bg-input-bg px-2 py-0.5 text-panel-text-active">
          Order form
        </span>
      </div>

      <div className="space-y-2.5 px-3 py-2 md:min-h-0 md:flex-1">
        <PerpSideTabs onSelect={setSide} side={side} />

        <PerpOrderTypeTabs onSelect={setOrderType} selected={orderType} />

        <div className="flex items-center justify-between gap-2 text-[11px]">
          <span
            className="cursor-help text-panel-text-muted underline decoration-dotted underline-offset-4"
            title="Collateral in your perp account that can open new positions"
          >
            Available to trade
          </span>
          <span className="font-mono text-panel-text">— USDC</span>
        </div>

        <div className="divide-y divide-panel-border rounded-sm bg-input-bg ring-1 ring-panel-border">
          {orderType === "Limit" ? (
            <PerpCardField
              id="perp-limit-price"
              label="Limit price"
              onChange={setLimitPrice}
              unit={<TokenUnit icon="/tokens/cngn.svg" symbol="cNGN" />}
              value={limitPrice}
            />
          ) : null}
          <PerpCardField
            id="perp-margin"
            label="Margin"
            onChange={handleMarginChange}
            unit={<TokenUnit icon="/tokens/usdc.svg" symbol="USDC" />}
            value={margin}
          />
          <PerpCardField
            id="perp-size"
            label="Estimated size"
            onChange={handleSizeChange}
            unit={<TokenUnit icon="/tokens/usdc.svg" symbol="USDC" />}
            value={size}
          />
          <LeverageSelector leverage={leverage} onSelect={handleLeverageChange} />
        </div>
      </div>

      <div className="shrink-0 space-y-2 border-panel-border border-t bg-panel-bg-muted px-3 pt-1.5 pb-2 md:sticky md:bottom-0 md:z-10">
        <div className="space-y-1 text-[11px]">
          <SummaryRow label="Est. liquidation price" value="—" />
          <SummaryRow label="Funding rate" value="—" />
          <SummaryRow label="Fee" value="—" />
        </div>

        <button
          className="h-10 w-full cursor-not-allowed rounded-sm bg-input-bg font-semibold text-[13px] text-panel-text-muted ring-1 ring-panel-border"
          disabled
          id="perp-submit-cta"
          type="button"
        >
          {isLong ? "Long" : "Short"} USDC-cNGN-PERP
        </button>

        <p className="text-[10px] text-panel-text-muted leading-snug">
          Perp trading isn't live yet. Orders open when the market launches.
        </p>
      </div>
    </section>
  );
}
