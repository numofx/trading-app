"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ChevronDown, Command, Dot, Search, Wallet, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatFxDisplayPair, getProductDisplayName, getSelectedInstrumentDisplay } from "@/lib/market-display";
import type { ContractTab, MarketDefinition, MarketId, MarketStat } from "@/lib/trading.types";
import { SmartImage } from "@/ui/SmartImage";
import { MarketListRow } from "@/ui/trading-terminal/MarketListRow";
import { useMarketPreferences } from "@/ui/trading-terminal/useMarketPreferences";

function formatContractLabel(label: string) {
  const [month, year] = label.split(" ");

  if (!month || !year) {
    return label;
  }

  return `${month[0]}${month.slice(1).toLowerCase()} ${year}`;
}

function getProductTabLabel(tab: "All" | "spot" | "future" | "option") {
  if (tab === "All") {
    return "All";
  }

  if (tab === "future") {
    return "Futures";
  }

  if (tab === "option") {
    return "Options";
  }

  return "Spot";
}

function getMarketSearchTerms(market: MarketDefinition) {
  return [
    formatFxDisplayPair(market.pair),
    getProductDisplayName(market.type),
    market.expiryLabel ?? "",
  ]
    .join(" ")
    .toLowerCase();
}

function scoreMarketMatch(market: MarketDefinition, query: string) {
  if (!query) {
    return 0;
  }

  const haystack = getMarketSearchTerms(market);
  const pair = formatFxDisplayPair(market.pair).toLowerCase();
  const product = getProductDisplayName(market.type).toLowerCase();
  const expiry = market.expiryLabel?.toLowerCase() ?? "";

  if (haystack === query) {
    return 0;
  }

  if (pair === query) {
    return 1;
  }

  if (haystack.startsWith(query)) {
    return 2;
  }

  if (pair.startsWith(query)) {
    return 3;
  }

  if (product.startsWith(query) || expiry.startsWith(query)) {
    return 4;
  }

  if (haystack.includes(query)) {
    return 5;
  }

  return 6;
}

export function MarketHeader({
  atmIvByMarketId,
  annualizedBasisByMarketId,
  basisByMarketId,
  contractTabs,
  currentContract,
  currentMarketId,
  lastByMarketId,
  infoBar,
  marketOptions,
  openInterestByMarketId,
  onContractSelect,
  onMarketSelect,
  selectedMarket,
  spotChangeByMarketId,
}: {
  atmIvByMarketId: Record<string, string | null>;
  annualizedBasisByMarketId: Record<string, number | null>;
  basisByMarketId: Record<string, number | null>;
  contractTabs: ContractTab[];
  currentContract: string;
  currentMarketId: string;
  infoBar: MarketStat[];
  lastByMarketId: Record<string, number | null>;
  marketOptions: MarketDefinition[];
  openInterestByMarketId: Record<string, string | null>;
  onContractSelect: (contract: string) => void;
  onMarketSelect: (marketId: string) => void;
  selectedMarket: MarketDefinition;
  spotChangeByMarketId: Record<string, string | null>;
}) {
  const primaryTabs = ["All", "spot", "future", "option"] as const;
  const [marketSearchOpen, setMarketSearchOpen] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [activeMarketId, setActiveMarketId] = useState<MarketId | null>(null);
  const [selectedPrimaryTab, setSelectedPrimaryTab] =
    useState<(typeof primaryTabs)[number]>("All");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const validMarketIds = marketOptions.map((market) => market.id);
  const {
    favoriteMarketIds,
    pushRecent,
    recentMarketIds,
    toggleFavorite,
  } = useMarketPreferences(validMarketIds);
  const normalizedSearch = marketSearch.trim().toLowerCase();
  const selectedInstrument = getSelectedInstrumentDisplay(selectedMarket);
  const matchingMarkets = marketOptions
    .filter((market) => {
    const matchesPrimary =
      selectedPrimaryTab === "All" ||
      market.type === selectedPrimaryTab;

    if (!matchesPrimary) {
      return false;
    }

    if (!normalizedSearch) {
      return true;
    }

      return scoreMarketMatch(market, normalizedSearch) < 6;
    })
    .sort((left, right) => {
      const scoreDifference = scoreMarketMatch(left, normalizedSearch) - scoreMarketMatch(right, normalizedSearch);

      if (scoreDifference !== 0) {
        return scoreDifference;
      }

      return left.sortOrder - right.sortOrder;
    });
  const favoriteSet = new Set(favoriteMarketIds);
  const recentSet = new Set(recentMarketIds);
  const recentMarkets = matchingMarkets.filter((market) => recentSet.has(market.id));
  const nonRecentMarkets = matchingMarkets.filter((market) => !recentSet.has(market.id));
  const favoriteNonRecentMarkets = nonRecentMarkets.filter((market) => favoriteSet.has(market.id));
  const standardNonRecentMarkets = nonRecentMarkets.filter((market) => !favoriteSet.has(market.id));
  const mainListMarkets = [...favoriteNonRecentMarkets, ...standardNonRecentMarkets];
  const hasSearchResults = recentMarkets.length > 0 || mainListMarkets.length > 0;
  const showMainList = mainListMarkets.length > 0;
  const showMainListDivider = recentMarkets.length > 0 && showMainList;
  const visibleMarkets = [...recentMarkets, ...mainListMarkets];
  const visibleMarketIdsKey = visibleMarkets.map((market) => market.id).join("|");

  useEffect(() => {
    if (!marketSearchOpen) {
      return;
    }

    searchInputRef.current?.focus();
  }, [marketSearchOpen]);

  useEffect(() => {
    if (!marketSearchOpen) {
      setActiveMarketId(null);
      return;
    }

    const orderedMarketIds = visibleMarketIdsKey ? (visibleMarketIdsKey.split("|") as MarketId[]) : [];

    if (!orderedMarketIds.length) {
      setActiveMarketId(null);
      return;
    }

    const nextActiveMarketId = orderedMarketIds.includes(currentMarketId as MarketId)
      ? (currentMarketId as MarketId)
      : orderedMarketIds[0];

    setActiveMarketId((current) => {
      if (current && orderedMarketIds.includes(current)) {
        return current;
      }

      return nextActiveMarketId ?? null;
    });
  }, [currentMarketId, marketSearchOpen, visibleMarketIdsKey]);

  useEffect(() => {
    if (!marketSearchOpen || !activeMarketId) {
      return;
    }

    const rowElement = document.querySelector<HTMLElement>(`[data-market-row="${activeMarketId}"]`);
    rowElement?.scrollIntoView({ block: "nearest" });
  }, [activeMarketId, marketSearchOpen]);

  const handleGlobalKeydown = useEffectEvent((event: KeyboardEvent) => {
    const target = event.target;
    const isTypingTarget =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable);

    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      setMarketSearchOpen(true);
      return;
    }

    if (event.key === "Escape") {
      setMarketSearchOpen(false);
      setMarketSearch("");
      return;
    }

    if (!marketSearchOpen && !isTypingTarget && event.key === "/") {
      event.preventDefault();
      setMarketSearchOpen(true);
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeydown);

    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  function handleMarketPick(marketId: string) {
    onMarketSelect(marketId);
    setMarketSearchOpen(false);
    setMarketSearch("");
    pushRecent(marketId as MarketId);
  }

  function handleFavoriteToggle(marketId: MarketId) {
    toggleFavorite(marketId);
  }

  function moveActiveMarket(step: 1 | -1) {
    if (!visibleMarkets.length) {
      return;
    }

    if (!activeMarketId) {
      setActiveMarketId(visibleMarkets[0]?.id ?? null);
      return;
    }

    const currentIndex = visibleMarkets.findIndex((market) => market.id === activeMarketId);
    const nextIndex =
      currentIndex === -1
        ? 0
        : (currentIndex + step + visibleMarkets.length) % visibleMarkets.length;

    setActiveMarketId(visibleMarkets[nextIndex]?.id ?? null);
  }

  function handleSearchKeyDown(event: ReactKeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      moveActiveMarket(1);
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      moveActiveMarket(-1);
      return;
    }

    if (event.key === "Enter") {
      if (!activeMarketId) {
        return;
      }

      event.preventDefault();
      handleMarketPick(activeMarketId);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setMarketSearchOpen(false);
      setMarketSearch("");
    }
  }

  function renderMarketRows(markets: MarketDefinition[]) {
    return markets.map((market) => (
      <MarketListRow
        atmIv={atmIvByMarketId[market.id] ?? null}
        annualizedBasis={annualizedBasisByMarketId[market.id] ?? null}
        basis={basisByMarketId[market.id] ?? null}
        isActive={activeMarketId === market.id}
        isFavorite={favoriteSet.has(market.id)}
        isSelected={currentMarketId === market.id}
        key={market.id}
        last={lastByMarketId[market.id] ?? null}
        market={market}
        openInterest={openInterestByMarketId[market.id] ?? null}
        onHover={() => setActiveMarketId(market.id)}
        onSelect={() => handleMarketPick(market.id)}
        onToggleFavorite={() => handleFavoriteToggle(market.id)}
        spotChange={spotChangeByMarketId[market.id] ?? null}
      />
    ));
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
                className="inline-flex h-11 items-center gap-2.5 rounded-md border border-[#1B2430] bg-[#11161D] px-3.5 font-semibold text-[#E5E7EB] text-[15px] leading-none"
                onClick={() => setMarketSearchOpen(true)}
                type="button"
              >
                <SmartImage<string>
                  alt="NG"
                  className="h-4 w-6 shrink-0 overflow-hidden rounded-[2px]"
                  imgClassName="object-cover"
                  src="/flags/ng.svg"
                />
                <span className="min-w-0 truncate font-semibold text-[#E5E7EB] text-[15px] leading-none">
                  {selectedInstrument.label}
                </span>
                <span className="hidden items-center gap-1 rounded-full border border-[#233044] bg-[#0D131A] px-2 py-1 font-medium text-[#6B7280] text-[11px] sm:inline-flex">
                  <Command className="size-3" />
                  K
                </span>
                <ChevronDown className="size-4 shrink-0 text-[#6B7280]" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
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

            <button
              className="inline-flex h-9 items-center gap-2 rounded-md border border-[#1F4FD1] bg-[#17316B] px-3 font-medium text-[#E5EDFF] text-[12px] transition-colors hover:bg-[#1A3A81]"
              type="button"
            >
              <Wallet className="size-3.5" />
              <span>Connect Wallet</span>
            </button>
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

      {marketSearchOpen ? (
        <div className="fixed inset-0 z-40 flex items-start justify-center bg-[#050A11]/72 p-4 pt-[12vh] backdrop-blur-sm">
          <button
            aria-label="Close market switcher"
            className="absolute inset-0"
            onClick={() => {
              setMarketSearchOpen(false);
              setMarketSearch("");
            }}
            type="button"
          />
          <div
            className="relative z-10 w-full max-w-4xl overflow-hidden rounded-2xl border border-[#223043] bg-[#0D141C] shadow-[0_32px_120px_rgba(0,0,0,0.58)]"
            role="dialog"
            aria-modal="true"
            aria-label="Market switcher"
          >
            <div className="border-[#1B2430] border-b p-4">
              <div className="flex items-center gap-3 rounded-xl border border-[#324051] bg-[#111922] px-4 py-3">
                <Search className="size-4 text-[#6B7280]" />
                <input
                  ref={searchInputRef}
                  className="flex-1 bg-transparent text-[#E5E7EB] text-base outline-none placeholder:text-[#6B7280]"
                  onChange={(event) => setMarketSearch(event.target.value)}
                  onKeyDown={handleSearchKeyDown}
                  placeholder="Search pair, product, or expiry"
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
                <div className="hidden items-center gap-1 rounded-full border border-[#223043] bg-[#0D131A] px-2 py-1 text-[#6B7280] text-[11px] sm:flex">
                  <Command className="size-3" />
                  K
                </div>
              </div>

              <div className="mt-3 flex items-center gap-2 overflow-x-auto">
                {primaryTabs.map((tab) => (
                  <button
                    className={cn(
                      "rounded-full border border-[#1B2430] bg-[#111922] px-3 py-1.5 text-[#9CA3AF] text-sm transition-colors hover:text-[#E5E7EB]",
                      selectedPrimaryTab === tab && "border-[#2563EB] bg-[#172554]/40 text-[#E5E7EB]",
                    )}
                    key={tab}
                    onClick={() => setSelectedPrimaryTab(tab)}
                    type="button"
                  >
                    {getProductTabLabel(tab)}
                  </button>
                ))}
              </div>
            </div>

            <div className="max-h-[min(68vh,720px)] overflow-y-auto p-4">
              <div className="space-y-5">
                {normalizedSearch ? null : (
                  <section className="space-y-2">
                    <div className="px-1 text-[#6B7280] text-[11px] uppercase tracking-[0.14em]">
                      Recent
                    </div>
                    {recentMarkets.length ? (
                      <div className="space-y-1">{renderMarketRows(recentMarkets)}</div>
                    ) : (
                      <div className="px-3 py-8 text-center text-[#6B7280] text-sm">
                        No recent markets
                      </div>
                    )}
                  </section>
                )}

                {normalizedSearch && recentMarkets.length ? (
                  <section className="space-y-1">{renderMarketRows(recentMarkets)}</section>
                ) : null}

                {showMainListDivider ? <div className="border-[#1B2430] border-t" /> : null}

                {showMainList ? (
                  <section className="space-y-1">{renderMarketRows(mainListMarkets)}</section>
                ) : null}

                {hasSearchResults ? null : (
                  <div className="px-3 py-10 text-center text-[#6B7280] text-sm">
                    No markets found
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </header>
  );
}
