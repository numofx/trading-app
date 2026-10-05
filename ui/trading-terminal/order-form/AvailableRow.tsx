"use client";

import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";

/**
 * What an order can draw on, with the deposit that is the remedy when it is not enough. The label
 * carries any explanation of where the figure comes from as a tooltip, so the row stays one line.
 */
export function AvailableRow({
  depositLabel,
  label,
  onDeposit,
  tooltip,
  value,
}: {
  /** The deposit button's accessible name, e.g. "Deposit USDC". */
  depositLabel: string;
  label: string;
  onDeposit?: () => void;
  tooltip?: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <FieldLabel tooltip={tooltip}>{label}</FieldLabel>
      <span className="flex min-w-0 items-center gap-1.5">
        <span className="truncate font-medium text-panel-text tabular-nums">{value}</span>
        <button
          aria-label={depositLabel}
          className="flex size-4 cursor-pointer items-center justify-center rounded-full bg-input-bg text-[12px] text-panel-text-muted leading-none ring-1 ring-panel-border transition-colors hover:text-panel-text-active"
          onClick={onDeposit}
          type="button"
        >
          +
        </button>
      </span>
    </div>
  );
}
