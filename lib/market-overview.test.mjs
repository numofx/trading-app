import { expect, test } from "bun:test";
import {
  buildOverviewRow,
  emptyOverviewRow,
  filterTerminalMarkets,
  formatFundingRate,
  formatMaxLeverage,
  formatOpenInterest,
  formatOverviewVolume,
  TERMINAL_MARKETS,
} from "./market-overview.ts";

function market({ asks = [], bids = [], trades = [], stats24h = null, mark = null } = {}) {
  return {
    candles: [],
    mark,
    openOrders: [],
    orderBookAsks: asks,
    orderBookBids: bids,
    orderEntrySpec: null,
    orderStack: null,
    stats24h,
    takerFeeBps: null,
    trades,
  };
}

const level = (price) => ({ price, size: 1, total: 1 });

test("the selector offers spot at / and the perp at /perp, each under its own tab", () => {
  expect(TERMINAL_MARKETS.map((entry) => [entry.id, entry.href, entry.kind])).toEqual([
    ["spot", "/", "spot"],
    ["perp", "/perp", "perp"],
  ]);
  expect(filterTerminalMarkets(TERMINAL_MARKETS, "spot", "").map((e) => e.id)).toEqual(["spot"]);
  expect(filterTerminalMarkets(TERMINAL_MARKETS, "perp", "").map((e) => e.id)).toEqual(["perp"]);
});

test("search is case-insensitive and ignores the separators", () => {
  expect(filterTerminalMarkets(TERMINAL_MARKETS, "perp", "usdc").length).toBe(1);
  expect(filterTerminalMarkets(TERMINAL_MARKETS, "perp", "CNGN-PERP").length).toBe(1);
  expect(filterTerminalMarkets(TERMINAL_MARKETS, "spot", "usdc cngn").length).toBe(1);
  expect(filterTerminalMarkets(TERMINAL_MARKETS, "spot", "perp").length).toBe(0);
  expect(filterTerminalMarkets(TERMINAL_MARKETS, "spot", "btc").length).toBe(0);
});

test("a row prices off the mid, measures the change from the window's first trade, and carries the volume", () => {
  const row = buildOverviewRow(
    "spot",
    market({
      asks: [level(1362)],
      bids: [level(1358)],
      stats24h: { firstPrice: 1350, high: 1365, low: 1349, quoteVolume: 12_500 },
    }),
    null
  );
  expect(row.price).toBe(1360);
  expect(row.changePercent24h).toBeCloseTo((10 / 1350) * 100, 9);
  expect(row.volume24hUsd).toBe(12_500);
  expect(row.openInterestUsd).toBeNull();
  expect(row.fundingRate1h).toBeNull();
  expect(row.maxLeverage).toBeNull();
});

test("a perp row falls back to the mark when nothing rests or traded, and carries its own figures", () => {
  const row = buildOverviewRow("perp", market(), {
    markPrice: 1359.5,
    maxLeverage: 10,
    openInterestUsd: 7200,
    uiLongFundingRate1h: 0.000_012_5,
  });
  expect(row.price).toBe(1359.5);
  expect(row.changePercent24h).toBeNull();
  expect(row.openInterestUsd).toBe(7200);
  expect(row.fundingRate1h).toBe(0.000_012_5);
  expect(row.maxLeverage).toBe(10);
  // Resting depth wins over the mark, as it does in the perp's own header.
  expect(
    buildOverviewRow("perp", market({ asks: [level(1370)] }), {
      markPrice: 1359.5,
      maxLeverage: 10,
      openInterestUsd: 0,
      uiLongFundingRate1h: 0,
    }).price
  ).toBe(1370);
});

test("a market the venue is not serving is every figure null, never a guess", () => {
  expect(emptyOverviewRow("spot")).toEqual({
    changePercent24h: null,
    fundingRate1h: null,
    id: "spot",
    maxLeverage: null,
    openInterestUsd: null,
    price: null,
    volume24hUsd: null,
  });
  expect(buildOverviewRow("spot", market(), null).price).toBeNull();
});

test("the cells format like the rest of the terminal, with a dash for what was not served", () => {
  expect(formatOverviewVolume(null)).toBe("—");
  expect(formatOverviewVolume(12_500)).toBe("12.5K USDC");
  expect(formatOpenInterest(null)).toBe("—");
  expect(formatOpenInterest(0)).toBe("0 USDC");
  expect(formatOpenInterest(7200)).toBe("7.2K USDC");
  expect(formatFundingRate(null)).toBe("—");
  expect(formatFundingRate(0)).toBe("0%/h");
  expect(formatFundingRate(0.000_012_5)).toBe("+0.0013%/h");
  expect(formatFundingRate(-0.000_012_5)).toBe("-0.0013%/h");
  expect(formatMaxLeverage(null)).toBeNull();
  expect(formatMaxLeverage(10)).toBe("Up to 10x");
  expect(formatMaxLeverage(2.5)).toBe("Up to 2.5x");
});
