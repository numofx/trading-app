import type { MarketDefinition, MarketId } from "@/lib/trading.types";

export const LEGACY_APR_2026_FUTURE_SYMBOL = "USDC/cNGN-APR30-2026";
export const CANONICAL_APR_2026_FUTURE_SYMBOL = "USDCcNGN-APR30-2026";
export const LEGACY_SPOT_SYMBOL = "USDC/cNGN";
export const CANONICAL_SPOT_SYMBOL = "USDCcNGN-SPOT";
export const SPOT_MARKET_ID = "cngn-usdc-spot";

/**
 * URL-facing identifier for the spot view. Spot is a view mode rather than a
 * selectable row in `marketDefinitions` (production serves futures only), so its
 * `?market=` value is the bare pair — e.g. `?market=USDCcNGN` — instead of a
 * dated contract symbol.
 */
export const SPOT_URL_SLUG = "USDCcNGN";

const URL_SAFE_SYMBOL_PATTERN = /^[a-z0-9-]+$/i;

function normalizeSelectionKey(value: string) {
  return value.trim().toLowerCase();
}

const SPOT_SELECTION_KEYS = new Set(
  [SPOT_URL_SLUG, CANONICAL_SPOT_SYMBOL, LEGACY_SPOT_SYMBOL, SPOT_MARKET_ID].map(
    normalizeSelectionKey
  )
);

/**
 * True when a `?market=` value (or stored selection) refers to the spot view in
 * any of its forms: the URL slug `USDCcNGN`, the canonical/legacy spot symbols,
 * or the internal spot market id.
 */
export function isSpotMarketSelection(value: string | null | undefined) {
  return value ? SPOT_SELECTION_KEYS.has(normalizeSelectionKey(value)) : false;
}

export function buildCanonicalMarketId(assetAddress: string, subId: string) {
  return `${assetAddress.trim().toLowerCase()}:${subId.trim()}`;
}

export function buildLegacyDerivedMarketId(marketSymbol: string, subId: string) {
  return `${marketSymbol.toLowerCase().replaceAll("/", "-").replaceAll(" ", "-")}-${subId}`;
}

/**
 * URL-facing market identifier. Prefers the human-readable market symbol
 * (e.g. `USDCcNGN-SEP16-2026`) so the raw `address:subId` pair never leaks into
 * the address bar. Falls back to the canonical `id` when no URL-safe symbol
 * exists (e.g. the spot market). The symbol is already registered in the
 * selection alias map, so the slug round-trips through `resolveMarketSelection`
 * without any extra wiring.
 */
export function buildMarketUrlSlug(
  market: Pick<MarketDefinition, "id" | "marketSymbol"> | null | undefined
) {
  if (!market) {
    return "";
  }

  const symbol = market.marketSymbol?.trim();
  if (symbol && URL_SAFE_SYMBOL_PATTERN.test(symbol)) {
    return symbol;
  }

  return market.id;
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
      aliases.set(
        normalizeSelectionKey(buildLegacyDerivedMarketId(market.marketSymbol, market.subId)),
        market.id
      );
    }

    for (const alias of market.marketSymbolAliases ?? []) {
      aliases.set(normalizeSelectionKey(alias), market.id);

      if (market.subId) {
        aliases.set(
          normalizeSelectionKey(buildLegacyDerivedMarketId(alias, market.subId)),
          market.id
        );
      }
    }
  }

  return aliases;
}

export function resolveMarketSelection(
  value: string | null | undefined,
  aliases: Map<string, MarketId>
) {
  if (!value) {
    return null;
  }

  return aliases.get(normalizeSelectionKey(value)) ?? null;
}

export function resolveInitialMarketSelection(
  requestedMarket: string | null | undefined,
  aliases: Map<string, MarketId>,
  defaultMarketId: MarketId
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
  const resolvedRequestedMarket = hasRequestedMarket
    ? resolveMarketSelection(requestedMarket, aliases)
    : null;

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
