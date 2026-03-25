"use client";

import { useEffect, useState } from "react";
import type { MarketId } from "@/lib/trading.types";

const FAVORITE_MARKETS_STORAGE_KEY = "market-selector-favorites";
const RECENT_MARKETS_STORAGE_KEY = "market-selector-recents";
const DEFAULT_MAX_RECENT_MARKETS = 4;

function parseStoredMarketIds(value: string | null, validMarketIds: Set<string>, aliases: Map<string, MarketId>) {
  if (!value) {
    return [] as MarketId[];
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return [] as MarketId[];
    }

    const resolved = parsed.flatMap((item) => {
      if (typeof item !== "string") {
        return [];
      }

      const canonical = aliases.get(item.toLowerCase());
      if (!canonical || !validMarketIds.has(canonical)) {
        return [];
      }

      return [canonical];
    });

    return [...new Set(resolved)];
  } catch {
    return [] as MarketId[];
  }
}

export function useMarketSelectorPreferences(
  validMarketIds: MarketId[],
  aliases: Map<string, MarketId>,
  maxRecentMarkets = DEFAULT_MAX_RECENT_MARKETS,
) {
  const [favoriteMarketIds, setFavoriteMarketIds] = useState<MarketId[]>([]);
  const [recentMarketIds, setRecentMarketIds] = useState<MarketId[]>([]);
  const validMarketIdsKey = validMarketIds.join("|");
  const aliasEntriesKey = Array.from(aliases.entries())
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([alias, marketId]) => `${alias}:${marketId}`)
    .join("|");

  useEffect(() => {
    const validMarketIdSet = new Set(validMarketIdsKey ? validMarketIdsKey.split("|") : []);
    setFavoriteMarketIds(
      parseStoredMarketIds(window.localStorage.getItem(FAVORITE_MARKETS_STORAGE_KEY), validMarketIdSet, aliases),
    );
    setRecentMarketIds(
      parseStoredMarketIds(window.localStorage.getItem(RECENT_MARKETS_STORAGE_KEY), validMarketIdSet, aliases),
    );
  }, [aliases, aliasEntriesKey, validMarketIdsKey]);

  useEffect(() => {
    window.localStorage.setItem(FAVORITE_MARKETS_STORAGE_KEY, JSON.stringify(favoriteMarketIds));
  }, [favoriteMarketIds]);

  useEffect(() => {
    window.localStorage.setItem(RECENT_MARKETS_STORAGE_KEY, JSON.stringify(recentMarketIds));
  }, [recentMarketIds]);

  function toggleFavorite(marketId: MarketId) {
    setFavoriteMarketIds((current) =>
      current.includes(marketId)
        ? current.filter((existingId) => existingId !== marketId)
        : [marketId, ...current],
    );
  }

  function pushRecent(marketId: MarketId) {
    setRecentMarketIds((current) => {
      const next = [marketId, ...current.filter((existingId) => existingId !== marketId)];
      return next.slice(0, maxRecentMarkets);
    });
  }

  return {
    favoriteMarketIds,
    pushRecent,
    recentMarketIds,
    toggleFavorite,
  };
}
