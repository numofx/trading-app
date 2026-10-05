"use client";

import { cn } from "@/lib/cn";
import type { SideTone } from "@/ui/trading-terminal/order-form/SideToggle";

/**
 * The ticket's one button. Filled with the side's colour when it would place an order, neutral
 * when it is a remedy instead (connect, deposit), and one shared inert style when it is disabled
 * or waiting on something.
 */
export function SubmitButton({
  busy = false,
  children,
  disabled = false,
  id,
  onClick,
  tone,
}: {
  /** Something is in flight: the button stays styled but cannot be pressed again. */
  busy?: boolean;
  children: string;
  disabled?: boolean;
  id: string;
  onClick: () => void;
  /** The side's colour, or `neutral` for a button that is not an order button right now. */
  tone: SideTone | "neutral";
}) {
  return (
    <button
      className={cn(
        "h-10 w-full rounded-lg font-semibold text-[13px] transition-colors",
        disabled && "cursor-not-allowed bg-input-bg text-panel-text-muted ring-1 ring-panel-border",
        !disabled && busy && "cursor-wait opacity-70",
        !(disabled || busy) && "cursor-pointer",
        !disabled && tone === "buy" && "bg-buy text-background hover:bg-buy/90",
        !disabled && tone === "sell" && "bg-sell text-white hover:bg-sell/90",
        !disabled &&
          tone === "neutral" &&
          "bg-input-bg text-panel-text-active ring-1 ring-panel-border hover:bg-input-hover"
      )}
      disabled={disabled || busy}
      id={id}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}
