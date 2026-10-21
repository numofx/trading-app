import { expect, test } from "bun:test";
import { SPOT_PAIRS } from "./spot-pairs.ts";
import {
  buildSpotHeaderMetrics,
  directLimitPrice,
  engineLimitPrice,
  engineSide,
  formatSpotNairaPrice,
  invertPrice,
  spotOrientation,
  toUsdcCngnBook,
  toUsdcCngnCandles,
  toUsdcCngnOrder,
  toUsdcCngnStats,
  toUsdcCngnTrades,
} from "./spot-orientation.ts";

/** The spot book as the venue served it on 2026-10-14: USDC per cNGN, sizes in cNGN. */
const ENGINE = {
  asks: [
    { price: 0.000_735_2, size: 27_200, total: 27_200 },
    { price: 0.000_736_3, size: 32_700, total: 59_900 },
  ],
  bids: [
    { price: 0.000_732_2, size: 27_200, total: 27_200 },
    { price: 0.000_731_1, size: 32_700, total: 59_900 },
  ],
};

test("a buy of USDC is the engine's sell of cNGN, and the other way", () => {
  expect(engineSide("buy")).toBe("sell");
  expect(engineSide("sell")).toBe("buy");
  expect(invertPrice(0.0008)).toBeCloseTo(1250, 9);
  expect(invertPrice(0)).toBeNull();
  expect(invertPrice(null)).toBeNull();
});

test("the book turns over: engine asks are USDC bids, best first, sized in USDC, totals from the touch", () => {
  const { asks, bids } = toUsdcCngnBook(ENGINE);
  // the best USDC bid is the engine's best ask inverted: the most cNGN offered per USDC
  expect(bids.map((level) => level.price)).toEqual(
    [1 / 0.000_735_2, 1 / 0.000_736_3].sort((a, b) => b - a)
  );
  expect(bids[0].price).toBeCloseTo(1360.17, 2);
  expect(bids[0].size).toBeCloseTo(27_200 * 0.000_735_2, 9);
  expect(bids[1].total).toBeCloseTo(27_200 * 0.000_735_2 + 32_700 * 0.000_736_3, 9);
  // the best USDC ask is the engine's best bid inverted: the fewest cNGN per USDC, lowest first
  expect(asks[0].price).toBeCloseTo(1 / 0.000_732_2, 9);
  expect(asks[0].price).toBeLessThan(asks[1].price);
  expect(asks[1].total).toBeCloseTo(27_200 * 0.000_732_2 + 32_700 * 0.000_731_1, 9);
  // and the book does not cross: every USDC bid sits below every USDC ask
  expect(bids[0].price).toBeLessThan(asks[0].price);
});

test("a trade's aggressor flips and its size is the USDC that changed hands", () => {
  const [trade] = toUsdcCngnTrades([
    { price: 0.000_747_3, side: "buy", size: 1325, time: "18:24" },
  ]);
  expect(trade.side).toBe("sell");
  expect(trade.price).toBeCloseTo(1338.15, 2);
  expect(trade.size).toBeCloseTo(0.990_172_5, 9);
});

test("a candle's high is the engine's low inverted, and its low the engine's high", () => {
  const [candle] = toUsdcCngnCandles([
    {
      bucketStartMs: 0,
      close: 0.000_734,
      high: 0.000_74,
      low: 0.000_73,
      open: 0.000_732,
      time: "10-14",
      volume: 7.3,
    },
  ]);
  expect(candle.high).toBeCloseTo(1 / 0.000_73, 9);
  expect(candle.low).toBeCloseTo(1 / 0.000_74, 9);
  expect(candle.open).toBeCloseTo(1 / 0.000_732, 9);
  expect(candle.close).toBeCloseTo(1 / 0.000_734, 9);
  expect(candle.volume).toBe(7.3);
});

test("24h stats turn over the same way; the USDC volume is kept", () => {
  expect(
    toUsdcCngnStats({ firstPrice: 0.000_725, high: 0.000_735, low: 0.000_724, quoteVolume: 12_500 })
  ).toEqual({
    firstPrice: 1 / 0.000_725,
    high: 1 / 0.000_724,
    low: 1 / 0.000_735,
    quoteVolume: 12_500,
  });
  expect(toUsdcCngnStats(null)).toBeNull();
});

test("a resting engine buy of cNGN is a sell of USDC, sized and filled in USDC, keeping its cancel key", () => {
  const order = {
    expiresAtMs: null,
    filled: 1000,
    nonce: "7",
    orderId: "spot-1",
    ownerAddress: "0xabc",
    price: 0.000_73,
    side: "buy",
    size: 27_400,
  };
  expect(toUsdcCngnOrder(order)).toEqual({
    ...order,
    filled: 1000 * 0.000_73,
    price: 1 / 0.000_73,
    side: "sell",
    size: 27_400 * 0.000_73,
  });
});

/**
 * The limit a trader types (cNGN per USDC) is signed as its inverse in USDC per cNGN, to 18 decimals,
 * rounded so the order can never trade past the limit: a buy of USDC pays at most P cNGN, an engine
 * sell for at least 1/P, rounded up; a sell of USDC takes at least P, an engine buy for at most 1/P,
 * rounded down.
 */
test("the engine limit is the typed limit inverted, rounded never to trade past it", () => {
  // 1/1361.98 = 0.000734224...: 18 decimals, up for a buy of USDC and down for a sell
  const up = engineLimitPrice("1361.98", "buy");
  const down = engineLimitPrice("1361.98", "sell");
  expect(up).toBe("0.000734225172175803");
  expect(down).toBe("0.000734225172175802");
  // the rounding direction is what keeps the limit: priced back, the buy pays no more than 1361.98
  // cNGN per USDC and the sell receives no less
  expect(1 / Number(up)).toBeLessThanOrEqual(1361.98);
  expect(1 / Number(down)).toBeGreaterThanOrEqual(1361.979_999_999);
  // exact inverses do not round
  expect(engineLimitPrice("1250", "buy")).toBe("0.0008");
  expect(engineLimitPrice("1,250.00", "sell")).toBe("0.0008");
  // nothing but a positive decimal signs
  for (const bad of ["", "0", "0.00", "-1", "abc", "1e3"]) {
    expect(engineLimitPrice(bad, "buy")).toBeNull();
  }
});

test("the header reads cNGN per USDC, its change, the USDC volume and the window's extremes", () => {
  expect(formatSpotNairaPrice(1361.982)).toBe("₦1,361.98");
  expect(formatSpotNairaPrice(null)).toBe("—");
  expect(
    buildSpotHeaderMetrics(SPOT_PAIRS.spot, {
      changePercent: -0.4,
      high: 1381.2,
      low: 1360.5,
      price: 1361.98,
      volumeLabel: "7.3",
    })
  ).toEqual([
    { label: "Price", tone: null, tooltip: "cNGN per USDC", value: "₦1,361.98" },
    { label: "24h Change", tone: "down", value: "-0.40%" },
    { label: "24h Volume", tone: null, tooltip: "USDC traded", value: "7.3" },
    { label: "24h High", tone: null, value: "₦1,381.20" },
    { label: "24h Low", tone: null, value: "₦1,360.50" },
  ]);
});

test("a change that rounds to zero reads 0.00%, neither up nor down", () => {
  const [, change] = buildSpotHeaderMetrics(SPOT_PAIRS.spot, {
    changePercent: -0.0004,
    high: null,
    low: null,
    price: 1362.19,
    volumeLabel: "6",
  });
  expect(change).toEqual({ label: "24h Change", tone: null, value: "0.00%" });
});

/** EURC-USDC trades as it is shown: USDC per EURC, sized in EURC, a buy a buy of EURC. */
test("EURC-USDC passes the venue's data through and signs the limit typed", () => {
  const eurc = spotOrientation(SPOT_PAIRS.eurc);
  const book = {
    asks: [{ price: 1.1735, size: 500, total: 500 }],
    bids: [{ price: 1.1731, size: 200, total: 200 }],
  };
  expect(eurc.book(book)).toEqual(book);
  expect(eurc.side("buy")).toBe("buy");
  expect(eurc.price(1.1733)).toBe(1.1733);
  expect(eurc.price(0)).toBeNull();
  expect(eurc.limit("1.17345", "buy")).toBe("1.17345");
  expect(eurc.limit("1,000.5", "sell")).toBe("1000.5");
  // USDC-cNGN still turns over.
  expect(spotOrientation(SPOT_PAIRS.spot).side("buy")).toBe("sell");
});

test("a direct limit is a positive decimal or nothing", () => {
  expect(directLimitPrice("1.17")).toBe("1.17");
  expect(directLimitPrice(" 1.17 ")).toBe("1.17");
  expect(directLimitPrice("0")).toBeNull();
  expect(directLimitPrice("0.000")).toBeNull();
  expect(directLimitPrice("")).toBeNull();
  expect(directLimitPrice("-1")).toBeNull();
  expect(directLimitPrice("1e-3")).toBeNull();
});

test("EURC-USDC's header reads USDC per EURC to five places", () => {
  const [price, , , high] = buildSpotHeaderMetrics(SPOT_PAIRS.eurc, {
    changePercent: 0.1,
    high: 1.174_12,
    low: 1.1702,
    price: 1.173_456,
    volumeLabel: "12.4K",
  });
  expect(price).toEqual({ label: "Price", tone: null, tooltip: "USDC per EURC", value: "$1.17346" });
  expect(high.value).toBe("$1.17412");
});
