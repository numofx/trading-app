"use client";

import { Check } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * A labelled checkbox on one line, box first, with a tooltip for what it does or why it is off.
 *
 * Below `md` the label is 44px tall for the thumb, pulled in by negative margins so the row it
 * sits in keeps its line height: the hit area reaches 13px above and below the text, into
 * spacing and non-interactive neighbours, never into another control.
 */
export function CheckboxRow({
  checked,
  disabled = false,
  id,
  label,
  onChange,
  tooltip,
}: {
  checked: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  onChange: (checked: boolean) => void;
  tooltip?: string;
}) {
  return (
    <label
      className={cn(
        "-my-[13px] flex min-h-11 w-full items-center gap-2.5 text-[12px] md:my-0 md:min-h-0",
        disabled ? "cursor-not-allowed opacity-60" : "cursor-pointer"
      )}
      htmlFor={id}
      title={tooltip}
    >
      <span
        className={cn(
          "relative flex size-4 shrink-0 items-center justify-center rounded-[4px] ring-1 ring-panel-border",
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
      <span className="text-panel-text">{label}</span>
    </label>
  );
}
