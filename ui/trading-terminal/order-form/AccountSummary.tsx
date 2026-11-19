"use client";

import type { ReactNode } from "react";
import { TOKEN_ICONS } from "@/lib/token-icons";
import { SmartImage } from "@/ui/SmartImage";
import type { TokenSymbol } from "@/ui/trading-terminal/order-form/TokenUnit";

export type AccountSummaryRow = {
  /** A control that replaces the deposit and withdraw buttons, e.g. a retired account's withdraw dialog trigger. */
  action?: ReactNode;
  /** The holding, already formatted; an em dash until it is known. */
  balance: string;
  /** Distinguishes rows that share a symbol, such as a retired account's; the symbol otherwise. */
  id?: string;
  /** A muted line under the symbol, e.g. which account a second row of the same asset belongs to. */
  note?: string;
  onDeposit?: () => void;
  /** Offered only where something can be withdrawn: a held balance on an account that pays out. */
  onWithdraw?: () => void;
  symbol: TokenSymbol;
};

const ROW_BUTTON_CLASSES =
  "flex size-7 shrink-0 cursor-pointer items-center justify-center bg-panel-bg text-[15px] text-panel-text-active leading-none ring-2 ring-panel-ring transition-colors hover:bg-input-hover";

/**
 * What the trading account holds, every leg at once, under the ticket where the order is being
 * written. The ticket only ever reports the leg the selected side spends, so a trader sizing a buy
 * would otherwise have to flip to Sell to learn what USDC the account holds.
 *
 * The plus deposits into the account, which is the action when the figure is short: the same
 * control, in the same place, as the ticket's `Available` row directly above. The minus withdraws,
 * where the row has something that can be withdrawn.
 *
 * Deliberately a few lines and nothing else: it sits in the ticket's column, and every row it takes
 * is a row the order fields lose on the 700–900px viewports most of this app's desktop traffic
 * uses. `—` rather than `0` until a balance is known: an account still resolving and one that
 * genuinely holds nothing are different answers, and a zero for the first invites a deposit it
 * may not need.
 */
export function AccountSummary({ rows }: { rows: readonly AccountSummaryRow[] }) {
  return (
    // Shares the ticket's panel chrome so the two read as one column, and `shrink-0` so a short
    // viewport takes its height out of the ticket's scroll area rather than squeezing these rows.
    <section className="flex shrink-0 flex-col overflow-clip bg-panel-bg-muted ring-2 ring-panel-ring transition-colors duration-300">
      {/* Dropped in the stacked layout for the reason the ticket drops its own: below `md` this
          column is the whole screen, and the label is only telling panels apart from siblings.
          Dropped on a short viewport too, where the column needs the rows more than the label. */}
      {/* Rows get a real line height rather than being packed: this is a readout a trader checks
          at a glance, and at the ticket's field density it read as a footnote. No rule between
          the rows: holdings of one account are a list, and a divider made them read as sections. */}
      <div className="space-y-1 px-4 py-2">
        {rows.map((row) => (
          <div
            className="flex min-h-10 items-center justify-between gap-2 text-[12px]"
            key={row.id ?? row.symbol}
          >
            <span className="flex min-w-0 items-center gap-2">
              <SmartImage<string>
                alt={row.symbol}
                className="size-5 shrink-0 animate-none rounded-full"
                src={TOKEN_ICONS[row.symbol]}
              />
              <span className="flex min-w-0 flex-col">
                <span className="font-semibold text-[13px] text-panel-text-active">
                  {row.symbol}
                </span>
                {row.note ? (
                  <span className="truncate text-[11px] text-panel-text-muted/70">{row.note}</span>
                ) : null}
              </span>
            </span>
            {/* Never shrinks: the amount is the point of the row; a long note truncates instead. */}
            <span className="flex shrink-0 items-center gap-2">
              <span className="whitespace-nowrap font-mono text-[13px] text-panel-text tabular-nums">
                {row.balance}
              </span>
              {row.action ?? (
                <>
                  {row.onWithdraw ? (
                    <button
                      aria-label={`Withdraw ${row.symbol}`}
                      className={ROW_BUTTON_CLASSES}
                      onClick={row.onWithdraw}
                      type="button"
                    >
                      −
                    </button>
                  ) : null}
                  <button
                    aria-label={`Deposit ${row.symbol}`}
                    className={ROW_BUTTON_CLASSES}
                    onClick={row.onDeposit}
                    type="button"
                  >
                    +
                  </button>
                </>
              )}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
