"use client";

import { cn } from "@/lib/cn";

/** Bounded pill-tab order type selector for the order form. */
export function OrderTypeTabs<T extends string>({
  labels,
  onSelect,
  orderTypes,
  selected,
}: {
  /** Display-label overrides keyed by order type value; the value itself renders otherwise. */
  labels?: Partial<Record<T, string>>;
  onSelect: (orderType: T) => void;
  orderTypes: readonly T[];
  selected: T;
}) {
  return (
    // Underlined text tabs rather than a filled segmented control: the side selector directly above
    // is already a filled two-up, and stacking two of them made the order type read as a second
    // buy/sell choice.
    <div className="flex items-center gap-4 border-panel-border border-b">
      {orderTypes.map((type) => (
        <button
          className={cn(
            "-mb-px cursor-pointer border-b-2 pb-1.5 font-medium text-[12px] transition-colors",
            selected === type
              ? "border-panel-text-active text-panel-text-active"
              : "border-transparent text-panel-text-muted hover:text-panel-text"
          )}
          key={type}
          onClick={() => onSelect(type)}
          type="button"
        >
          {labels?.[type] ?? type}
        </button>
      ))}
    </div>
  );
}
