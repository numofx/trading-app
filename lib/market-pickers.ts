/** The fields of a `/v1/markets` entry that identify which terminal market it is. */
export type MarketIdentity = {
  contract_type?: string;
  base_asset_symbol?: string;
  quote_asset_symbol?: string;
};

/**
 * The venue reports every market as cNGN over USDC since the orientation change of 2026-10-07:
 * `base_asset_symbol` cNGN, `quote_asset_symbol` USDC, prices in USDC per cNGN. Both terminals
 * and the market selector pick their market through these two, so the filter lives in one place;
 * the selector's own copy, left on the old USDC-over-cNGN orientation, is what blanked its table.
 */
function isCngnOverUsdc(market: MarketIdentity) {
  return market.base_asset_symbol === "cNGN" && market.quote_asset_symbol === "USDC";
}

/** USDCcNGN-SPOT, when the venue lists it. */
export function findSpotMarket<T extends MarketIdentity>(markets: readonly T[]): T | null {
  return (
    markets.find((market) => market.contract_type === "spot" && isCngnOverUsdc(market)) ?? null
  );
}

/** USDCcNGN-PERP, when the venue lists it: contract_type `perpetual`, cNGN over USDC. */
export function findPerpMarket<T extends MarketIdentity>(markets: readonly T[]): T | null {
  return (
    markets.find((market) => market.contract_type === "perpetual" && isCngnOverUsdc(market)) ?? null
  );
}
