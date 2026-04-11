"use client";

import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { ChevronDown, Command, Dot, Search, X } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatFxDisplayPair, getProductDisplayName, getSelectedInstrumentDisplay } from "@/lib/market-display";
import { getMarketTokenIcons } from "@/lib/market-token-icons";
import { buildMarketSelectionAliasMap } from "@/lib/market-selection";
import type { ContractTab, MarketDefinition, MarketId, MarketStat } from "@/lib/trading.types";
import { PrivyWalletButton } from "@/ui/PrivyWalletButton";
import { SmartImage } from "@/ui/SmartImage";
import { MarketSwitcherRow } from "@/ui/trading-terminal/MarketSwitcherRow";
import { useMarketSelectorPreferences } from "@/ui/trading-terminal/useMarketSelectorPreferences";

function formatContractLabel(label: string) {
  const [month, year] = label.split(" ");

  if (!month || !year) {
    return label;
  }

  return `${month[0]}${month.slice(1).toLowerCase()} ${year}`;
}

function hasAprilLeverageBadge(label: string) {
  return label.toUpperCase().startsWith("APR ");
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

function getRecentEmptyLabel(tab: "All" | "spot" | "future" | "option") {
  if (tab === "future") {
    return "No recent futures";
  }

  if (tab === "option") {
    return "No recent options";
  }

  if (tab === "spot") {
    return "No recent spot markets";
  }

  return "No recent markets";
}

function getResultsEmptyLabel(tab: "All" | "spot" | "future" | "option", hasSearch: boolean) {
  if (tab === "future") {
    return hasSearch ? "No futures found" : "No live futures available";
  }

  if (tab === "option") {
    return hasSearch ? "No options found" : "No options available";
  }

  if (tab === "spot") {
    return hasSearch ? "No spot markets found" : "No spot markets available";
  }

  return "No markets found";
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

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: This header coordinates selector state, search, and responsive market chrome in one component.
export function TradingMarketHeader({
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
  const availableMarketTypes = Array.from(new Set(marketOptions.map((market) => market.type)));
  const primaryTabs = [
    "All",
    ...(["spot", "future", "option"] as const).filter((type) => availableMarketTypes.includes(type)),
  ] as const;
  const [marketSearchOpen, setMarketSearchOpen] = useState(false);
  const [marketSearch, setMarketSearch] = useState("");
  const [activeMarketId, setActiveMarketId] = useState<MarketId | null>(null);
  const [selectedPrimaryTab, setSelectedPrimaryTab] =
    useState<(typeof primaryTabs)[number]>("All");
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const validMarketIds = marketOptions.map((market) => market.id);
  const marketSelectionAliases = buildMarketSelectionAliasMap(marketOptions);
  const {
    favoriteMarketIds,
    pushRecent,
    recentMarketIds,
    toggleFavorite,
  } = useMarketSelectorPreferences(validMarketIds, marketSelectionAliases);
  const normalizedSearch = marketSearch.trim().toLowerCase();
  const selectedInstrument = getSelectedInstrumentDisplay(selectedMarket);
  const selectedMarketTokenIcons = getMarketTokenIcons(selectedMarket.pair);
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
    if (selectedPrimaryTab === "All") {
      return;
    }

    if (!availableMarketTypes.includes(selectedPrimaryTab)) {
      setSelectedPrimaryTab("All");
    }
  }, [availableMarketTypes, selectedPrimaryTab]);

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
      openMarketSearch();
      return;
    }

    if (event.key === "Escape") {
      closeMarketSearch();
      return;
    }

    if (!marketSearchOpen && !isTypingTarget && event.key === "/") {
      event.preventDefault();
      openMarketSearch();
    }
  });

  useEffect(() => {
    window.addEventListener("keydown", handleGlobalKeydown);

    return () => window.removeEventListener("keydown", handleGlobalKeydown);
  }, []);

  function openMarketSearch() {
    setSelectedPrimaryTab("All");
    setMarketSearchOpen(true);
  }

  function closeMarketSearch() {
    setMarketSearchOpen(false);
    setMarketSearch("");
    setSelectedPrimaryTab("All");
  }

  function handleMarketPick(marketId: string) {
    onMarketSelect(marketId);
    closeMarketSearch();
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
      closeMarketSearch();
    }
  }

  function renderMarketRows(markets: MarketDefinition[]) {
    return markets.map((market) => (
      <MarketSwitcherRow
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
    <header className="rounded-[22px] bg-[#0C141E]/94 px-3.5 py-2.5 shadow-[0_18px_60px_rgba(0,0,0,0.24)] ring-1 ring-white/6">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-1.5">
            <SmartImage<string>
              alt="Numo"
              className="h-5.5 w-20 shrink-0 sm:h-6 sm:w-24"
              imgClassName="object-left"
              priority
              src="/numo_logo_white.png"
            />

            <div className="relative">
              <button
                aria-expanded={marketSearchOpen}
                aria-haspopup="dialog"
                className="inline-flex h-10 items-center gap-2.5 rounded-2xl bg-white/4 px-3.5 font-semibold text-[#E5ECF5] text-[13px] leading-none ring-1 ring-white/6"
                onClick={openMarketSearch}
                type="button"
              >
                {selectedMarketTokenIcons.length > 0 ? (
                  <span className="flex shrink-0 items-center -space-x-1">
                    {selectedMarketTokenIcons.map((tokenIcon) => (
                      <SmartImage<string>
                        alt={tokenIcon.symbol}
                        className="size-5.5 overflow-hidden rounded-full border border-[#1B2430] bg-white"
                        key={tokenIcon.symbol}
                        src={tokenIcon.src}
                      />
                    ))}
                  </span>
                ) : (
                  <SmartImage<string>
                    alt="NG"
                    className="h-3.5 w-5 shrink-0 overflow-hidden rounded-[2px]"
                    imgClassName="object-cover"
                    src={selectedMarket.flagSrc}
                  />
                )}
                <span className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                  <span className="truncate font-semibold text-[#E5ECF5] text-[13px] leading-none">
                    {selectedInstrument.pairLabel}
                  </span>
                  <span className="shrink-0 rounded-[10px] bg-[#0D4138] px-2 py-0.5 font-semibold text-[#51D0A6] text-[10px] uppercase leading-none tracking-[0.04em]">
                    {selectedInstrument.typeLabel}
                  </span>
                  {selectedInstrument.expiryLabel && hasAprilLeverageBadge(selectedInstrument.expiryLabel) ? (
                    <span className="shrink-0 rounded-full bg-[#153C2B] px-1.5 py-0.5 font-semibold text-[#6EE7A8] text-[9px] leading-none">
                      10x
                    </span>
                  ) : null}
                  {selectedInstrument.expiryLabel ? (
                    <span className="truncate font-semibold text-[#E5ECF5] text-[13px] leading-none">
                      · {selectedInstrument.expiryLabel}
                    </span>
                  ) : null}
                </span>
                <span className="hidden items-center gap-1 rounded-full bg-white/5 px-2 py-1 font-medium text-[#6F7C90] text-[10px] sm:inline-flex">
                  <Command className="size-2.5" />
                  K
                </span>
                <ChevronDown className="size-3.5 shrink-0 text-[#6F7C90]" />
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {contractTabs.map((tab) => (
              <button
                className={cn(
                  "flex items-center gap-1.5 rounded-xl px-2.5 py-1 font-medium text-[#738095] text-[10px] transition-colors hover:bg-white/5 hover:text-[#D7DEE8]",
                  currentContract === tab.label && "bg-white/7 text-[#E5ECF5]",
                )}
                key={tab.label}
                onClick={() => onContractSelect(tab.label)}
                type="button"
              >
                <span>{formatContractLabel(tab.label)}</span>
              </button>
            ))}

            <PrivyWalletButton />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1 border-white/6 border-t pt-2 text-[9px]">
          {infoBar.map((stat, index) => (
            <div className="flex items-center gap-1.5" key={stat.label}>
              {index > 0 ? <Dot className="size-2.5 text-[#324050]" /> : null}
              <span className="font-medium text-[#738095]">{stat.label}</span>
              <span
                className={cn(
                  "font-semibold text-[#D7DEE8]",
                  stat.tone === "accent" && "text-[#8EB5F5]",
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
            onClick={closeMarketSearch}
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
                        {getRecentEmptyLabel(selectedPrimaryTab)}
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
                    {getResultsEmptyLabel(selectedPrimaryTab, Boolean(normalizedSearch))}
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
