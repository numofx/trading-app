"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/cn";

export type SliderPreset = {
  label: string;
  value: number;
};

/**
 * A filled range slider with a row of presets beneath it, all driving one number: a share of the
 * available balance on spot, the leverage on the perp. Inert, and visibly so, when `disabled`:
 * the ticket never slides against a ceiling it does not know.
 *
 * The fill is a gradient stop at the thumb, since a range input has no styleable progress part
 * in WebKit.
 */
export function AmountSlider({
  disabled = false,
  header,
  label,
  max,
  min,
  onChange,
  presets,
  step,
  value,
  valueText,
}: {
  disabled?: boolean;
  /** An optional row above the track: the perp puts its label and typed leverage here. */
  header?: ReactNode;
  /** The slider's accessible name. */
  label: string;
  max: number;
  min: number;
  onChange: (value: number) => void;
  presets: readonly SliderPreset[];
  step: number;
  value: number;
  valueText?: string;
}) {
  const fillPercent = max > min ? ((value - min) / (max - min)) * 100 : 0;
  return (
    <div className="space-y-1.5">
      {header}
      <input
        aria-label={label}
        aria-valuetext={valueText}
        className="h-1 w-full cursor-pointer appearance-none rounded-full disabled:cursor-not-allowed disabled:opacity-40 [&::-moz-range-thumb]:size-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-panel-text-active [&::-webkit-slider-thumb]:size-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-panel-text-active"
        disabled={disabled}
        max={max}
        min={min}
        onChange={(event) => onChange(Number(event.target.value))}
        step={step}
        style={{
          background: `linear-gradient(to right, var(--buy) ${fillPercent}%, var(--input-hover) ${fillPercent}%)`,
        }}
        type="range"
        value={value}
      />
      <div
        className="grid gap-1.5"
        style={{ gridTemplateColumns: `repeat(${presets.length}, minmax(0, 1fr))` }}
      >
        {presets.map((preset) => (
          <button
            aria-pressed={preset.value === value}
            className={cn(
              "h-5 cursor-pointer bg-input-bg text-[11px] tabular-nums transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              preset.value === value
                ? "bg-panel-bg-darker text-panel-text-active"
                : "text-panel-text-muted hover:text-panel-text"
            )}
            disabled={disabled}
            key={preset.value}
            onClick={() => onChange(preset.value)}
            type="button"
          >
            {preset.label}
          </button>
        ))}
      </div>
    </div>
  );
}
