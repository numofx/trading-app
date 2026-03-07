"use client";

import { useState } from "react";
import { ChevronDown, Dot, Search, Star, X } from "lucide-react";
import type { ContractTab, MarketStat } from "@/lib/trading.types";
import { cn } from "@/lib/cn";

export function MarketHeader({
  contractTabs,
  currentContract,
  favorite,
  infoBar,
  onContractSelect,
  onFavoriteToggle,
}: {
  contractTabs: ContractTab[];
  currentContract: string;
  favorite: boolean;
  infoBar: MarketStat[];
  onContractSelect: (contract: string) => void;
  onFavoriteToggle: () => void;
}) {
  const [marketSearchOpen, setMarketSearchOpen] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const normalizedSearch = marketSearch.trim().toLowerCase();
  const filteredTabs = contractTabs.filter((tab) => {
    if (!normalizedSearch) {
      return true;
    }

    const contractLabel = tab.label.toLowerCase();
    return (
      contractLabel.includes(normalizedSearch) ||
      `ngn/usd ${contractLabel}`.includes(normalizedSearch) ||
      "ngn/usd".includes(normalizedSearch)
    );
  });

  function handleContractPick(contract: string) {
    onContractSelect(contract);
    setMarketSearchOpen(false);
    setMarketSearch("");
  }

  return (
    <header className="rounded-md border border-[#1B2430] bg-[#0F1720]">
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <button
              className={cn(
                "flex size-7 items-center justify-center rounded-sm border border-[#1B2430] bg-[#11161D] text-[#6B7280] transition-colors hover:text-[#D1D5DB]",
                favorite && "text-[#D1D5DB]",
              )}
              onClick={onFavoriteToggle}
              type="button"
            >
              <Star className={cn("size-3.5", favorite && "fill-current")} />
            </button>

            <div className="relative">
              <button
                aria-expanded={marketSearchOpen}
                aria-haspopup="dialog"
                className="flex items-center gap-2 rounded-sm border border-[#1B2430] bg-[#11161D] px-3 py-1.5 font-semibold text-[#E5E7EB] text-sm"
                onClick={() => setMarketSearchOpen((current) => !current)}
                type="button"
              >
                NGN/USD
                <ChevronDown className="size-4 text-[#6B7280]" />
              </button>

              {marketSearchOpen ? (
                <div className="absolute top-[calc(100%+8px)] left-0 z-30 w-[min(420px,calc(100vw-32px))] rounded-md border border-[#1B2430] bg-[#101720] shadow-2xl shadow-black/30">
                  <div className="border-[#1B2430] border-b p-3">
                    <div className="flex items-center gap-2 rounded-sm border border-[#324051] bg-[#11161D] px-3 py-2">
                      <Search className="size-4 text-[#6B7280]" />
                      <input
                        autoFocus
                        className="flex-1 bg-transparent text-[#E5E7EB] text-sm outline-none placeholder:text-[#6B7280]"
                        onChange={(event) => setMarketSearch(event.target.value)}
                        placeholder="Search contracts"
                        value={marketSearch}
                      />
                      {marketSearch ? (
                        <button
                          className="text-[#6B7280] transition-colors hover:text-[#D1D5DB]"
                          onClick={() => setMarketSearch("")}
                          type="button"
                        >
                          <X className="size-4" />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="max-h-72 overflow-y-auto p-2">
                    {filteredTabs.length ? (
                      filteredTabs.map((tab) => (
                        <button
                          className={cn(
                            "flex w-full items-center justify-between rounded-sm px-3 py-2 text-left transition-colors hover:bg-[#151B23]",
                            currentContract === tab.label && "bg-[#172554]/30",
                          )}
                          key={tab.label}
                          onClick={() => handleContractPick(tab.label)}
                          type="button"
                        >
                          <div className="flex flex-col">
                            <span className="font-semibold text-[#E5E7EB] text-sm">NGN/USD</span>
                            <span className="text-[#6B7280] text-[11px] uppercase tracking-[0.12em]">
                              {tab.label}
                            </span>
                          </div>

                          <span
                            className={cn(
                              "rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1 font-medium text-[#9CA3AF] text-[11px]",
                              currentContract === tab.label && "border-[#2563EB] text-[#BFDBFE]",
                            )}
                          >
                            {tab.label}
                          </span>
                        </button>
                      ))
                    ) : (
                      <div className="px-3 py-8 text-center text-[#6B7280] text-sm">
                        No contracts match &quot;{marketSearch}&quot;
                      </div>
                    )}
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          <div className="flex items-center gap-1">
            {contractTabs.map((tab) => (
              <button
                className={cn(
                  "rounded-sm border border-[#1B2430] bg-[#11161D] px-2 py-1 font-medium text-[#6B7280] text-[11px] transition-colors hover:border-[#2B3543] hover:text-[#D1D5DB]",
                  currentContract === tab.label && "border-[#2563EB] bg-[#172554]/40 text-[#BFDBFE]",
                )}
                key={tab.label}
                onClick={() => onContractSelect(tab.label)}
                type="button"
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex h-9 flex-wrap items-center gap-2 overflow-hidden rounded-sm border border-[#1B2430] bg-[#11161D] px-3 text-[11px]">
          {infoBar.map((stat, index) => (
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
