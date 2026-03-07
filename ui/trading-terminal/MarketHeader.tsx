import { ChevronDown, Star } from "lucide-react";
import { CONTRACT_TABS, MARKET_STATS } from "@/lib/mock-trading-data";
import { cn } from "@/lib/cn";

function StatCard({
  label,
  tone = "neutral",
  value,
}: {
  label: string;
  tone?: "accent" | "negative" | "positive" | "neutral";
  value: string;
}) {
  return (
    <div className="rounded-sm border border-[#1B2430] bg-[#151B23] px-2.5 py-1.5">
      <p className="text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">{label}</p>
      <p
        className={cn(
          "mt-0.5 font-medium text-[#D1D5DB] text-sm",
          tone === "accent" && "text-[#60A5FA]",
          tone === "negative" && "text-[#DC2626]",
          tone === "positive" && "text-[#16A34A]",
        )}
      >
        {value}
      </p>
    </div>
  );
}

export function MarketHeader() {
  return (
    <header className="rounded-md border border-[#1B2430] bg-[#11161D]">
      <div className="flex flex-col gap-2 px-3 py-2">
        <div className="flex flex-col gap-2 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <button
              className="flex size-8 items-center justify-center rounded-sm border border-[#1B2430] bg-[#151B23] text-[#6B7280] transition-colors hover:text-[#D1D5DB]"
              type="button"
            >
              <Star className="size-4" />
            </button>

            <button
              className="flex items-center gap-2 rounded-sm border border-[#1B2430] bg-[#151B23] px-3 py-1.5 font-semibold text-[#E5E7EB] text-sm"
              type="button"
            >
              USD/NGN Futures
              <ChevronDown className="size-4 text-[#6B7280]" />
            </button>

            <div className="rounded-sm border border-[#2563EB]/40 bg-[#172554] px-2 py-1 font-semibold text-[#93C5FD] text-[11px]">
              JUN 2026
            </div>
          </div>

          <div className="grid flex-1 grid-cols-2 gap-1.5 md:grid-cols-4 xl:grid-cols-7">
            {MARKET_STATS.map((stat) => (
              <StatCard key={stat.label} label={stat.label} tone={stat.tone} value={stat.value} />
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {CONTRACT_TABS.map((tab) => (
            <button
              className={cn(
                "rounded-sm border border-[#1B2430] bg-[#151B23] px-2.5 py-1 font-medium text-[#6B7280] text-[11px] transition-colors hover:border-[#374151] hover:text-[#D1D5DB]",
                tab.active && "border-[#3B82F6] bg-[#172554]/60 text-[#BFDBFE]",
              )}
              key={tab.label}
              type="button"
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </header>
  );
}
