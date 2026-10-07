"use client";

import { cn } from "@/lib/cn";

export type SideTone = "buy" | "sell";

export type SideOption<T extends string> = {
  label: string;
  tone: SideTone;
  value: T;
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
    <div className="grid grid-cols-2 gap-1 bg-input-bg p-0.5">
      {options.map((option) => {
        const active = option.value === selected;
        return (
          <button
            aria-pressed={active}
            className={cn(
              "h-8 cursor-pointer font-semibold text-[13px] transition-colors",
              !active && "text-panel-text-muted hover:bg-input-hover",
              active && option.tone === "buy" && "bg-bid-bg text-buy",
              active && option.tone === "sell" && "bg-ask-bg text-sell"
            )}
            key={option.value}
            onClick={() => onSelect(option.value)}
            type="button"
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
