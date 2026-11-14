"use client";

import { cn } from "@/lib/cn";

export type SideTone = "buy" | "sell";

export type SideOption<T extends string> = {
  label: string;
  tone: SideTone;
  value: T;
  /** What the side means in the trader's terms, shown on hover. */
  tooltip?: string;
};

/**
 * The filled two-up side selector both tickets open with: Buy/Sell on spot, Long/Short on the
 * perp. The selected segment takes its side's tint; the other reads muted until hovered.
 */
export function SideToggle<T extends string>({
  onSelect,
  options,
  selected,
}: {
  onSelect: (side: T) => void;
  options: readonly [SideOption<T>, SideOption<T>];
  selected: T;
}) {
  return (
    <div className="grid grid-cols-2 gap-1 bg-segment-bg p-1 ring-1 ring-panel-border">
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "h-9 cursor-pointer font-semibold text-[14px] transition-colors",
              !active && "text-panel-text-muted hover:text-panel-text-active",
              active && option.tone === "buy" && "bg-buy text-primary-fg",
              active && option.tone === "sell" && "bg-sell text-primary-fg"
            )}
            key={option.value}
            onClick={() => onSelect(option.value)}
            title={option.tooltip}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
