"use client";

import { Popover } from "@base-ui/react/popover";
import { ChevronDown, Plus, SlidersHorizontal, Wallet } from "lucide-react";
import type { ReactNode } from "react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { getInstrumentDisplayLabel } from "@/lib/market-display";
import { formatNaira } from "@/lib/market-formatting";
import type { MarketDefinition, MarketId } from "@/lib/trading.types";
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
    <div className="flex min-w-0 flex-col gap-1">
      <span className="whitespace-nowrap text-[10px] text-panel-text-muted">{label}</span>
      <span className={cn("whitespace-nowrap font-medium text-[13px] text-panel-text", valueClassName)}>{value}</span>
    </div>
  );
}

function TickerActionButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      className="flex h-8 cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-lg bg-input-bg px-2.5 font-semibold text-[11px] text-panel-text ring-1 ring-panel-border transition-colors hover:bg-input-hover hover:text-panel-text-active"
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
}

export function SpotTickerBar({
  changePercent24h,
  depositControl,
  high24h,
  lastPrice,
  low24h,
  marketDefinitions,
  onManageFunds,
  onSelectMarket,
  volume24hLabel,
}: {
  changePercent24h: number | null;
  depositControl?: ReactNode;
  high24h: number | null;
  lastPrice: number | null;
  low24h: number | null;
  marketDefinitions: MarketDefinition[];
  onManageFunds: () => void;
  onSelectMarket: (marketId: MarketId) => void;
  volume24hLabel: string;
}) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const isNegativeChange = changePercent24h !== null && changePercent24h < 0;
  // The spot market is not part of marketDefinitions (only futures are), so it gets a static row.
  const selectableFutures = marketDefinitions
    .filter((marketDefinition) => marketDefinition.pair === "USDCcNGN" && marketDefinition.type === "future")
    .sort((first, second) => first.sortOrder - second.sortOrder);

  return (
    <section className="rounded-[20px] bg-panel-bg px-4 py-2.5 shadow-[0_24px_80px_var(--panel-shadow)] ring-1 ring-panel-ring transition-colors duration-300">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
        <Popover.Root onOpenChange={setDropdownOpen} open={dropdownOpen}>
          <Popover.Trigger className="-m-1.5 flex cursor-pointer items-center gap-2.5 rounded-[14px] p-1.5 outline-none transition-colors hover:bg-input-hover focus-visible:ring-2 focus-visible:ring-panel-text-active/50">
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
            <div className="flex flex-col gap-0.5 text-left">
              <span className="flex items-center gap-1 font-semibold text-[16px] text-panel-text-active leading-none tracking-[-0.01em]">
                USDC/cNGN
                <ChevronDown
                  className={cn(
                    "size-4 text-panel-text-muted transition-transform duration-200",
                    dropdownOpen && "rotate-180"
                  )}
                />
              </span>
              <span className="font-medium text-[11px] text-panel-text-muted leading-none">Nigerian naira · Spot</span>
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
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="truncate font-semibold text-[13px] leading-none">USDC/cNGN Spot</span>
                    <span className="text-[10px] text-panel-text-muted">Spot market · Current</span>
                  </span>
                </button>
                {selectableFutures.map((marketDefinition) => (
                  <button
                    className="flex w-full cursor-pointer items-center gap-3 rounded-xl p-2.5 text-left text-panel-text transition-colors hover:bg-input-hover"
                    key={marketDefinition.id}
                    onClick={() => {
                      onSelectMarket(marketDefinition.id);
                      setDropdownOpen(false);
                    }}
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
                    <span className="flex min-w-0 flex-col gap-0.5">
                      <span className="truncate font-semibold text-[13px] leading-none">
                        {getInstrumentDisplayLabel(marketDefinition)}
                      </span>
                      <span className="text-[10px] text-panel-text-muted">Deliverable future · Derivatives</span>
                    </span>
                  </button>
                ))}
              </Popover.Popup>
            </Popover.Positioner>
          </Popover.Portal>
        </Popover.Root>

        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-5 gap-y-2">
          <div className="flex min-w-0 flex-col gap-1">
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

          <div className="hidden h-8 w-px bg-panel-border sm:block" />
          <TickerStat label="24H volume" value={volume24hLabel} />
          <div className="hidden h-8 w-px bg-panel-border sm:block" />
          <TickerStat label="24H high" value={formatNaira(high24h)} />
          <div className="hidden h-8 w-px bg-panel-border sm:block" />
          <TickerStat label="24H low" value={formatNaira(low24h)} />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <TickerActionButton>
            <SlidersHorizontal className="size-3.5" />
            Advanced
          </TickerActionButton>
          <TickerActionButton>
            <Plus className="size-3.5" />
            Add widget
          </TickerActionButton>
          {depositControl}
          <TickerActionButton onClick={onManageFunds}>
            <Wallet className="size-3.5" />
            Manage funds
          </TickerActionButton>
        </div>
      </div>
    </section>
  );
}
