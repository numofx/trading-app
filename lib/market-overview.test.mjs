import { expect, test } from "bun:test";
import {
  buildOverviewRow,
  emptyOverviewRow,
  filterTerminalMarkets,
  formatFundingRate,
  formatOpenInterest,
  formatOverviewVolume,
  getTerminalMarket,
  selectorMarkets,
} from "./market-overview.ts";

const OFFERED = selectorMarkets("USDC-cNGN-30NOV26");

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

test("the selector offers spot and the venue's front-month future; the perp is not offered", () => {
  expect(OFFERED.map((entry) => [entry.id, entry.href, entry.kind, entry.symbol])).toEqual([
    ["spot", "/trade/cngn-usdc", "spot", "cNGN-USDC"],
    ["future", "/trade/usdc-cngn-30nov26", "futures", "USDC-cNGN-30NOV26"],
  ]);
  // No future listed: spot alone.
  expect(selectorMarkets(null).map((entry) => entry.id)).toEqual(["spot"]);
  expect(filterTerminalMarkets(OFFERED, "perp", "")).toEqual([]);
  expect(filterTerminalMarkets(OFFERED, "futures", "").map((e) => e.id)).toEqual(["future"]);
});

test("the perp still names itself in the pill on its own page, reached at /perp", () => {
  expect(getTerminalMarket("perp")).toMatchObject({
    href: "/trade/cngn-perp",
    symbol: "cNGN-PERP",
  });
  expect(getTerminalMarket("future", "USDC-cNGN-31DEC26").href).toBe("/trade/usdc-cngn-31dec26");
});

test("search is case-insensitive, ignores the separators and matches every typed word", () => {
  expect(filterTerminalMarkets(OFFERED, "spot", "usdc cngn").length).toBe(1);
  expect(filterTerminalMarkets(OFFERED, "spot", "CNGN-USDC").length).toBe(1);
  expect(filterTerminalMarkets(OFFERED, "futures", "30nov").length).toBe(1);
  expect(filterTerminalMarkets(OFFERED, "futures", "usdc cngn 30nov26").length).toBe(1);
  expect(filterTerminalMarkets(OFFERED, "spot", "btc").length).toBe(0);
});

test("a row prices off the mid, measures the change from the window's first trade to its last, and carries the volume", () => {
  const row = buildOverviewRow(
    "spot",
    market({
      asks: [level(0.000_734)],
      bids: [level(0.000_73)],
      stats24h: { firstPrice: 0.000_725, high: 0.000_735, low: 0.000_724, quoteVolume: 12_500 },
      trades: [{ price: 0.000_732 }],
    }),
    null
  );
  expect(row.price).toBeCloseTo(0.000_732, 12);
  expect(row.changePercent24h).toBeCloseTo((0.000_007 / 0.000_725) * 100, 6);
  expect(row.volume24hUsd).toBe(12_500);
  expect(row.openInterestUsd).toBeNull();
  expect(row.fundingRate1h).toBeNull();
});

test("a perp row falls back to the mark when nothing rests or traded, and carries its own figures", () => {
  const row = buildOverviewRow("perp", market(), {
    markPrice: 0.000_735_6,
    openInterestUsd: 7200,
    uiLongFundingRate1h: 0.000_012_5,
  });
  expect(row.price).toBe(0.000_735_6);
  expect(row.changePercent24h).toBeNull();
  expect(row.openInterestUsd).toBe(7200);
  expect(row.fundingRate1h).toBe(0.000_012_5);
  // Resting depth wins over the mark, as it does in the perp's own header.
  expect(
    buildOverviewRow("perp", market({ asks: [level(0.000_73)] }), {
      markPrice: 0.000_735_6,
      openInterestUsd: 0,
      uiLongFundingRate1h: 0,
    }).price
  ).toBe(0.000_73);
});

test("a market the venue is not serving is every figure null, never a guess", () => {
  expect(emptyOverviewRow("spot")).toEqual({
    changePercent24h: null,
    fundingRate1h: null,
    id: "spot",
    lastTradeAtMs: null,
    openInterestUsd: null,
    price: null,
    symbol: null,
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
});

test("a future row falls back to its mark, counts volume as contracts at their USDC size, and carries the last trade time", () => {
  const row = buildOverviewRow(
    "future",
    market({ stats24h: { firstPrice: null, high: null, low: null, quoteVolume: 9700 } }),
    null,
    {
      contractSizeUsdc: 1000,
      lastTradeAtMs: 1_796_043_600_000,
      markPrice: 1386.8,
      symbol: "USDC-cNGN-30NOV26",
      volumeContracts: 7,
    }
  );
  expect(row.price).toBe(1386.8);
  // The venue's quote volume on the future is price × contracts, not money; it is never shown.
  expect(row.volume24hUsd).toBe(7000);
  expect(row.lastTradeAtMs).toBe(1_796_043_600_000);
  expect(row.symbol).toBe("USDC-cNGN-30NOV26");
  expect(row.fundingRate1h).toBeNull();
});
