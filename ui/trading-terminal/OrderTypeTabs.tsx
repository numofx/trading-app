"use client";

import { cn } from "@/lib/cn";

export const FUTURES_ORDER_TYPES = ["Limit", "Market", "Stop"] as const;

/** The futures "Stop" order executes as a stop-limit, so it shares the spot form's display label. */
export const FUTURES_ORDER_TYPE_LABELS = {
  Stop: "Stop Limit",
} satisfies Partial<Record<(typeof FUTURES_ORDER_TYPES)[number], string>>;

/** Bounded pill-tab order type selector shared by the spot and futures order forms. */
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
