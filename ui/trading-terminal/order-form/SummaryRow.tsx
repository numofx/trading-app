"use client";

import { cn } from "@/lib/cn";
import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";

/** One `label — value` line of the cost summary above the submit button. */
export function SummaryRow({
  emphasis = false,
  label,
  tooltip,
  value,
}: {
  /** The one figure the summary leads with, set a step larger. */
  emphasis?: boolean;
  label: string;
  tooltip?: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 border-panel-border border-b py-1.5 text-[12px] last:border-b-0">
      <FieldLabel className="text-[12px] text-panel-text" tooltip={tooltip}>
        {label}
      </FieldLabel>
      <span
        className={cn(
          "truncate font-mono tabular-nums",
          emphasis ? "font-semibold text-[13px] text-panel-text-active" : "text-panel-text"
        )}
      >
        {value}
      </span>
    </div>
  );
}
