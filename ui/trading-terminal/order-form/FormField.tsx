"use client";

import type { ReactNode } from "react";
import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";

/**
 * A ticket input in its own rounded box: the label top-left (with any explanation as its tooltip),
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
    <div className="rounded-lg bg-input-bg px-3 py-1.5 ring-1 ring-panel-border focus-within:ring-panel-text-muted">
      <div className="flex items-center justify-between gap-2">
        <FieldLabel htmlFor={id} tooltip={tooltip}>
          {label}
        </FieldLabel>
        {adornment}
      </div>
      <input
        className="w-full bg-transparent font-semibold text-[15px] text-panel-text-active tabular-nums outline-none placeholder:text-panel-text-muted"
        id={id}
        inputMode="decimal"
        onChange={(event) => onChange(event.target.value.replace(/[^\d.,]/g, ""))}
        placeholder={placeholder}
        value={value}
      />
    </div>
  );
}
