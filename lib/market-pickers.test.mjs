import { expect, test } from "bun:test";
import {
  findFrontMonthFuture,
  findFutureBySymbol,
  findPerpMarket,
  findSpotMarket,
} from "./market-pickers.ts";

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

const future = (market, expiry) => ({
  base_asset_symbol: "USDC",
  contract_type: "future",
  expiry_timestamp: expiry,
  market,
  quote_asset_symbol: "cNGN",
});

const NOV = future("USDC-cNGN-30NOV26", 1_796_047_200);
const DEC = future("USDC-cNGN-31DEC26", 1_798_725_600);

test("the front month is the nearest series that has not expired, never spot or the perp", () => {
  const served = [...SERVED, DEC, NOV];
  expect(findFrontMonthFuture(served, 1_791_900_000_000)?.market).toBe("USDC-cNGN-30NOV26");
  // At November's expiry it rolls to December, with no code change.
  expect(findFrontMonthFuture(served, 1_796_047_200_000)?.market).toBe("USDC-cNGN-31DEC26");
  expect(findFrontMonthFuture(served, 1_798_725_600_000)).toBeNull();
  expect(findFrontMonthFuture(SERVED, 0)).toBeNull();
  expect(findSpotMarket(served)?.market).toBe("cNGN-USDC");
  expect(findPerpMarket(served)?.market).toBe("cNGN-PERP");
});

test("a series is found by its symbol in any casing, expired or not", () => {
  const served = [...SERVED, NOV];
  expect(findFutureBySymbol(served, "usdc-cngn-30nov26")).toBe(NOV);
  expect(findFutureBySymbol(served, "USDC-cNGN-31DEC26")).toBeNull();
  // Spot's symbol is not a future.
  expect(findFutureBySymbol(served, "cNGN-USDC")).toBeNull();
});
