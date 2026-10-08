import { expect, test } from "bun:test";
import { findPerpMarket, findSpotMarket } from "./market-pickers.ts";

const SERVED = [
  {
    base_asset_symbol: "cNGN",
    contract_type: "perpetual",
    market: "cNGN-PERP",
    quote_asset_symbol: "USDC",
  },
  {
    base_asset_symbol: "cNGN",
    contract_type: "spot",
    market: "cNGN-USDC",
    quote_asset_symbol: "USDC",
  },
];

test("both markets are picked by the cNGN-over-USDC orientation the venue reports", () => {
  expect(findSpotMarket(SERVED)?.market).toBe("cNGN-USDC");
  expect(findPerpMarket(SERVED)?.market).toBe("cNGN-PERP");
});

// The selector's overview route kept a USDC-over-cNGN filter after the 2026-10-07 orientation
// change and so found nothing; every figure in its table read as a dash.
test("the old USDC-over-cNGN orientation matches nothing, and an empty list yields null", () => {
  const flipped = SERVED.map((m) => ({
    ...m,
    base_asset_symbol: "USDC",
    quote_asset_symbol: "cNGN",
  }));
  expect(findSpotMarket(flipped)).toBeNull();
  expect(findPerpMarket(flipped)).toBeNull();
  expect(findSpotMarket([])).toBeNull();
  expect(findPerpMarket([])).toBeNull();
});
