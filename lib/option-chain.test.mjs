import { expect, test } from "bun:test";
import {
  buildOptionChains,
  buildOptionRow,
  formatExpiryDay,
  formatExpiryTab,
  formatPremium,
  formatStrikeRange,
  formatTimeToExpiry,
  formatVol,
  listLiveOptions,
  optionSeries,
  optionUnitBase,
} from "./option-chain.ts";

const EXPIRY = 1_796_047_200; // 30 Nov 2026 14:00 UTC

/** A listing as markets-service serves it (cNGN-30NOV26, 2026-11-02). */
function listing(strike, side, overrides = {}) {
  const letter = side === "call" ? "C" : "P";
  return {
    amount_scale: "1000000000000000000000",
    asset_address: "0xa6a05dc25127cecbc048c7e6cbe35e1c8e503821",
    base_asset_symbol: "cNGN",
    contract_type: "option",
    expiry_timestamp: EXPIRY,
    market: `cNGN-30NOV26-${strike}-${letter}`,
    quote_asset_symbol: "USDC",
    sub_id: "1",
    option: {
      expiry_timestamp: EXPIRY,
      last_trade_time: EXPIRY - 3600,
      option_type: side,
      strike,
      trading_open: true,
      vol_feed_address: "0xf2db01cf76e11a83d8510dacdd69ab62b3bac5e0",
    },
    ...overrides,
  };
}

test("one desired_amount is amount_scale / 1e18 base units: 1e21 is 1,000 cNGN", () => {
  expect(optionUnitBase("1000000000000000000000")).toBe(1000);
  expect(optionUnitBase("1000000000000000000")).toBe(1);
  expect(optionUnitBase("1500000000000000000")).toBeNull();
  expect(optionUnitBase(undefined)).toBeNull();
  expect(optionUnitBase("1e21")).toBeNull();
});

test("a book level of 100 units shows as 100,000 cNGN, never 100", () => {
  const row = buildOptionRow(listing("0.00072", "put"), {
    ask: { price: 0.000_033_8, size: 100 },
    bid: { price: 0.000_028_9, size: 100 },
  });
  expect(row.bidSize).toBe(100_000);
  expect(row.askSize).toBe(100_000);
  expect(row.bid).toBe(0.000_028_9);
  expect(row.optionType).toBe("put");
  expect(row.strike).toBe(0.000_72);
  expect(row.expiryMs).toBe(EXPIRY * 1000);
  expect(row.lastTradeAtMs).toBe((EXPIRY - 3600) * 1000);
  expect(row.tradingOpen).toBe(true);
});

test("a listing without a whole-unit scale shows no size rather than a wrong one", () => {
  const row = buildOptionRow(listing("0.00072", "call", { amount_scale: undefined }), {
    ask: null,
    bid: { price: 0.000_03, size: 5 },
  });
  expect(row.bidSize).toBeNull();
  expect(row.ask).toBeNull();
  expect(row.bid).toBe(0.000_03);
});

test("only unexpired options with a side and a strike are listed", () => {
  const markets = [
    listing("0.00072", "call"),
    {
      ...listing("0.00072", "put"),
      option: { ...listing("0.00072", "put").option, option_type: "straddle" },
    },
    { contract_type: "future", expiry_timestamp: EXPIRY, market: "cNGN-30NOV26" },
    listing("0.00067", "put", {
      expiry_timestamp: 1_700_000_000,
      option: { ...listing("0.00067", "put").option, expiry_timestamp: 1_700_000_000 },
    }),
  ];
  expect(listLiveOptions(markets, Date.UTC(2026, 10, 2)).map((m) => m.market)).toEqual([
    "cNGN-30NOV26-0.00072-C",
  ]);
});

test("rows group into one chain per expiry, strikes ascending, call and put side by side", () => {
  const rows = [
    listing("0.00077", "put"),
    listing("0.00062", "call"),
    listing("0.00077", "call"),
    listing("0.00062", "put"),
  ].map((m) => buildOptionRow(m, { ask: null, bid: null }));
  const [chain, ...rest] = buildOptionChains(rows);
  expect(rest).toEqual([]);
  expect(chain.series).toBe("cNGN-30NOV26");
  expect(chain.strikes.map((s) => s.strikeLabel)).toEqual(["0.00062", "0.00077"]);
  expect(chain.strikes[0].call.symbol).toBe("cNGN-30NOV26-0.00062-C");
  expect(chain.strikes[0].put.symbol).toBe("cNGN-30NOV26-0.00062-P");
});

test("a strike listed on one side only keeps the other empty", () => {
  const [chain] = buildOptionChains([
    buildOptionRow(listing("0.00082", "call"), { ask: null, bid: null }),
  ]);
  expect(chain.strikes[0].put).toBeNull();
  expect(chain.strikes[0].call).not.toBeNull();
});

test("the forward comes from a strike's call and put marks: call - put + strike", () => {
  const rows = [
    buildOptionRow(listing("0.00072", "call"), { ask: null, bid: null, mark: 0.000_04 }),
    buildOptionRow(listing("0.00072", "put"), { ask: null, bid: null, mark: 0.000_03 }),
    buildOptionRow(listing("0.00082", "call"), { ask: null, bid: null, mark: 0.000_01 }),
  ];
  expect(buildOptionChains(rows)[0].forward).toBeCloseTo(0.000_73, 10);
});

test("a chain with no call and put mark at one strike has no forward", () => {
  const rows = [
    buildOptionRow(listing("0.00072", "call"), { ask: null, bid: null, mark: 0.000_04 }),
    buildOptionRow(listing("0.00082", "put"), { ask: null, bid: null, mark: null }),
  ];
  expect(buildOptionChains(rows)[0].forward).toBeNull();
});

test("a chain's summary names its strike count and range", () => {
  const strikes = (...labels) =>
    buildOptionChains(
      labels.map((label) => buildOptionRow(listing(label, "call"), { ask: null, bid: null }))
    )[0].strikes;
  expect(formatStrikeRange(strikes("0.00082", "0.00062", "0.00072"))).toBe(
    "3 strikes, 0.00062-0.00082"
  );
  expect(formatStrikeRange(strikes("0.00072"))).toBe("1 strike, 0.00072");
  expect(formatStrikeRange([])).toBe("—");
});

test("formatting", () => {
  expect(optionSeries("cNGN-30NOV26-0.00072-P")).toBe("cNGN-30NOV26");
  expect(formatPremium(0.000_028_946_2)).toBe("0.00002895");
  expect(formatPremium(null)).toBe("—");
  expect(formatPremium(0)).toBe("—");
  expect(formatVol(0.432)).toBe("43.2%");
  expect(formatVol(null)).toBe("—");
  expect(formatExpiryDay(EXPIRY * 1000)).toBe("Mon Nov 30");
  expect(formatExpiryTab(EXPIRY * 1000, Date.UTC(2026, 10, 2))).toBe("Nov 30");
  expect(formatExpiryTab(EXPIRY * 1000, Date.UTC(2025, 10, 2))).toBe("Nov 30 2026");
  expect(formatTimeToExpiry(EXPIRY * 1000, Date.UTC(2026, 10, 2, 4))).toBe("28d 10h 0m");
  expect(formatTimeToExpiry(EXPIRY * 1000, EXPIRY * 1000 + 1)).toBe("0d 0h 0m");
});
