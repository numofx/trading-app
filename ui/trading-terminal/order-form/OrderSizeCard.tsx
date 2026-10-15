"use client";

import { ArrowLeftRight } from "lucide-react";
import { TOKEN_ICONS } from "@/lib/token-icons";
import { SmartImage } from "@/ui/SmartImage";
import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";
import type { TokenSymbol } from "@/ui/trading-terminal/order-form/TokenUnit";

const SLIDER_MARKS = [25, 50, 75] as const;

/**
 * The order's size in one card: the label and unit switch on the left, the typed figure and its
 * value in the other unit on the right, and under them a slider across everything the account's
 * margin can open, with MAX at its end. The slider and MAX move the size in the unit the order is
 * signed in (`baseUnit`); the switch only changes which unit the field shows. The slider is inert,
 * and visibly so, until the ticket knows that ceiling: it never slides against a number it does
 * not have.
 */
export function OrderSizeCard({
  baseUnit,
  canToggleUnit,
  formatBase,
  inputId,
  max,
  maxTitle,
  onInput,
  onSetBase,
  onToggleUnit,
  otherUnitText,
  shown,
  size,
  step,
  tooltip,
  unit,
}: {
  /** The unit the order is signed in, which the slider and MAX count. */
  baseUnit: TokenSymbol;
  canToggleUnit: boolean;
  formatBase: (value: number) => string;
  inputId: string;
  /** The most the account's margin can open, in `baseUnit`; null until the ticket knows it. */
  max: number | null;
  maxTitle: string;
  onInput: (value: string) => void;
  onSetBase: (value: number) => void;
  onToggleUnit: () => void;
  otherUnitText: string;
  shown: string;
  /** The current size in `baseUnit`. */
  size: number | null;
  step: number;
  tooltip: string;
  /** The unit the field shows. */
  unit: TokenSymbol;
}) {
  const other = unit === baseUnit ? null : baseUnit;
  const sliderDisabled = max === null || max <= 0;
  const sliderMax = sliderDisabled ? 1 : max;
  // Without a ceiling the track stays empty: a typed size has nothing to be a share of.
  const sliderValue = sliderDisabled ? 0 : Math.min(size ?? 0, sliderMax);
  const fillPercent = (sliderValue / sliderMax) * 100;
  return (
    <div className="space-y-2 border border-panel-border px-3 py-2 focus-within:border-panel-text-muted">
      <div className="flex items-start justify-between gap-3">
        <div className="flex shrink-0 flex-col items-start gap-2 pt-0.5">
          <FieldLabel htmlFor={inputId} tooltip={tooltip}>
            Order Size
          </FieldLabel>
          <button
            aria-label={`Size in ${unit}; switch to ${other ?? "the other unit"}`}
            className="flex cursor-pointer items-center gap-1.5 border border-panel-border bg-input-bg px-2 py-1 font-semibold text-[12px] text-panel-text-active transition-colors hover:bg-input-hover disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!canToggleUnit}
            onClick={onToggleUnit}
            title={
              canToggleUnit
                ? undefined
                : "Needs a price: type a limit price, or wait for the market"
            }
            type="button"
          >
            <SmartImage<string>
              alt=""
              className="size-4 animate-none rounded-full"
              src={TOKEN_ICONS[unit]}
            />
            {unit}
            <ArrowLeftRight aria-hidden className="size-3 text-panel-text-muted" />
          </button>
        </div>
        <div className="flex min-w-0 flex-1 flex-col items-end">
          <input
            className="w-full bg-transparent text-right font-semibold text-[22px] text-panel-text-active tabular-nums outline-none placeholder:text-panel-text-muted"
            id={inputId}
            inputMode="decimal"
            onChange={(event) => onInput(event.target.value.replace(/[^\d.,]/g, ""))}
            placeholder="0"
            value={shown}
          />
          <span className="text-[12px] text-panel-text-muted tabular-nums">{otherUnitText}</span>
        </div>
      </div>
      <div className="flex items-center gap-3">
        <div className="relative flex min-w-0 flex-1 items-center">
          {SLIDER_MARKS.map((mark) => (
            <span
              aria-hidden
              className="pointer-events-none absolute size-1.5 -translate-x-1/2 rounded-full bg-panel-text-muted/50"
              key={mark}
              style={{ left: `${mark}%` }}
            />
          ))}
          <input
            aria-label="Order size slider"
            aria-valuetext={`${formatBase(sliderValue)} ${baseUnit}`}
            className="relative h-1 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-40 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-panel-text-active [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-panel-text-active"
            disabled={sliderDisabled}
            max={sliderMax}
            min={0}
            onChange={(event) => onSetBase(Number(event.target.value))}
            step={step}
            style={{
              background: `linear-gradient(to right, var(--buy) ${fillPercent}%, var(--input-hover) ${fillPercent}%)`,
            }}
            type="range"
            value={sliderValue}
          />
        </div>
        <button
          className="shrink-0 cursor-pointer border border-panel-border bg-input-bg px-2.5 py-1 font-semibold text-[11px] text-panel-text-active transition-colors hover:bg-input-hover disabled:cursor-not-allowed disabled:opacity-40"
          disabled={sliderDisabled}
          onClick={() => max !== null && onSetBase(max)}
          title={maxTitle}
          type="button"
        >
          MAX
        </button>
      </div>
    </div>
  );
}
