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
  const minimumVisibleRows = 7;
  const isEmpty = activityView.rows.length === 0;
  const fillerRowCount = Math.max(0, minimumVisibleRows - activityView.rows.length);

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[22px] bg-[#0A1119]/72 ring-1 ring-white/5">
      <div className="flex flex-wrap items-center gap-2 border-white/6 border-b px-3.5 py-2.5">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-2.5 py-1 font-medium text-[#9CBFF2] text-[9px]">
            <span className="size-1.5 rounded-full bg-[#3B82F6]" />
            Online
          </div>

        <div className="flex flex-wrap gap-1.5">
          {tabs.map((tab) => (
            <button
              className={cn(
                "rounded-xl px-2.5 py-1.5 font-medium text-[#748195] text-[10px] transition-colors hover:bg-white/5",
                selectedTab === tab.id && "bg-white/6 text-[#E5ECF5]",
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

      <div className="min-h-0 flex-1 overflow-auto px-3.5 py-3">
        <div
          className="grid gap-2 text-[#5F6D80] text-[9px] uppercase tracking-[0.16em]"
          style={{ gridTemplateColumns: `repeat(${activityView.columns.length}, minmax(0, 1fr))` }}
        >
          {activityView.columns.map((column) => (
            <span className={column.includes("PnL") || column.includes("%") ? "text-right" : undefined} key={column}>
              {column}
            </span>
          ))}
        </div>

        <div className="mt-2.5 flex min-h-[200px] flex-1 flex-col overflow-hidden rounded-2xl bg-white/[0.03] xl:min-h-[240px]">
          {isEmpty ? (
            <div className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
              <div>
                <div className="font-medium text-[#E5ECF5] text-sm">
                  {selectedTab === "positions" ? "No positions" : "No activity yet"}
                </div>
                <div className="mt-1 text-[#738095] text-[11px]">
                  {selectedTab === "positions"
                    ? "Your positions will appear here once orders are filled."
                    : "This panel will populate as trading activity comes in."}
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-2">
                <button
                  className="rounded-xl bg-white/[0.05] px-3 py-1.5 text-[#D7DEE8] text-[11px] transition-colors hover:bg-white/[0.08]"
                  onClick={() => onTabSelect("open-orders")}
                  type="button"
                >
                  Open Orders
                </button>
                <button
                  className="rounded-xl bg-white/[0.05] px-3 py-1.5 text-[#D7DEE8] text-[11px] transition-colors hover:bg-white/[0.08]"
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
                  className="grid min-h-11 items-center gap-2 border-white/6 border-b px-2.5 py-2 text-[12px] last:border-b-0"
                  key={`${row.cells[0]}-${rowIndex}`}
                  style={{ gridTemplateColumns: `repeat(${activityView.columns.length}, minmax(0, 1fr))` }}
                >
                  {row.cells.map((cell, cellIndex) => (
                    <span
                      className={cn(
                        "text-[#C2CCD9]",
                        cellIndex === 0 && "font-medium text-[#E5ECF5]",
                        (activityView.columns[cellIndex]?.includes("PnL") || activityView.columns[cellIndex]?.includes("%")) && "text-right",
                        cell.startsWith("-") && "text-[#C89393]",
                        row.positiveCellIndexes?.includes(cellIndex) && "font-medium text-[#8AB899]",
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
                  className="grid min-h-11 items-center gap-2 border-white/6 border-b px-2.5 py-2"
                  key={`filler-${rowIndex}`}
                  style={{ gridTemplateColumns: `repeat(${activityView.columns.length}, minmax(0, 1fr))` }}
                >
                  {activityView.columns.map((column, columnIndex) => (
                    <span
                      className={cn(
                        "block h-px w-full rounded-full bg-white/[0.06]",
                        (column.includes("PnL") || column.includes("%")) && "ml-auto max-w-[72px]",
                        columnIndex === 0 && "max-w-[160px]",
                        columnIndex !== 0 && !column.includes("PnL") && !column.includes("%") && "max-w-[110px]",
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

      <div className="flex flex-col gap-2 border-white/6 border-t px-3.5 py-2.5 text-[#5F6D80] text-[11px] sm:flex-row sm:items-center sm:justify-end">
        {footerLinks.map((link) => (
          <a className="transition-colors hover:text-[#D7DEE8]" href={link.href} key={link.label}>
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
