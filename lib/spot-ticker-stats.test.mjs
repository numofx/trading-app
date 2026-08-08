import { expect, test } from "bun:test";
import { get24hStats, getVenueLastPrice } from "./spot-ticker-stats.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-08T09:00:00Z");

function candle(hoursAgo, { open = 1371, high = 1372, low = 1370, close = 1371, volume = 1 } = {}) {
  return { open, high, low, close, time: "x", bucketStartMs: NOW - hoursAgo * HOUR, volume };
}

// The bug: the ticker showed the external NGN/USD oracle rate as "last price". It read 1,364.51
// while the best bid was 1,370.54 — below the book, impossible for a real trade — and it
// pre-filled the order form with a limit that could never cross.
test("last price comes from the venue's own trades, not an external rate", () => {
  const trades = [{ price: 1371.98, side: "buy", size: 1, time: "19:11" }];
  expect(getVenueLastPrice(trades, [candle(1)], 1600)).toBe(1371.98);
});

test("falls back to the last candle close, then the mark, when nothing has traded", () => {
  expect(getVenueLastPrice([], [candle(2, { close: 1370.5 })], 1600)).toBe(1370.5);
  expect(getVenueLastPrice([], [], 1600)).toBe(1600);
  expect(getVenueLastPrice([], [], null)).toBeNull();
});

test("ignores a non-positive or non-finite trade price", () => {
  for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const trades = [{ price, side: "buy", size: 1, time: "x" }];
    expect(getVenueLastPrice(trades, [candle(1, { close: 1371 })], 1600)).toBe(1371);
  }
});

// The other half: "24H volume" summed every candle it was given. With three trades ever, the
// screenshot showed 5 USDC of "24H" volume when only 1.006 USDC had traded that day.
test("24h stats cover only the last 24 hours", () => {
  const candles = [
    candle(40, { volume: 3.969, high: 1372.11, low: 1372.11 }), // outside the window
    candle(30, { volume: 0.073, high: 1400, low: 1300 }), // outside the window
    candle(2, { volume: 1.006, high: 1371.98, low: 1371.98 }),
  ];

  const stats = get24hStats(candles, 1371.98, NOW);
  expect(stats.volumeLabel).toBe("1 USDC");
  expect(stats.high).toBeCloseTo(1371.98, 2);
  expect(stats.low).toBeCloseTo(1371.98, 2);
});

test("a stale candle cannot drag the 24h high or low", () => {
  const stats = get24hStats(
    [candle(48, { high: 9999, low: 1 }), candle(1, { high: 1372, low: 1370 })],
    1371,
    NOW
  );
  expect(stats.high).toBe(1372);
  expect(stats.low).toBe(1370);
});

// Reporting a change or a high/low with nothing to compute them from would be inventing numbers.
test("an empty window reports no stats rather than guessing", () => {
  const stats = get24hStats([candle(48)], 1371.98, NOW);
  expect(stats.changePercent).toBeNull();
  expect(stats.high).toBeNull();
  expect(stats.low).toBeNull();
  expect(stats.volumeLabel).toBe("—");
});

test("change is measured from the first candle in the window", () => {
  const stats = get24hStats([candle(3, { open: 1000 })], 1100, NOW);
  expect(stats.changePercent).toBeCloseTo(10, 6);
});

test("the last price is included in the high and low", () => {
  // A trade after the most recent bucket must still move the range.
  const stats = get24hStats([candle(1, { high: 1372, low: 1370 })], 1380, NOW);
  expect(stats.high).toBe(1380);
});
