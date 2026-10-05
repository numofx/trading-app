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
    <div className="flex items-center justify-between gap-2 text-[11px]">
      <FieldLabel tooltip={tooltip}>{label}</FieldLabel>
      <span
        className={cn(
          "truncate tabular-nums",
          emphasis ? "font-semibold text-[13px] text-panel-text-active" : "text-panel-text"
        )}
      >
        {value}
      </span>
    </div>
  );
}
