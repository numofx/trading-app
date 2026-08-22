import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ActivityTab, ActivityView } from "@/lib/trading.types";

/** Tabs that describe the viewer's own account, so their rows must never render for a signed-out visitor. */
const ACCOUNT_SCOPED_TABS = new Set([
  "assets",
  "open-orders",
  "order-history",
  "positions",
  "trade-history",
]);

const EMPTY_STATE_COPY = {
  assets: { body: "Deposit USDC to fund your trading account.", title: "No assets" },
  positions: {
    body: "Your positions will appear here once orders are filled.",
    title: "No positions",
  },
} as const;

function getEmptyStateCopy(selectedTab: string, isSignedIn: boolean) {
  if (ACCOUNT_SCOPED_TABS.has(selectedTab) && !isSignedIn) {
    return { body: "Connect your wallet to see your account activity.", title: "Not connected" };
  }

  return (
    EMPTY_STATE_COPY[selectedTab as keyof typeof EMPTY_STATE_COPY] ?? {
      body: "This panel will populate as trading activity comes in.",
      title: "No activity yet",
    }
  );
}

export function TradingActivityPanel({
  activityView,
  footerLinks,
  isSignedIn = false,
  rowAction,
  selectedTab,
  tabs,
  onTabSelect,
}: {
  activityView: ActivityView;
  footerLinks: readonly { href: string; label: string }[];
  /** Whether a wallet session is active. Defaults to false so rows stay hidden unless proven otherwise. */
  isSignedIn?: boolean;
  /**
   * Control rendered in each row's trailing cell — the cancel button on Open Orders. The view
   * supplies a matching empty trailing column so the header and rows keep the same track count.
   */
  rowAction?: (rowIndex: number) => ReactNode;
  selectedTab: string;
  tabs: ActivityTab[];
  onTabSelect: (tabId: string) => void;
}) {
  const minimumVisibleRows = 3;
  // Account rows read as the viewer's own balances, orders, and positions. A signed-out visitor has
  // no account for them to belong to, so they get the empty state instead.
  const rows = ACCOUNT_SCOPED_TABS.has(selectedTab) && !isSignedIn ? [] : activityView.rows;
  const emptyStateCopy = getEmptyStateCopy(selectedTab, isSignedIn);
  const isEmpty = rows.length === 0;
  const fillerRowCount = Math.max(0, minimumVisibleRows - rows.length);
  const isMetricColumn = (column: string) =>
    column.includes("PnL") || column.includes("%") || column.includes("Return");
  // Columns hold a readable floor instead of compressing to nothing: at six columns on a phone an
  // equal split gives each ~55px, narrower than a header like "UNREALIZED", so they overlapped.
  // Below the floor the panel scrolls sideways; above it the tracks stay even, as before.
  const gridTemplateColumns = `repeat(${activityView.columns.length}, minmax(96px, 1fr))`;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg/72 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              className={cn(
                "rounded-sm px-3 py-1.5 font-medium text-[10px] text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active",
                selectedTab === tab.id && "bg-input-bg text-panel-text-active"
              )}
              key={tab.id}
              onClick={() => onTabSelect(tab.id)}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 pb-4">
        {/* Header and rows share this wrapper so they scroll sideways together and stay aligned. */}
        <div className="flex min-w-max flex-col">
          <div
            className="grid gap-2 text-[8px] text-panel-text-muted uppercase tracking-[0.16em]"
            style={{ gridTemplateColumns }}
          >
            {activityView.columns.map((column) => (
              <span className={isMetricColumn(column) ? "text-right" : undefined} key={column}>
                {column}
              </span>
            ))}
          </div>

          {isEmpty ? null : (
            <div className="mt-2 flex min-h-[96px] flex-1 flex-col overflow-hidden rounded-sm bg-input-bg/50">
              <div className="flex flex-1 flex-col">
                {rows.map((row, rowIndex) => (
                  <div
                    className="grid min-h-10 items-center gap-2 border-panel-border border-b px-3 py-1.5 text-[11px] last:border-b-0"
                    key={`${row.cells[0]}-${rowIndex}`}
                    style={{ gridTemplateColumns }}
                  >
                    {row.cells.map((cell, cellIndex) => (
                      <span
                        className={cn(
                          "text-panel-text",
                          cellIndex === 0 && "font-medium text-panel-text-active",
                          isMetricColumn(activityView.columns[cellIndex] ?? "") && "text-right",
                          cell.startsWith("-") && "text-sell",
                          row.positiveCellIndexes?.includes(cellIndex) && "font-medium text-buy"
                        )}
                        key={`${cell}-${cellIndex}`}
                      >
                        {cell}
                      </span>
                    ))}
                    {rowAction ? <span className="text-right">{rowAction(rowIndex)}</span> : null}
                  </div>
                ))}

                {Array.from({ length: fillerRowCount }, (_, rowIndex) => (
                  <div
                    className="grid min-h-10 items-center gap-2 border-panel-border border-b px-3 py-1.5"
                    key={`filler-${rowIndex}`}
                    style={{ gridTemplateColumns }}
                  >
                    {activityView.columns.map((column, columnIndex) => (
                      <span
                        className={cn(
                          "block h-px w-full rounded-full bg-panel-border",
                          isMetricColumn(column) && "ml-auto max-w-[72px]",
                          columnIndex === 0 && "max-w-[160px]",
                          columnIndex !== 0 && !isMetricColumn(column) && "max-w-[110px]"
                        )}
                        key={`filler-${rowIndex}-${column}`}
                      />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/*
         * The empty state sits outside the scrolled wrapper and is pinned left, so its centred
         * copy stays centred in the visible area rather than in the wider scrollable width.
         */}
        {isEmpty ? (
          <div className="sticky left-0 mt-2 flex min-h-[96px] flex-col items-center justify-center gap-4 rounded-sm bg-input-bg/50 text-center">
            <div>
              <div className="font-medium text-panel-text-active text-sm">
                {emptyStateCopy.title}
              </div>
              <div className="mt-1 text-[11px] text-panel-text-muted">{emptyStateCopy.body}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 px-4 pb-3 text-[10px] text-panel-text-muted sm:flex-row sm:items-center sm:justify-end">
        {footerLinks.map((link) => (
          <a
            className="transition-colors hover:text-panel-text-active"
            href={link.href}
            key={link.label}
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
