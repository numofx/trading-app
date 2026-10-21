import { expect, test } from "bun:test";
import {
  buildOverviewRow,
  emptyOverviewRow,
  filterTerminalMarkets,
  formatFundingRate,
  formatOpenInterest,
  formatOverviewVolume,
  getTerminalMarket,
  listedFutureSymbols,
  listedSpotMarkets,
  selectorMarkets,
} from "./market-overview.ts";

const OFFERED = selectorMarkets(["USDC-cNGN-30NOV26"]);

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

test("the selector offers spot and the venue's future series; the perp is not offered", () => {
  expect(OFFERED.map((entry) => [entry.id, entry.href, entry.kind, entry.symbol])).toEqual([
    ["spot", "/trade/cngn-usdc", "spot", "USDC-cNGN"],
    ["future", "/trade/usdc-cngn-30nov26", "futures", "USDC-cNGN-30NOV26"],
  ]);
  // No future listed: spot alone.
  expect(selectorMarkets([]).map((entry) => entry.id)).toEqual(["spot"]);
  expect(filterTerminalMarkets(OFFERED, "perp", "")).toEqual([]);
  expect(filterTerminalMarkets(OFFERED, "futures", "").map((e) => e.id)).toEqual(["future"]);
});

test("the series list nearest expiry first, keeping the one on screen when the venue omits it", () => {
  const row = (symbol, expiryMs) => ({ ...emptyOverviewRow("future"), expiryMs, symbol });
  const futures = [
    row("USDC-cNGN-31MAY27", 1_811_772_000_000),
    row("USDC-cNGN-30NOV26", 1_796_047_200_000),
  ];
  expect(listedFutureSymbols(futures, null)).toEqual(["USDC-cNGN-30NOV26", "USDC-cNGN-31MAY27"]);
  // The page's own series, matched without regard to case, is not listed twice.
  expect(listedFutureSymbols(futures, "usdc-cngn-30nov26")).toHaveLength(2);
  // One the venue no longer lists (expired, still on screen) stays, at the end.
  expect(listedFutureSymbols(futures, "USDC-cNGN-30SEP26").at(-1)).toBe("USDC-cNGN-30SEP26");
  expect(listedFutureSymbols([], null)).toEqual([]);
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

test("a spot row prices off the mid in cNGN per USDC, measures the change the same way up, and carries the USDC volume", () => {
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
  // the engine's mid, 0.000732 USDC per cNGN, is 1,366.12 cNGN per USDC; the change of that price
  // from the first trade (1/0.000725) to the last (1/0.000732) is a fall, as cNGN strengthened
  expect(row.price).toBeCloseTo(1 / 0.000_732, 6);
  expect(row.changePercent24h).toBeCloseTo((0.000_725 / 0.000_732 - 1) * 100, 6);
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
    expiryMs: null,
    fundingRate1h: null,
    id: "spot",
    indexPrice: null,
    lastTradeAtMs: null,
    markPrice: null,
    markSource: null,
    openInterestUsd: null,
    price: null,
    settled: null,
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

test("a future row falls back to its mark, counts volume in the venue's USDC units, and carries its times", () => {
  const future = {
    expiryMs: 1_796_047_200_000,
    indexPrice: 1365.44,
    lastTradeAtMs: 1_796_043_600_000,
    markPrice: 1386.8,
    markSource: "book",
    openInterestUsd: 2,
    settled: false,
    symbol: "USDC-cNGN-30NOV26",
    unitUsdc: 1,
    volumeUnits: 7,
  };
  const row = buildOverviewRow(
    "future",
    market({ stats24h: { firstPrice: null, high: null, low: null, quoteVolume: 9700 } }),
    null,
    future
  );
  expect(row.price).toBe(1386.8);
  // The venue's quote volume on the future is price × size, not money; it is never shown. Its
  // volume counts 1 USDC units since the venue sized the future in USDC (2026-10-15).
  expect(row.volume24hUsd).toBe(7);
  // A venue still sizing in whole contracts counts 1,000 USDC a unit.
  expect(
    buildOverviewRow("future", market(), null, { ...future, unitUsdc: 1000 }).volume24hUsd
  ).toBe(7000);
  expect(row.expiryMs).toBe(1_796_047_200_000);
  // The stats bar's inputs ride along, so the selector computes its columns the bar's way.
  expect(row).toMatchObject({
    indexPrice: 1365.44,
    markPrice: 1386.8,
    markSource: "book",
    openInterestUsd: 2,
    settled: false,
  });
  expect(row.lastTradeAtMs).toBe(1_796_043_600_000);
  expect(row.symbol).toBe("USDC-cNGN-30NOV26");
  expect(row.fundingRate1h).toBeNull();
});

test("EURC-USDC is offered under Spot once the venue serves a row for it, or while it is on screen", () => {
  expect(listedSpotMarkets([emptyOverviewRow("spot")], "spot")).toEqual([]);
  expect(listedSpotMarkets([emptyOverviewRow("spot"), emptyOverviewRow("eurc")], "spot")).toEqual([
    "eurc",
  ]);
  expect(listedSpotMarkets([], "eurc")).toEqual(["eurc"]);
  const offered = selectorMarkets(["USDC-cNGN-30NOV26"], ["eurc"]);
  expect(offered.map((entry) => [entry.id, entry.href, entry.kind, entry.symbol])).toEqual([
    ["spot", "/trade/cngn-usdc", "spot", "USDC-cNGN"],
    ["eurc", "/trade/eurc-usdc", "spot", "EURC-USDC"],
    ["future", "/trade/usdc-cngn-30nov26", "futures", "USDC-cNGN-30NOV26"],
  ]);
  expect(getTerminalMarket("eurc").symbol).toBe("EURC-USDC");
});

test("EURC-USDC's row is priced as it trades, USDC per EURC, not turned over", () => {
  const row = buildOverviewRow(
    "eurc",
    market({ asks: [level(1.1736)], bids: [level(1.173)] }),
    null
  );
  expect(row.price).toBeCloseTo(1.1733, 9);
  expect(buildOverviewRow("spot", market({ asks: [level(0.0008)], bids: [level(0.0008)] }), null).price).toBeCloseTo(1250, 6);
});
