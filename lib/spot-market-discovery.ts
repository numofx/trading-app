import { CANONICAL_SPOT_SYMBOL, LEGACY_SPOT_SYMBOL } from "@/lib/market-selection";

export type SpotMarketCandidate = {
  asset_address?: string;
  base_asset_symbol?: string;
  contract_type?: string;
  display_label?: string;
  display_name?: string;
  market: string;
  quote_asset_symbol?: string;
  settlement_type?: string;
  sub_id?: string;
  tick_size?: string;
};

const SPOT_MARKET_SYMBOL_ALIASES = new Set([CANONICAL_SPOT_SYMBOL, LEGACY_SPOT_SYMBOL].map((value) => value.toLowerCase()));

function normalizeOptionalValue(value: string | undefined) {
  return value?.trim().toLowerCase();
}

function isMatchingUSDCCNGNSpotMarket(market: SpotMarketCandidate) {
  const normalizedMarket = normalizeOptionalValue(market.market);
  const normalizedDisplayLabel = normalizeOptionalValue(market.display_label);
  const normalizedDisplayName = normalizeOptionalValue(market.display_name);

  return (
    market.base_asset_symbol === "USDC" &&
      market.quote_asset_symbol === "cNGN"
  ) || (
    normalizedMarket ? SPOT_MARKET_SYMBOL_ALIASES.has(normalizedMarket) : false
  ) || (
    normalizedDisplayLabel ? SPOT_MARKET_SYMBOL_ALIASES.has(normalizedDisplayLabel) : false
  ) || (
    normalizedDisplayName ? SPOT_MARKET_SYMBOL_ALIASES.has(normalizedDisplayName) : false
  );
}

export function selectLiveUSDCCNGNSpotMarket(markets: SpotMarketCandidate[]) {
  const liveSpotCandidates = markets.filter((market) => {
    return (
      market.contract_type === "spot" &&
      market.settlement_type === "spot" &&
      Boolean(market.asset_address && market.sub_id)
    );
  });

  const exactMatch = liveSpotCandidates.find(isMatchingUSDCCNGNSpotMarket);

  if (exactMatch) {
    return exactMatch;
  }

  return liveSpotCandidates.length === 1 ? liveSpotCandidates[0] : null;
}
