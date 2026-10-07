import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import type { ActivityTab, ActivityView } from "@/lib/trading.types";
import { SmartLink } from "@/ui/SmartLink";
import { PanelTabs } from "@/ui/trading-terminal/PanelTabs";

/** Tabs that describe the viewer's own account, so their rows must never render for a signed-out visitor. */
const ACCOUNT_SCOPED_TABS = new Set(["open-orders", "order-history", "trade-history"]);

/** Per-tab copy for an empty panel; tabs without an entry use the generic "No activity yet". */
const EMPTY_STATE_COPY: Partial<Record<string, EmptyState>> = {};

/** Columns whose cells are words rather than figures; every other column after the first is a number. */
const TEXT_COLUMNS = new Set([
  "Side",
  "Direction",
  "Role",
  "Time",
  "Asset",
  "Instrument",
  "Market",
  "",
]);

/** Figures and their headers right-align so digits line up; the row's name and any words stay left. */
function isNumericColumn(column: string, columnIndex: number) {
  return columnIndex !== 0 && !TEXT_COLUMNS.has(column);
}

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
  // Account rows read as the viewer's own balances, orders, and trades. A signed-out visitor has
  // no account for them to belong to, so they get the empty state instead.
  const rows = ACCOUNT_SCOPED_TABS.has(selectedTab) && !isSignedIn ? [] : activityView.rows;
  const emptyStateCopy = getEmptyStateCopy(selectedTab, isSignedIn, emptyState);
  const isEmpty = rows.length === 0;
  const columnCount = activityView.columns.length;
  /**
   * Each column is at least as wide as its widest value, and the spare width is shared evenly.
   * Under the old equal `1fr` tracks inside a max-content wrapper, every column grew to the
   * widest one (the Market cell with its pills), which pushed the last columns past the panel
   * edge and into a sideways scroll.
   */
  const gridTemplateColumns = `repeat(${columnCount}, minmax(max-content, 1fr))`;

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-panel-bg/72 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <PanelTabs className="px-4" onSelect={onTabSelect} selected={selectedTab} tabs={tabs} />

      <div className="min-h-0 flex-1 overflow-auto px-4 pt-1.5 pb-3">
        {/*
         * One grid for the header and every row: the rows are subgrids of it, so content-sized
         * columns resolve once and the header labels sit over their values. Only the outer
         * wrapper scrolls, as a fallback for viewports narrower than the content.
         */}
        <div className="grid gap-x-3" style={{ gridTemplateColumns }}>
          <div className="col-span-full grid grid-cols-subgrid px-3 text-[11px] text-panel-text-muted">
            {activityView.columns.map((column, columnIndex) => (
              <span
                className={cn(
                  "whitespace-nowrap",
                  isNumericColumn(column, columnIndex) && "text-right"
                )}
                key={column}
              >
                {column}
              </span>
            ))}
          </div>

          {isEmpty ? null : (
            <div className="col-span-full mt-1.5 grid grid-cols-subgrid overflow-hidden rounded-sm bg-input-bg/50">
              {rows.map((row, rowIndex) => (
                <div
                  className="col-span-full grid min-h-8 grid-cols-subgrid items-center border-panel-border border-b px-3 py-1 text-[12px] last:border-b-0"
                  key={`${row.cells[0]}-${rowIndex}`}
                >
                  {row.cells.map((cell, cellIndex) => (
                    <span
                      className={cn(
                        "whitespace-nowrap text-panel-text tabular-nums",
                        cellIndex === 0 && "font-medium text-panel-text-active",
                        isNumericColumn(activityView.columns[cellIndex] ?? "", cellIndex) &&
                          "text-right",
                        cell.startsWith("-") && "text-sell",
                        row.tones?.[cellIndex] === "positive" && "font-medium text-buy",
                        row.tones?.[cellIndex] === "negative" && "font-medium text-sell",
                        row.titles?.[cellIndex] !== undefined && "cursor-help"
                      )}
                      key={`${cell}-${cellIndex}`}
                      title={row.titles?.[cellIndex]}
                    >
                      {cell}
                      {row.badges?.[cellIndex]?.map((badge) => (
                        <span
                          className={cn(
                            "ml-1.5 inline-flex items-center rounded-sm px-1.5 py-0.5 align-middle font-medium text-[10px] leading-none",
                            badge.tone === "positive" && "bg-buy/15 text-buy",
                            badge.tone === "negative" && "bg-sell/15 text-sell",
                            badge.tone === undefined &&
                              "bg-input-bg text-panel-text ring-1 ring-panel-border"
                          )}
                          key={badge.label}
                        >
                          {badge.label}
                        </span>
                      ))}
                      {row.details?.[cellIndex] === undefined ? null : (
                        <span className="ml-1 font-normal text-[11px] text-panel-text-muted">
                          {row.details[cellIndex]}
                        </span>
                      )}
                    </span>
                  ))}
                  {rowAction ? <span className="text-right">{rowAction(rowIndex)}</span> : null}
                </div>
              ))}
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
