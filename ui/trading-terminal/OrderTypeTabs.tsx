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
    <div className="grid grid-cols-3 gap-1 rounded-[14px] bg-input-bg p-1">
      {orderTypes.map((type) => (
        <button
          className={cn(
            "h-8 cursor-pointer rounded-[10px] font-medium text-[10px] transition-colors",
            selected === type
              ? "bg-toolbar-active-bg text-toolbar-active-fg"
              : "text-panel-text-muted hover:bg-input-hover"
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
