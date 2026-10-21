import type { SpotBase } from "@/lib/spot-pairs";

/** The fields of a `/v1/markets` entry that identify which terminal market it is. */
export type MarketIdentity = {
  contract_type?: string;
  base_asset_symbol?: string;
  quote_asset_symbol?: string;
};

/** A future's identity plus what tells one series from another. */
export type FutureIdentity = MarketIdentity & {
  market: string;
  /** Settlement time, unix seconds; also the series' sub id. */
  expiry_timestamp?: number;
};

/**
 * The venue reports spot and the perp as cNGN over USDC since the orientation change of 2026-10-07:
 * `base_asset_symbol` cNGN, `quote_asset_symbol` USDC, prices in USDC per cNGN. Both terminals
 * and the market selector pick their market through these two, so the filter lives in one place;
 * the selector's own copy, left on the old USDC-over-cNGN orientation, is what blanked its table.
 */
function isCngnOverUsdc(market: MarketIdentity) {
  return market.base_asset_symbol === "cNGN" && market.quote_asset_symbol === "USDC";
}

/**
 * The spot market trading `base` against USDC, when the venue lists it: cNGN-USDC by default,
 * EURC-USDC for `"EURC"`. Every spot pair is the base over USDC, priced in USDC per base.
 */
export function findSpotMarket<T extends MarketIdentity>(
  markets: readonly T[],
  base: SpotBase = "cNGN"
): T | null {
  return (
    markets.find(
      (market) =>
        market.contract_type === "spot" &&
        market.base_asset_symbol === base &&
        market.quote_asset_symbol === "USDC"
    ) ?? null
  );
}

/**
 * Every cash-settled cNGN future the venue lists and has not yet settled at `nowMs`, nearest
 * expiry first: contract_type `future`, which the venue names USDC over cNGN because it is quoted
 * cNGN per USDC.
 */
export function listLiveFutures<T extends FutureIdentity>(
  markets: readonly T[],
  nowMs: number
): T[] {
  return markets
    .filter(
      (market) =>
        market.contract_type === "future" &&
        market.base_asset_symbol === "USDC" &&
        market.quote_asset_symbol === "cNGN" &&
        market.expiry_timestamp !== undefined &&
        market.expiry_timestamp * 1000 > nowMs
    )
    .sort((left, right) => (left.expiry_timestamp ?? 0) - (right.expiry_timestamp ?? 0));
}

/** The front-month future: the nearest series that has not expired at `nowMs`, or null. */
export function findFrontMonthFuture<T extends FutureIdentity>(
  markets: readonly T[],
  nowMs: number
): T | null {
  return listLiveFutures(markets, nowMs)[0] ?? null;
}

/**
 * The future the venue lists under `symbol`, matched without regard to case, or null. A series
 * past its expiry is still found: its holders need the page to see it settle.
 */
export function findFutureBySymbol<T extends FutureIdentity>(
  markets: readonly T[],
  symbol: string
): T | null {
  const wanted = symbol.toLowerCase();
  return (
    markets.find(
      (market) => market.contract_type === "future" && market.market.toLowerCase() === wanted
    ) ?? null
  );
}

/** cNGN-PERP, when the venue lists it: contract_type `perpetual`, cNGN over USDC. */
export function findPerpMarket<T extends MarketIdentity>(markets: readonly T[]): T | null {
  return (
    markets.find((market) => market.contract_type === "perpetual" && isCngnOverUsdc(market)) ?? null
  );
}
