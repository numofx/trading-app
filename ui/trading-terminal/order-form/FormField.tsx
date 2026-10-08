"use client";

import type { ReactNode } from "react";
import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";

/**
 * A ticket input in its own flat, square box, as the perp's size card is: the label top-left (with any explanation as its tooltip),
 * the unit or unit selector on the right, the value underneath. Keeping the label inside the box
 * buys back a row of height per field, which is what puts the submit button above the fold on a
 * 667px screen.
 */
export function FormField({
  adornment,
  id,
  label,
  onChange,
  placeholder = "0.00",
  tooltip,
  value,
}: {
  adornment?: ReactNode;
  id: string;
  label: string;
  onChange: (value: string) => void;
  placeholder?: string;
  tooltip?: string;
  value: string;
}) {
  return (
    <div className="border border-panel-border px-3 py-1.5 focus-within:border-panel-text-muted">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id} tooltip={tooltip}>
          {label}
        </FieldLabel>
        {adornment}
      </div>
      <input
        className="w-full bg-transparent font-semibold text-[16px] text-panel-text-active tabular-nums outline-none placeholder:text-panel-text-muted md:text-[15px]"
        id={id}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}
