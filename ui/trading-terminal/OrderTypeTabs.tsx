"use client";

import { PanelTabs } from "@/ui/trading-terminal/PanelTabs";

/**
 * The ticket's order type selector, in the terminal's shared underlined-tab style rather than a
 * filled segmented control: the side selector directly above is already a filled two-up, and
 * stacking two of them made the order type read as a second buy/sell choice.
 */
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
    <PanelTabs
      onSelect={onSelect}
      selected={selected}
      tabs={orderTypes.map((type) => ({ id: type, label: labels?.[type] ?? type }))}
    />
  );
}
