import { ChevronDown } from "lucide-react";
import type { ActivityTab, ActivityView } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

export function TradingActivityPanel({
  activityView,
  filter,
  footerLinks,
  selectedTab,
  tabs,
  onFilterClick,
  onTabSelect,
}: {
  activityView: ActivityView;
  filter: string;
  footerLinks: readonly { href: string; label: string }[];
  selectedTab: string;
  tabs: ActivityTab[];
  onFilterClick: () => void;
  onTabSelect: (tabId: string) => void;
}) {
  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-[24px] bg-[#0A1119]/72 ring-1 ring-white/5">
      <div className="flex flex-col gap-3 border-white/6 border-b px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1 font-medium text-[#9CBFF2] text-[10px]">
            <span className="size-1.5 rounded-full bg-[#3B82F6]" />
            Online
          </div>

          <div className="flex flex-wrap gap-2">
            {tabs.map((tab) => (
              <button
                className={cn(
                  "rounded-xl px-3 py-1.5 font-medium text-[#748195] text-[11px] transition-colors hover:bg-white/5",
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

        <button
          className="inline-flex items-center gap-1.5 self-start rounded-xl bg-white/[0.04] px-3 py-2 text-[#C2CCD9] text-[11px] lg:self-auto"
          onClick={onFilterClick}
          type="button"
        >
          Filter: {filter}
          <ChevronDown className="size-4 text-[#6B7280]" />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
        <div
          className="grid gap-2 text-[#5F6D80] text-[10px] uppercase tracking-[0.16em]"
          style={{ gridTemplateColumns: `repeat(${activityView.columns.length}, minmax(0, 1fr))` }}
        >
          {activityView.columns.map((column) => (
            <span className={column.includes("PnL") || column.includes("%") ? "text-right" : undefined} key={column}>
              {column}
            </span>
          ))}
        </div>

        <div className="mt-3 rounded-2xl bg-white/[0.03] p-3">
          {activityView.rows.map((row, rowIndex) => (
            <div
              className="grid gap-2 py-1 text-[13px]"
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
        </div>
      </div>

      <div className="flex flex-col gap-2 border-white/6 border-t px-4 py-3 text-[#5F6D80] text-xs sm:flex-row sm:items-center sm:justify-end">
        {footerLinks.map((link) => (
          <a className="transition-colors hover:text-[#D7DEE8]" href={link.href} key={link.label}>
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
