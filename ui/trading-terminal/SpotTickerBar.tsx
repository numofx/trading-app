"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatNaira } from "@/lib/market-formatting";
import { SmartImage } from "@/ui/SmartImage";

function formatChangePercent(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  const sign = value >= 0 ? "+" : "-";
  return `${sign}${Math.abs(value).toFixed(2)}%`;
}

function TickerStat({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex min-w-0 shrink-0 flex-col gap-1">
      <span className="whitespace-nowrap text-[10px] text-panel-text-muted">{label}</span>
      <span className={cn("whitespace-nowrap font-medium text-[13px] text-panel-text", valueClassName)}>{value}</span>
    </div>
  );
}

export function SpotTickerBar({
  changePercent24h,
  high24h,
  lastPrice,
  low24h,
  volume24hLabel,
}: {
  changePercent24h: number | null;
  high24h: number | null;
  lastPrice: number | null;
  low24h: number | null;
  volume24hLabel: string;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const isNegativeChange = changePercent24h !== null && changePercent24h < 0;

  return (
    <section className="rounded-[20px] bg-panel-bg px-4 py-2.5 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Popover.Root onOpenChange={setDropdownOpen} open={dropdownOpen}>
          {/* Stable id: auto-generated useId values can shift when async state (e.g. Privy init) races hydration. */}
          <Popover.Trigger
            className="-m-1.5 flex cursor-pointer items-center gap-2.5 rounded-[14px] p-1.5 outline-none transition-colors hover:bg-input-hover focus-visible:ring-2 focus-visible:ring-panel-text-active/50"
            id="spot-ticker-market-trigger"
          >
            <span className="flex shrink-0 items-center -space-x-1.5">
              <SmartImage<string>
                alt="USDC"
                className="size-6 animate-none rounded-full bg-input-bg p-0.5 ring-2 ring-panel-bg"
                src="/tokens/usdc.svg"
              />
              <SmartImage<string>
                alt="cNGN"
                className="size-6 animate-none rounded-full bg-input-bg p-0.5 ring-2 ring-panel-bg"
                src="/tokens/cngn.svg"
              />
            </span>
            <div className="flex flex-col text-left">
              <span className="flex items-center gap-1 font-semibold text-[16px] text-panel-text-active leading-none tracking-[-0.01em]">
                USDC-cNGN
                <ChevronDown
                  className={cn(
                    "size-4 text-panel-text-muted transition-transform duration-200",
                    dropdownOpen && "rotate-180"
                  )}
                />
              </span>
            </div>
          </Popover.Trigger>

          <Popover.Portal>
            <Popover.Positioner align="start" sideOffset={8}>
              <Popover.Popup className="z-50 min-w-[280px] overflow-hidden rounded-2xl border border-panel-border bg-panel-bg-darker p-1.5 shadow-[0_20px_60px_var(--panel-shadow)] outline-none transition-all data-ending-style:scale-95 data-starting-style:scale-95 data-ending-style:opacity-0 data-starting-style:opacity-0">
                <button
                  className="flex w-full cursor-pointer items-center gap-3 rounded-xl bg-input-bg p-2.5 text-left text-panel-text-active transition-colors"
                  onClick={() => setDropdownOpen(false)}
                  type="button"
                >
                  <span className="flex shrink-0 items-center -space-x-1">
                    <SmartImage<string>
                      alt="USDC"
                      className="size-5 rounded-full bg-input-bg p-0.5 ring-1 ring-panel-border"
                      src="/tokens/usdc.svg"
                    />
                    <SmartImage<string>
                      alt="cNGN"
                      className="size-5 rounded-full bg-input-bg p-0.5 ring-1 ring-panel-border"
                      src="/tokens/cngn.svg"
                    />
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate font-semibold text-[13px] leading-none">USDC-cNGN</span>
                  </span>
                </button>
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>

        {/*
         * Below `sm` the stats stay on one swipeable row rather than wrapping: wrapping cost
         * ~140px of height directly above the order ticket. Scrolling keeps every stat
         * reachable, so none has to be dropped on phones.
         */}
        <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-x-5 overflow-x-auto sm:flex-wrap sm:gap-y-2 sm:overflow-x-visible">
          <div className="flex min-w-0 shrink-0 flex-col gap-1">
            <span className="whitespace-nowrap text-[10px] text-panel-text-muted">Last price (24H)</span>
            <span className="flex items-baseline gap-2 whitespace-nowrap">
              <span className="font-semibold text-[15px] text-panel-text-active leading-none">
                {formatNaira(lastPrice)}
              </span>
              <span
                className={cn(
                  "font-medium text-[11px] leading-none",
                  isNegativeChange ? "text-ask-text" : "text-bid-text"
                )}
              >
                {formatChangePercent(changePercent24h)}
              </span>
            </span>
          </div>

          <div className="hidden h-8 w-px shrink-0 bg-panel-border sm:block" />
          <TickerStat label="24H volume" value={volume24hLabel} />
          <div className="hidden h-8 w-px shrink-0 bg-panel-border sm:block" />
          <TickerStat label="24H high" value={formatNaira(high24h)} />
          <div className="hidden h-8 w-px shrink-0 bg-panel-border sm:block" />
          <TickerStat label="24H low" value={formatNaira(low24h)} />
        </div>
      </div>
    </section>
  );
}
