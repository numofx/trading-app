"use client";

import { Dialog } from "@base-ui/react/dialog";
import { cn } from "@/lib/cn";
import type { DeliveryTerm } from "@/lib/trading.types";

/**
 * Interstitial for order submission, used by the spot ticket.
 *
 * Submitting signs an order and posts it; `/api/orders` is POST-only, so there is no cancel or
 * close path in this app. Embedded Privy wallets are configured with `showWalletUIs: false`,
 * which means the signature itself raises no prompt — without this dialog an email user goes
 * from one click to a filled order with nothing in between.
 *
 * `highlightedRow` is for a figure that decides whether the position survives, e.g. a liquidation
 * price. Spot passes none: it is unleveraged, so there is no such number.
 */
export function ConfirmOrderDialog({
  confirmLabel,
  description,
  directionLabel,
  highlightedRow,
  isSubmitting,
  onConfirm,
  onOpenChange,
  open,
  orderSide,
  sizeLabel,
  summaryRows,
  title,
}: {
  confirmLabel: string;
  /** A line under the title; none when the figures say enough. */
  description?: string;
  directionLabel: string;
  highlightedRow?: { label: string; note: string; value: string } | null;
  isSubmitting: boolean;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
  open: boolean;
  orderSide: "buy" | "sell";
  sizeLabel: string;
  summaryRows: DeliveryTerm[];
  title: string;
}) {
  const isBuy = orderSide === "buy";

  return (
    <Dialog.Root onOpenChange={onOpenChange} open={open}>
      <Dialog.Portal>
        {/*
         * Explicit z-index: the terminal panels create stacking contexts that otherwise paint
         * over the popup, obscuring the very figures this dialog exists to show.
         */}
        <Dialog.Backdrop className="fixed inset-0 z-50 bg-black/60 transition-opacity data-ending-style:opacity-0 data-starting-style:opacity-0" />
        <Dialog.Popup className="-translate-1/2 fixed top-1/2 left-1/2 z-50 w-[min(92vw,380px)] border border-panel-border bg-dialog-bg p-5 text-foreground transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
          <Dialog.Title className="font-semibold text-[15px] text-panel-text">{title}</Dialog.Title>
          {description === undefined ? null : (
            <Dialog.Description className="mt-1 text-[12px] text-panel-text-muted">
              {description}
            </Dialog.Description>
          )}

          <div className="mt-4 space-y-3">
            <div className="flex items-center justify-between gap-2 border border-panel-border px-3 py-2.5">
              <span className={cn("font-semibold text-[13px]", isBuy ? "text-buy" : "text-sell")}>
                {directionLabel}
              </span>
              <span className="truncate text-right font-medium text-[13px] text-panel-text">
                {sizeLabel}
              </span>
            </div>

            {highlightedRow ? (
              <div className="border border-sell/40 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-[11px] text-panel-text-muted">{highlightedRow.label}</span>
                  <span className="truncate text-right font-semibold text-[13px] text-sell">
                    {highlightedRow.value}
                  </span>
                </div>
                <p className="mt-1.5 text-[10px] text-panel-text-muted">{highlightedRow.note}</p>
              </div>
            ) : null}

            <div className="space-y-1.5 border border-panel-border px-3 py-2.5 text-[11px]">
              {summaryRows.map((row) => (
                <div className="flex items-center justify-between gap-2" key={row.label}>
                  <span className="truncate text-panel-text-muted">{row.label}</span>
                  <span className="truncate text-right font-medium text-panel-text">
                    {row.value}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="mt-5 grid grid-cols-2 gap-2">
            <Dialog.Close
              className="h-11 cursor-pointer border border-panel-border bg-input-bg font-semibold text-[13px] text-panel-text transition-colors hover:bg-input-hover"
              disabled={isSubmitting}
            >
              Cancel
            </Dialog.Close>
            <button
              className={cn(
                "h-11 cursor-pointer font-semibold text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                isBuy
                  ? "bg-buy text-background hover:bg-buy/90"
                  : "bg-sell text-white hover:bg-sell/90"
              )}
              disabled={isSubmitting}
              onClick={onConfirm}
              type="button"
            >
              {isSubmitting ? "Submitting..." : confirmLabel}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
