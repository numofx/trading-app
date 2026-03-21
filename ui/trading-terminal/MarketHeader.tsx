"use client";

import { useState } from "react";
import { ChevronDown, Dot, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import type { ContractTab, MarketDefinition, MarketStat } from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";
import { MarketListRow } from "@/ui/trading-terminal/MarketListRow";

function formatContractLabel(label: string) {
  const [month, year] = label.split(" ");

  if (!month || !year) {
    return label;
  }

  return `${month[0]}${month.slice(1).toLowerCase()} ${year}`;
}

export function MarketHeader({
  annualizedBasisByMarketId,
  basisByMarketId,
  contractTabs,
  currentContract,
  currentMarketId,
  currentSymbol,
  lastByMarketId,
  infoBar,
  marketOptions,
  onContractSelect,
  onMarketSelect,
}: {
  annualizedBasisByMarketId: Record<string, number | null>;
  basisByMarketId: Record<string, number | null>;
  contractTabs: ContractTab[];
  currentContract: string;
  currentMarketId: string;
  currentSymbol: string;
  infoBar: MarketStat[];
  lastByMarketId: Record<string, number | null>;
  marketOptions: MarketDefinition[];
  onContractSelect: (contract: string) => void;
  onMarketSelect: (marketId: string) => void;
}) {
  const primaryTabs = ["All", "spot", "future", "option"] as const;
  const [marketSearchOpen, setMarketSearchOpen] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [selectedPrimaryTab, setSelectedPrimaryTab] =
    useState<(typeof primaryTabs)[number]>("All");
  const normalizedSearch = marketSearch.trim().toLowerCase();
  const filteredMarkets = marketOptions.filter((market) => {
    const matchesPrimary =
      selectedPrimaryTab === "All" ||
      market.type === selectedPrimaryTab;

    if (!matchesPrimary) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

    return (
      market.pair.toLowerCase().includes(normalizedSearch) ||
      market.type.toLowerCase().includes(normalizedSearch) ||
      market.expiryLabel?.toLowerCase().includes(normalizedSearch) === true
    );
  });

  function handleMarketPick(marketId: string) {
    onMarketSelect(marketId);
    setMarketSearchOpen(false);
    setMarketSearch("");
  }

  return (
    <header className="rounded-md border border-[#1B2430] bg-[#0F1720]">
      <div className="flex flex-col gap-1.5 px-3 py-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <SmartImage<string>
              alt="Numo"
              className="ml-3 h-6 w-24 shrink-0 sm:h-7 sm:w-28"
              imgClassName="object-left"
              priority
              src="/numo_logo_white.png"
            />

            <div className="relative">
              <button
                aria-expanded={marketSearchOpen}
                aria-haspopup="dialog"
                className="flex items-center gap-2 rounded-sm border border-[#1B2430] bg-[#11161D] px-3 py-1.5 font-semibold text-[#E5E7EB] text-sm"
                onClick={() => setMarketSearchOpen((current) => !current)}
                type="button"
              >
                {currentSymbol}
                <ChevronDown className="size-4 text-[#6B7280]" />
              </button>

              {marketSearchOpen ? (
                <div className="absolute top-[calc(100%+8px)] left-0 z-30 w-[min(720px,calc(100vw-32px))] rounded-md border border-[#1B2430] bg-[#101720] shadow-2xl shadow-black/30">
                  <div className="border-[#1B2430] border-b p-3">
                    <div className="flex h-10 items-center gap-2 rounded-sm border border-[#324051] bg-[#11161D] px-3">
                      <Search className="size-4 text-[#6B7280]" />
                      <input
                        autoFocus
                        className="flex-1 bg-transparent text-[#E5E7EB] text-sm outline-none placeholder:text-[#6B7280]"
                        onChange={(event) => setMarketSearch(event.target.value)}
                        placeholder="Search markets"
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

                  <div className="border-[#1B2430] border-b px-3">
                    <div className="flex items-center gap-5 overflow-x-auto py-2 text-sm">
                      {primaryTabs.map((tab) => (
                        <button
                          className={cn(
                            "border-transparent border-b pb-1 text-[#9CA3AF] transition-colors hover:text-[#E5E7EB]",
                            selectedPrimaryTab === tab && "border-[#60A5FA] text-[#E5E7EB]",
                          )}
                          key={tab}
                          onClick={() => setSelectedPrimaryTab(tab)}
                          type="button"
                        >
                          {tab === "All" ? "All" : tab[0]?.toUpperCase() + tab.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="grid grid-cols-[minmax(260px,2.5fr)_92px_92px_92px_84px] gap-4 border-[#1B2430] border-b px-4 py-2 text-[#9CA3AF] text-[11px] uppercase tracking-[0.12em]">
                    <span>Market</span>
                    <span className="text-right">Last</span>
                    <span className="text-right">Basis</span>
                    <span className="text-right">Basis %</span>
                    <span className="text-right">Expiry</span>
                  </div>

                  <div className="max-h-72 overflow-y-auto">
                    {filteredMarkets.length ? (
                      filteredMarkets.map((market) => (
                        <MarketListRow
                          annualizedBasis={annualizedBasisByMarketId[market.id] ?? null}
                          basis={basisByMarketId[market.id] ?? null}
                          isSelected={currentMarketId === market.id}
                          key={market.id}
                          last={lastByMarketId[market.id] ?? null}
                          market={market}
                          onSelect={() => handleMarketPick(market.id)}
                        />
                      ))
                    ) : (
                      <div className="px-3 py-8 text-center text-[#6B7280] text-sm">
                        No markets match &quot;{marketSearch}&quot;
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
                {formatContractLabel(tab.label)}
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
