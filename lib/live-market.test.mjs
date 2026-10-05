import { expect, test } from "bun:test";
import {
  applyTradesToCandles,
  applyTradesToStats,
  CANDLE_INTERVAL_MS,
  latestTradeMs,
  tradesSince,
} from "./live-market.ts";

const DAY = CANDLE_INTERVAL_MS["1d"];
const T0 = Date.parse("2026-10-05T12:00:00Z");
const trade = (atMs, price, size, side = "buy") => ({ atMs, price, side, size, time: "" });
const candle = (bucketStartMs, close, volume) => ({
  bucketStartMs,
  close,
  high: close,
  low: close,
  open: close,
  time: "10-05",
  volume,
});

test("only trades after the server's newest fill are new, oldest first", () => {
  const server = [trade(T0, 1360, 1), trade(T0 - 60_000, 1359, 1)];
  expect(latestTradeMs(server)).toBe(T0);
  const stream = [trade(T0 + 120_000, 1362, 2), trade(T0 + 60_000, 1361, 1), ...server];
  expect(tradesSince(stream, latestTradeMs(server)).map((t) => t.price)).toEqual([1361, 1362]);
  // A trade with no timestamp cannot be placed in a bucket, so it is left to the next server read.
  expect(tradesSince([{ price: 1, side: "buy", size: 1, time: "" }], 0)).toEqual([]);
  expect(latestTradeMs([])).toBe(0);
});

test("a fill in the open interval extends the last candle; one in a new interval opens a candle", () => {
  const day0 = Math.floor(T0 / DAY) * DAY;
  const candles = [candle(day0, 1360, 10)];
  const same = applyTradesToCandles(candles, [trade(T0 + 1000, 1365, 3)], DAY, "1d");
  expect(same).toHaveLength(1);
  expect(same[0]).toMatchObject({ close: 1365, high: 1365, low: 1360, open: 1360, volume: 13 });
  // The server candles are untouched: the derivation is pure.
  expect(candles[0].volume).toBe(10);

  const next = applyTradesToCandles(candles, [trade(day0 + DAY + 5000, 1350, 2)], DAY, "1d");
  expect(next).toHaveLength(2);
  expect(next[1]).toMatchObject({
    bucketStartMs: day0 + DAY,
    close: 1350,
    high: 1350,
    low: 1350,
    open: 1350,
    time: "10-06",
    volume: 2,
  });
  // No candles at all: the first fill opens the chart.
  expect(applyTradesToCandles([], [trade(T0, 1360, 1)], DAY, "1d")).toHaveLength(1);
  // Nothing new: the same array contents come back.
  expect(applyTradesToCandles(candles, [], DAY, "1d")).toEqual(candles);
});

test("24h stats grow by the fills' notional and widen to their prices", () => {
  const stats = { firstPrice: 1355, high: 1362, low: 1352, quoteVolume: 6 };
  expect(applyTradesToStats(stats, [])).toBe(stats);
  expect(applyTradesToStats(stats, [trade(T0, 1365, 3), trade(T0 + 1, 1350, 1)])).toEqual({
    firstPrice: 1355,
    high: 1365,
    low: 1350,
    quoteVolume: 10,
  });
  // No server stats: the fills are the whole window, measured from the first of them.
  expect(applyTradesToStats(null, [trade(T0, 1365, 3), trade(T0 + 1, 1350, 1)])).toEqual({
    firstPrice: 1365,
    high: 1365,
    low: 1350,
    quoteVolume: 4,
  });
});
