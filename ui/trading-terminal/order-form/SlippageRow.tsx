"use client";

import { Check, Pencil } from "lucide-react";
import { useState } from "react";
import { formatSlippagePercent, parseSlippagePercent } from "@/lib/perp-market";
import { FieldLabel } from "@/ui/trading-terminal/order-form/FieldLabel";

/**
 * The market order's slippage line: what the walk through the book estimates, and the most the
 * signed limit allows. The maximum is the one figure in the summary the trader can change, so it
 * carries a pencil; pressing it swaps the figure for a small input that commits on Enter or blur
 * and reverts on Escape or on a value outside (0, 5%].
 */
export function SlippageRow({
  estimate,
  max,
  onMaxChange,
}: {
  /** The walked estimate as a fraction; null when the book cannot say. */
  estimate: number | null;
  /** The signed tolerance as a fraction. */
  max: number;
  onMaxChange: (max: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft !== null) {
      const parsed = parseSlippagePercent(draft);
      if (parsed !== null) {
        onMaxChange(parsed);
      }
    }
    setDraft(null);
  }

  const estimateText = estimate === null ? "—" : formatSlippagePercent(estimate);

  return (
    <div className="flex items-center justify-between gap-2 text-[12px]">
      <FieldLabel tooltip="Est: how far past the touch this size is expected to fill, walked through the resting book. Max: how far through the touch the order is signed; it still fills at the resting price, this is only the room it has if the book moves.">
        Slippage
      </FieldLabel>
      <span className="flex min-w-0 items-center gap-1.5 text-panel-text tabular-nums">
        <span className="truncate">Est: {estimateText} / Max:</span>
        {draft === null ? (
          <>
            <span>{formatSlippagePercent(max)}</span>
            <button
              aria-label="Edit max slippage"
              className="flex size-4 cursor-pointer items-center justify-center rounded-full text-panel-text-muted transition-colors hover:text-panel-text-active"
              onClick={() => setDraft((max * 100).toString())}
              type="button"
            >
              <Pencil className="size-3" />
            </button>
          </>
        ) : (
          <>
            <span className="flex items-center rounded-sm bg-input-bg px-1 ring-1 ring-panel-border">
              <input
                aria-label="Max slippage, percent"
                autoFocus
                className="w-10 bg-transparent text-right text-[12px] text-panel-text-active tabular-nums outline-none"
                inputMode="decimal"
                onBlur={commit}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    commit();
                  } else if (event.key === "Escape") {
                    setDraft(null);
                  }
                }}
                value={draft}
              />
              <span className="text-panel-text-muted">%</span>
            </span>
            <button
              aria-label="Save max slippage"
              className="flex size-4 cursor-pointer items-center justify-center rounded-full text-panel-text-muted transition-colors hover:text-panel-text-active"
              onClick={commit}
              onMouseDown={(event) => event.preventDefault()}
              type="button"
            >
              <Check className="size-3" />
            </button>
          </>
        )}
      </span>
    </div>
  );
}
