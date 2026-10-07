"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/** A plain labelled checkbox on one line, with a muted note after the label and a tooltip for why. */
export function CheckboxRow({
  checked,
  disabled = false,
  id,
  label,
  note,
  onChange,
  tooltip,
}: {
  checked: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  note?: string;
  onChange: (checked: boolean) => void;
  tooltip?: string;
}) {
  return (
    <label
      className={cn(
        "flex w-full items-center justify-between gap-2 text-[12px]",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      )}
      htmlFor={id}
      title={tooltip}
    >
      <span className="text-panel-text-muted">
        {label}
        {note ? <span className="ml-1 text-panel-text-muted/70">— {note}</span> : null}
      </span>
      <span
        className={cn(
          "relative flex size-3.5 shrink-0 items-center justify-center rounded-[3px] ring-1 ring-panel-border",
          checked ? "bg-panel-text-active text-panel-bg" : "bg-input-bg"
        )}
      >
        <input
          checked={checked}
          className="absolute inset-0 size-full cursor-[inherit] appearance-none opacity-0"
          disabled={disabled}
          id={id}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        {checked ? <Check aria-hidden className="size-3" strokeWidth={3} /> : null}
      </span>
    </label>
  );
}
