import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ActivityTab, ActivityView } from "@/lib/trading.types";
import { SmartLink } from "@/ui/SmartLink";
import { PanelTabs } from "@/ui/trading-terminal/PanelTabs";

/** Tabs that describe the viewer's own account, so their rows must never render for a signed-out visitor. */
const ACCOUNT_SCOPED_TABS = new Set(["open-orders", "order-history", "trade-history"]);

/** Per-tab copy for an empty panel; tabs without an entry use the generic "No activity yet". */
const EMPTY_STATE_COPY: Partial<Record<string, EmptyState>> = {};

type EmptyState = {
  /** A control under the copy, e.g. Order History's signature prompt. */
  action?: ReactNode;
  body: string;
  title: string;
};

function getEmptyStateCopy(
  selectedTab: string,
  isSignedIn: boolean,
  override: EmptyState | undefined
): EmptyState {
  // Signed out always wins: an override describes the viewer's account, and there is none yet.
  if (ACCOUNT_SCOPED_TABS.has(selectedTab) && !isSignedIn) {
    return { body: "Connect your wallet to see your account activity.", title: "Not connected" };
  }

  return (
    override ??
    EMPTY_STATE_COPY[selectedTab as keyof typeof EMPTY_STATE_COPY] ?? {
      body: "This panel will populate as trading activity comes in.",
      title: "No activity yet",
    }
  );
}

export function TradingActivityPanel({
  activityView,
  emptyState,
  footerLinks,
  isSignedIn = false,
  rowAction,
  selectedTab,
  tabs,
  onTabSelect,
}: {
  activityView: ActivityView;
  /** Replaces the selected tab's default empty state. Ignored while signed out. */
  emptyState?: EmptyState;
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
  // Account rows read as the viewer's own balances, orders, and trades. A signed-out visitor has
  // no account for them to belong to, so they get the empty state instead.
  const rows = ACCOUNT_SCOPED_TABS.has(selectedTab) && !isSignedIn ? [] : activityView.rows;
  const emptyStateCopy = getEmptyStateCopy(selectedTab, isSignedIn, emptyState);
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
      <PanelTabs className="px-4" onSelect={onTabSelect} selected={selectedTab} tabs={tabs} />

      <div className="min-h-0 flex-1 overflow-auto px-4 pt-2 pb-4">
        {/* Header and rows share this wrapper so they scroll sideways together and stay aligned. */}
        <div className="flex min-w-max flex-col">
          <div
            className="grid gap-2 text-[11px] text-panel-text-muted"
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
                    className="grid min-h-10 items-center gap-2 border-panel-border border-b px-3 py-1.5 text-[12px] last:border-b-0"
                    key={`${row.cells[0]}-${rowIndex}`}
                    style={{ gridTemplateColumns }}
                  >
                    {row.cells.map((cell, cellIndex) => (
                      <span
                        className={cn(
                          "text-panel-text",
                          cellIndex === 0 && "font-medium text-panel-text-active",
                          // A side cell stays on one line, whatever words it carries.
                          activityView.columns[cellIndex] === "Side" && "whitespace-nowrap",
                          isMetricColumn(activityView.columns[cellIndex] ?? "") && "text-right",
                          cell.startsWith("-") && "text-sell",
                          row.tones?.[cellIndex] === "positive" && "font-medium text-buy",
                          row.tones?.[cellIndex] === "negative" && "font-medium text-sell",
                          row.titles?.[cellIndex] !== undefined &&
                            "cursor-help underline decoration-dotted underline-offset-4"
                        )}
                        key={`${cell}-${cellIndex}`}
                        title={row.titles?.[cellIndex]}
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
              <div className="font-medium text-[13px] text-panel-text-active">
                {emptyStateCopy.title}
              </div>
              <div className="mt-1 text-[11px] text-panel-text-muted">{emptyStateCopy.body}</div>
            </div>
            {emptyStateCopy.action ?? null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-2 px-4 pb-3 text-[11px] text-panel-text-muted sm:flex-row sm:items-center sm:justify-end">
        {footerLinks.map((link) => (
          <SmartLink
            className="transition-colors hover:text-panel-text-active"
            href={link.href}
            key={link.label}
          >
            {link.label}
          </SmartLink>
        ))}
      </div>
    </section>
  );
}
