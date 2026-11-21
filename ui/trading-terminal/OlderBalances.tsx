"use client";

import { formatUnits } from "viem";
import { USDC_DECIMALS } from "@/lib/custody-routing";
import type { useMoveToCustody } from "@/ui/trading-terminal/useMoveToCustody";

const BUTTON_CLASSES =
  "shrink-0 cursor-pointer bg-panel-bg px-2 py-1 text-[12px] text-panel-text-active ring-2 ring-panel-ring transition-colors hover:bg-input-hover disabled:cursor-default disabled:opacity-50";

const usdc = (units: bigint) =>
  Number(formatUnits(units, USDC_DECIMALS)).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * USDC outside the custody account, as one line rather than more USDC rows: the terminal has one USDC balance,
 * the onchain account's, and this is only a way to bring the rest into it. Nothing shows under a cent.
 */
export function OlderBalances({ move }: { move: ReturnType<typeof useMoveToCustody> }) {
  if (move.shown === 0n && move.error === null) {
    return null;
  }
  let status: string | null = move.step ?? move.error;
  if (status === null && move.keptBack) {
    status = move.movable === 0n ? "In use as margin" : `${usdc(move.movable)} movable`;
  }
  return (
    <section className="flex shrink-0 flex-col gap-1 bg-panel-bg-muted px-4 py-2 text-[12px] ring-2 ring-panel-ring">
      {move.shown > 0n ? (
        <div className="flex min-h-8 items-center justify-between gap-2">
          <span className="text-panel-text-muted">Older</span>
          <span className="flex items-center gap-2">
            <span className="whitespace-nowrap font-mono text-[13px] text-panel-text tabular-nums">
              {usdc(move.shown)} USDC
            </span>
            <button
              className={BUTTON_CLASSES}
              disabled={move.step !== null || move.movable === 0n}
              onClick={() => void move.move()}
              title="Move into your account"
              type="button"
            >
              Move
            </button>
          </span>
        </div>
      ) : null}
      {status === null ? null : (
        <span
          className={`truncate text-[11px] ${move.error === null ? "text-panel-text-muted/80" : "text-red-400"}`}
          title={status}
        >
          {status}
        </span>
      )}
    </section>
  );
}
