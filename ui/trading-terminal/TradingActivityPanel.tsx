import type { ActivityTab, ActivityView } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

export function TradingActivityPanel({
  activityView,
  footerLinks,
  selectedTab,
  tabs,
  onTabSelect,
}: {
  activityView: ActivityView;
  footerLinks: readonly { href: string; label: string }[];
  selectedTab: string;
  tabs: ActivityTab[];
  onTabSelect: (tabId: string) => void;
}) {
  const minimumVisibleRows = 3;
  const isEmpty = activityView.rows.length === 0;
  const fillerRowCount = Math.max(0, minimumVisibleRows - activityView.rows.length);
  const isMetricColumn = (column: string) => column.includes("PnL") || column.includes("%") || column.includes("Return");

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[28px] bg-panel-bg/72 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <div className="flex flex-wrap gap-1">
          {tabs.map((tab) => (
            <button
              className={cn(
                "rounded-xl px-3 py-1.5 font-medium text-[10px] text-panel-text-muted transition-colors hover:bg-input-hover hover:text-panel-text-active",
                selectedTab === tab.id && "bg-input-bg text-panel-text-active",
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
        <div
          className="grid gap-2 text-[8px] text-panel-text-muted uppercase tracking-[0.16em]"
          style={{ gridTemplateColumns: `repeat(${activityView.columns.length}, minmax(0, 1fr))` }}
        >
          {activityView.columns.map((column) => (
            <span className={isMetricColumn(column) ? "text-right" : undefined} key={column}>
              {column}
            </span>
          ))}
        </div>

        <div className="mt-2 flex min-h-[96px] flex-1 flex-col overflow-hidden rounded-[20px] bg-input-bg/50">
          {isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div>
                <div className="font-medium text-panel-text-active text-sm">
                  {selectedTab === "positions" ? "No positions" : "No activity yet"}
                </div>
                <div className="mt-1 text-[11px] text-panel-text-muted">
                  {selectedTab === "positions"
                    ? "Your positions will appear here once orders are filled."
                    : "This panel will populate as trading activity comes in."}
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  className="rounded-xl bg-input-bg px-3 py-1.5 text-[11px] text-panel-text transition-colors hover:bg-input-hover"
                  onClick={() => onTabSelect("open-orders")}
                  type="button"
                >
                  Open Orders
                </button>
                <button
                  className="rounded-xl bg-input-bg px-3 py-1.5 text-[11px] text-panel-text transition-colors hover:bg-input-hover"
                  onClick={() => onTabSelect("trade-history")}
                  type="button"
                >
                  Recent Trades
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-1 flex-col">
              {activityView.rows.map((row, rowIndex) => (
                <div
                  className="grid min-h-10 items-center gap-2 border-panel-border border-b px-3 py-1.5 text-[11px] last:border-b-0"
                  key={`${row.cells[0]}-${rowIndex}`}
                  style={{ gridTemplateColumns: `repeat(${activityView.columns.length}, minmax(0, 1fr))` }}
                >
                  {row.cells.map((cell, cellIndex) => (
                    <span
                      className={cn(
                        "text-panel-text",
                        cellIndex === 0 && "font-medium text-panel-text-active",
                        isMetricColumn(activityView.columns[cellIndex] ?? "") && "text-right",
                        cell.startsWith("-") && "text-panel-text-muted",
                        row.positiveCellIndexes?.includes(cellIndex) && "font-medium text-panel-text-active",
                      )}
                      key={`${cell}-${cellIndex}`}
                    >
                      {cell}
                    </span>
                  ))}
                </div>
              ))}

              {Array.from({ length: fillerRowCount }, (_, rowIndex) => (
                <div
                  className="grid min-h-10 items-center gap-2 border-panel-border border-b px-3 py-1.5"
                  key={`filler-${rowIndex}`}
                  style={{ gridTemplateColumns: `repeat(${activityView.columns.length}, minmax(0, 1fr))` }}
                >
                  {activityView.columns.map((column, columnIndex) => (
                    <span
                      className={cn(
                        "block h-px w-full rounded-full bg-panel-border",
                        isMetricColumn(column) && "ml-auto max-w-[72px]",
                        columnIndex === 0 && "max-w-[160px]",
                        columnIndex !== 0 && !isMetricColumn(column) && "max-w-[110px]",
                      )}
                      key={`filler-${rowIndex}-${column}`}
                    />
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-2 px-4 pb-3 text-[10px] text-panel-text-muted sm:flex-row sm:items-center sm:justify-end">
        {footerLinks.map((link) => (
          <a className="transition-colors hover:text-panel-text-active" href={link.href} key={link.label}>
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
