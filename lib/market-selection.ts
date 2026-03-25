import type { MarketDefinition, MarketId } from "@/lib/trading.types";

export const LEGACY_APR_2026_FUTURE_SYMBOL = "USDC/cNGN-APR30-2026";
export const CANONICAL_APR_2026_FUTURE_SYMBOL = "USDCcNGN-APR30-2026";
export const LEGACY_SPOT_SYMBOL = "USDC/cNGN";
export const CANONICAL_SPOT_SYMBOL = "USDCcNGN-SPOT";

function normalizeSelectionKey(value: string) {
  return value.trim().toLowerCase();
}

export function buildCanonicalMarketId(assetAddress: string, subId: string) {
  return `${assetAddress.trim().toLowerCase()}:${subId.trim()}`;
}

export function buildLegacyDerivedMarketId(marketSymbol: string, subId: string) {
  return `${marketSymbol.toLowerCase().replaceAll("/", "-").replaceAll(" ", "-")}-${subId}`;
}

export function getMarketSymbolAliases(marketSymbol: string) {
  switch (marketSymbol) {
    case CANONICAL_SPOT_SYMBOL:
      return [LEGACY_SPOT_SYMBOL];
    case LEGACY_SPOT_SYMBOL:
      return [CANONICAL_SPOT_SYMBOL];
    case CANONICAL_APR_2026_FUTURE_SYMBOL:
      return [LEGACY_APR_2026_FUTURE_SYMBOL];
    case LEGACY_APR_2026_FUTURE_SYMBOL:
      return [CANONICAL_APR_2026_FUTURE_SYMBOL];
    default:
      return [];
  }
}

export function buildMarketSelectionAliasMap(marketDefinitions: MarketDefinition[]) {
  const aliases = new Map<string, MarketId>();

  for (const market of marketDefinitions) {
    aliases.set(normalizeSelectionKey(market.id), market.id);
    for (const alias of market.marketIdAliases ?? []) {
      aliases.set(normalizeSelectionKey(alias), market.id);
    }

    if (!market.marketSymbol) {
      continue;
    }

    aliases.set(normalizeSelectionKey(market.marketSymbol), market.id);

    if (market.subId) {
      aliases.set(normalizeSelectionKey(buildLegacyDerivedMarketId(market.marketSymbol, market.subId)), market.id);
    }

    for (const alias of market.marketSymbolAliases ?? []) {
      aliases.set(normalizeSelectionKey(alias), market.id);

      if (market.subId) {
        aliases.set(normalizeSelectionKey(buildLegacyDerivedMarketId(alias, market.subId)), market.id);
      }
    }
  }

  return aliases;
}

export function resolveMarketSelection(value: string | null | undefined, aliases: Map<string, MarketId>) {
  if (!value) {
    return null;
  }

  return aliases.get(normalizeSelectionKey(value)) ?? null;
}

export function resolveInitialMarketSelection(
  requestedMarket: string | null | undefined,
  aliases: Map<string, MarketId>,
  defaultMarketId: MarketId,
) {
  if (!requestedMarket || requestedMarket.trim() === "") {
    return defaultMarketId;
  }

  return resolveMarketSelection(requestedMarket, aliases) ?? defaultMarketId;
}

export function resolveHydratedMarketSelection(params: {
  defaultMarketId: MarketId;
  requestedMarket: string | null | undefined;
  storedMarket: string | null | undefined;
  aliases: Map<string, MarketId>;
}) {
  const { aliases, defaultMarketId, requestedMarket, storedMarket } = params;
  const hasRequestedMarket = Boolean(requestedMarket && requestedMarket.trim() !== "");
  const resolvedRequestedMarket = hasRequestedMarket ? resolveMarketSelection(requestedMarket, aliases) : null;

  if (hasRequestedMarket) {
    return {
      shouldIgnoreInvalidRequestedMarket: !resolvedRequestedMarket,
      selectedMarketId: resolvedRequestedMarket,
    };
  }

  return {
    shouldIgnoreInvalidRequestedMarket: false,
    selectedMarketId: resolveMarketSelection(storedMarket, aliases) ?? defaultMarketId,
  };
}
