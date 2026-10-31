import { expect, test } from "bun:test";
import {
  findFrontMonthFuture,
  findFutureBySymbol,
  findPerpMarket,
  findSpotMarket,
  listLiveFutures,
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

/** A v2 series, as the venue lists it: the base over USDC, open or awaiting its enable. */
const future = (market, base, expiry, open = true) => ({
  base_asset_symbol: base,
  contract_type: "future",
  expiry_timestamp: expiry,
  future: { trading_open: open },
  market,
  quote_asset_symbol: "USDC",
});

const NOV = future("cNGN-30NOV26", "cNGN", 1_796_047_200);
const NOV_EURC = future("EURC-30NOV26", "EURC", 1_796_054_400);
const DEC = future("cNGN-31DEC26", "cNGN", 1_798_725_600);
/** The v1 series: USDC over cNGN. Listed by the venue, offered by the terminal no longer. */
const V1 = {
  base_asset_symbol: "USDC",
  contract_type: "future",
  expiry_timestamp: 1_796_047_200,
  future: { trading_open: true },
  market: "USDC-cNGN-30NOV26",
  quote_asset_symbol: "cNGN",
};

test("the front month is the nearest open series that has not expired, never spot or the perp", () => {
  const served = [...SERVED, DEC, NOV_EURC, NOV];
  expect(findFrontMonthFuture(served, 1_791_900_000_000)?.market).toBe("cNGN-30NOV26");
  // At November's expiry it rolls to December, with no code change.
  expect(findFrontMonthFuture(served, 1_796_047_200_000)?.market).toBe("EURC-30NOV26");
  expect(findFrontMonthFuture(served, 1_796_054_400_000)?.market).toBe("cNGN-31DEC26");
  expect(findFrontMonthFuture(served, 1_798_725_600_000)).toBeNull();
  expect(findFrontMonthFuture(SERVED, 0)).toBeNull();
  expect(findSpotMarket(served)?.market).toBe("cNGN-USDC");
  expect(findPerpMarket(served)?.market).toBe("cNGN-PERP");
});

test("a series awaiting its enable is listed but is not the front month; the v1 series is neither", () => {
  const closed = [...SERVED, future("cNGN-30NOV26", "cNGN", 1_796_047_200, false), V1];
  expect(listLiveFutures(closed, 1_791_900_000_000).map((m) => m.market)).toEqual([
    "cNGN-30NOV26",
  ]);
  // `/` then opens spot rather than a ticket that cannot trade, or the v1 series.
  expect(findFrontMonthFuture(closed, 1_791_900_000_000)).toBeNull();
});

test("a series is found by its symbol in any casing, expired or not, the v1 series too", () => {
  const served = [...SERVED, NOV, V1];
  expect(findFutureBySymbol(served, "cngn-30nov26")).toBe(NOV);
  expect(findFutureBySymbol(served, "usdc-cngn-30nov26")).toBe(V1);
  expect(findFutureBySymbol(served, "cNGN-31DEC26")).toBeNull();
  // Spot's symbol is not a future.
  expect(findFutureBySymbol(served, "cNGN-USDC")).toBeNull();
});

test("EURC-USDC is picked by its own base, and never stands in for cNGN-USDC", () => {
  const eurc = {
    base_asset_symbol: "EURC",
    contract_type: "spot",
    market: "EURC-USDC",
    quote_asset_symbol: "USDC",
  };
  expect(findSpotMarket([eurc, ...SERVED], "EURC")?.market).toBe("EURC-USDC");
  expect(findSpotMarket([eurc, ...SERVED])?.market).toBe("cNGN-USDC");
  expect(findSpotMarket([eurc])).toBeNull();
  expect(findSpotMarket(SERVED, "EURC")).toBeNull();
});
