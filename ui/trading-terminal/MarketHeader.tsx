import { ChevronDown, Dot, Star } from "lucide-react";
import { CONTRACT_TABS, MARKET_STATS } from "@/lib/mock-trading-data";
import { cn } from "@/lib/cn";

export function MarketHeader() {
  return (
    <header className="rounded-md border border-[#1B2430] bg-[#0F1720]">
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className="flex size-7 items-center justify-center rounded-sm border border-[#1B2430] bg-[#11161D] text-[#6B7280] transition-colors hover:text-[#D1D5DB]"
              type="button"
            >
              <Star className="size-3.5" />
            </button>

            <button
              className="flex items-center gap-2 rounded-sm border border-[#1B2430] bg-[#11161D] px-3 py-1.5 font-semibold text-[#E5E7EB] text-sm"
              type="button"
            >
              USD/NGN Futures
              <ChevronDown className="size-4 text-[#6B7280]" />
            </button>
          </div>

          <div className="flex items-center gap-1">
            {CONTRACT_TABS.map((tab) => (
              <button
                className={cn(
                  "rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1 font-medium text-[#6B7280] text-[11px] transition-colors hover:border-[#2B3543] hover:text-[#D1D5DB]",
                  tab.active && "border-[#2563EB] bg-[#172554]/40 text-[#BFDBFE]",
                )}
                key={tab.label}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex h-9 flex-wrap items-center gap-2 overflow-hidden rounded-sm border border-[#1B2430] bg-[#11161D] px-3 text-[11px]">
          {MARKET_STATS.map((stat, index) => (
            <div className="flex items-center gap-2" key={stat.label}>
              {index > 0 ? <Dot className="size-3 text-[#374151]" /> : null}
              <span className="font-medium text-[#9CA3AF]">{stat.label}</span>
              <span
                className={cn(
                  "font-semibold text-[#D1D5DB]",
                  stat.tone === "accent" && "text-[#60A5FA]",
                )}
              >
                {stat.value}
              </span>
            </div>
          ))}
        </div>
      </div>
    </header>
  );
}
