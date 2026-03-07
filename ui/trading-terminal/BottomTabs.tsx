import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";
import { BOTTOM_TABS, FOOTER_LINKS } from "@/lib/mock-trading-data";

export function BottomTabs() {
  return (
    <section className="rounded-md border border-[#1B2430] bg-[#0F1720]">
      <div className="flex flex-col gap-2 border-[#1B2430] border-b px-3 py-1 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex items-center gap-2 rounded-full border border-[#1B2430] bg-[#11161D] px-2 py-0.5 font-medium text-[#93C5FD] text-[10px]">
            <span className="size-1.5 rounded-full bg-[#3B82F6]" />
            Online
          </div>

          <div className="flex flex-wrap gap-1">
            {BOTTOM_TABS.map((tab) => (
              <button
                className={cn(
                  "rounded-sm px-2 py-1 font-medium text-[#6B7280] text-[11px] transition-colors hover:bg-[#11161D]",
                  tab.id === "positions" && "bg-[#11161D] text-[#E5E7EB]",
                )}
                key={tab.id}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <button
          className="inline-flex items-center gap-1 self-start rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1 text-[#D1D5DB] text-[11px] lg:self-auto"
          type="button"
        >
          Filter
          <ChevronDown className="size-4 text-[#6B7280]" />
        </button>
      </div>

      <div className="min-h-[72px] px-3 py-2">
        <div className="grid grid-cols-4 gap-3 text-[#6B7280] text-[10px] uppercase tracking-[0.14em]">
          <span>Instrument</span>
          <span>Position</span>
          <span>Entry Price</span>
          <span className="text-right">PnL</span>
        </div>

        <div className="mt-2.5 grid grid-cols-4 gap-3 rounded-sm border border-[#1B2430] bg-[#11161D] p-2 text-sm">
          <span className="font-medium text-[#E5E7EB]">USD/NGN JUN 2026</span>
          <span className="text-[#D1D5DB]">+50,000 USD</span>
          <span className="text-[#D1D5DB]">1,600.0</span>
          <span className="text-right font-medium text-[#8CC9A3]">+$156</span>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-[#1B2430] border-t px-3 py-1.5 text-[#6B7280] text-xs sm:flex-row sm:items-center sm:justify-end">
        {FOOTER_LINKS.map((link) => (
          <a className="transition-colors hover:text-[#D1D5DB]" href={link.href} key={link.label}>
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
