import { expect, test } from "bun:test";
import { getAnchorPrice, presentStats24h } from "./spot-market.ts";
import { get24hStats, getVenueLastPrice } from "./ticker-stats.ts";

const HOUR = 60 * 60 * 1000;
const NOW = Date.parse("2026-08-08T09:00:00Z");

function candle(
  hoursAgo,
  { open = 0.000_729, high = 0.000_73, low = 0.000_728, close = 0.000_729, volume = 1 } = {}
) {
  return { open, high, low, close, bucketStartMs: NOW - hoursAgo * HOUR, time: "x", volume };
}

// The bug: the ticker showed the external NGN/USD oracle rate as "last price". It read 0.0007329
// while the best ask was 0.0007297 — above the book, impossible for a real trade — and it
// pre-filled the order form with a limit that could never cross.
test("last price comes from the venue's own trades, not an external rate", () => {
  const trades = [{ price: 0.000_728_9, side: "buy", size: 1370, time: "19:11" }];
  expect(getVenueLastPrice(trades, [candle(1)], 0.000_75)).toBe(0.000_728_9);
});

test("falls back to the last candle close, then the mark, when nothing has traded", () => {
  expect(getVenueLastPrice([], [candle(2, { close: 0.000_729_7 })], 0.000_75)).toBe(0.000_729_7);
  expect(getVenueLastPrice([], [], 0.000_75)).toBe(0.000_75);
  expect(getVenueLastPrice([], [], null)).toBeNull();
});

test("ignores a non-positive or non-finite trade price", () => {
  for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
    const trades = [{ price, side: "buy", size: 1370, time: "x" }];
    expect(getVenueLastPrice(trades, [candle(1, { close: 0.000_729 })], 0.000_75)).toBe(0.000_729);
  }
});

/** GET /v1/trades `stats_24h` at 2026-09-14 00:14Z: trades #341-#346, all within the last 24 hours. */
const STATS_AFTER_MIDNIGHT = {
  change: "0.000006955101479527",
  high: "0.000753511013055828",
  last: "0.000753511013055828",
  low: "0.000743586296866452",
  quote_volume: "6.000056567690660151",
  volume: "8034",
};

// The bug: at 00:13Z the header read "—" for change, volume, high and low, because the day's candle
// had started more than 24 hours earlier — though every one of the day's six trades had not.
test("the day's trades still count after midnight UTC", () => {
  const stats = get24hStats(presentStats24h(STATS_AFTER_MIDNIGHT), 0.000_753_511_013_055_828);

  // From the window's first trade (last − change, 0.0007466) to the last, 0.0007535: up 0.93%.
  expect(stats.changePercent).toBeCloseTo(0.93, 2);
  expect(stats.high).toBeCloseTo(0.000_753_51, 8);
  expect(stats.low).toBeCloseTo(0.000_743_59, 8);
  expect(stats.volumeLabel).toBe("6 USDC");
});

// A trade streamed after the render still moves the change, rather than it waiting for a refresh.
test("change is measured to the live last price", () => {
  const stats = { firstPrice: 0.0007, high: 0.000_77, low: 0.0007, quoteVolume: 3 };
  expect(get24hStats(stats, 0.000_77).changePercent).toBeCloseTo(10, 6);
});

// Reporting a figure with nothing to compute it from would be inventing a number.
test("no stats, or a quiet window, reports no figures rather than guessing", () => {
  for (const stats of [null, { firstPrice: null, high: null, low: null, quoteVolume: null }]) {
    expect(get24hStats(stats, 0.000_753_5)).toEqual({
      changePercent: null,
      high: null,
      low: null,
      volumeLabel: "—",
    });
  }
});

test("without a last price there is no change to report", () => {
  const stats = { firstPrice: 0.0007, high: 0.000_77, low: 0.0007, quoteVolume: 3 };
  expect(get24hStats(stats, null).changePercent).toBeNull();
});

// The bug: the header showed the venue's last trade with no staleness check at all, so a print from
// 2026-09-14 kept reading 0.0007534 two days later while the whole book rested between 0.0007234
// and 0.0007347 and the order ticket was seeded at 0.0007288. The header now shows what the order
// book already centres on: the mid, else the one resting side, else the last trade.
test("the headline price follows the book, not a stale print", () => {
  const staleTrade = 0.000_753_4;
  expect(getAnchorPrice(0.000_730_3, 0.000_727_4, staleTrade)).toBeCloseTo(0.000_728_85, 10);
});

test("with one side resting, the headline price is that side rather than the last trade", () => {
  expect(getAnchorPrice(0.000_730_3, null, 0.000_753_4)).toBe(0.000_730_3);
  expect(getAnchorPrice(null, 0.000_727_4, 0.000_753_4)).toBe(0.000_727_4);
});

// An empty book is the only case where a days-old print is still the best answer available.
test("with no book at all it falls back to the last trade", () => {
  expect(getAnchorPrice(null, null, 0.000_753_4)).toBe(0.000_753_4);
  expect(getAnchorPrice(null, null, null)).toBeNull();
});
