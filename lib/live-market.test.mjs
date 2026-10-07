import { expect, test } from "bun:test";
import {
  applyTradesToCandles,
  applyTradesToStats,
  CANDLE_INTERVAL_MS,
  formatTradeStamp,
  latestTradeId,
  mergeTrades,
  tradesSince,
} from "./live-market.ts";

const DAY = CANDLE_INTERVAL_MS["1d"];
const T0 = Date.parse("2026-10-05T12:00:00Z");
let nextId = 1;
/** A fill of `size` cNGN at `price` USDC per cNGN. */
const trade = (atMs, price, size, side = "buy") => ({ atMs, id: nextId++, price, side, size, time: "" });
const candle = (bucketStartMs, close, volume) => ({
  bucketStartMs,
  close,
  high: close,
  low: close,
  open: close,
  time: "10-05",
  volume,
});

test("a streamed fill is new when its id is past the server's newest, even in the same second", () => {
  // Two fills recorded in the same second: the server rendered with the first (id 10), the second
  // (id 11) arrived on the stream afterwards. Timestamps cannot tell them apart; ids can.
  const sameSecond = { atMs: T0, price: 0.000_73, side: "buy", size: 1000, time: "" };
  const server = [{ ...sameSecond, id: 10 }, { ...sameSecond, atMs: T0 - 60_000, id: 9, price: 0.000_729 }];
  expect(latestTradeId(server)).toBe(10);
  const stream = [{ ...sameSecond, id: 11, price: 0.000_731 }, ...server];
  expect(tradesSince(stream, latestTradeId(server)).map((t) => t.id)).toEqual([11]);
  // Execution order, not arrival order, when more than one is new.
  const later = [{ ...sameSecond, id: 13, price: 0.000_733 }, { ...sameSecond, id: 12, price: 0.000_732 }];
  expect(tradesSince([...later, ...stream], 10).map((t) => t.id)).toEqual([11, 12, 13]);
  // A fill with no id cannot be told from one the server had, so it waits for the next server read.
  expect(tradesSince([{ atMs: T0, price: 0.000_73, side: "buy", size: 1, time: "" }], 0)).toEqual([]);
  expect(latestTradeId([])).toBe(0);
});

test("a fill in the open interval extends the last candle; one in a new interval opens a candle", () => {
  const day0 = Math.floor(T0 / DAY) * DAY;
  const candles = [candle(day0, 0.000_73, 10)];
  const same = applyTradesToCandles(candles, [trade(T0 + 1000, 0.000_735, 1000)], DAY, "1d");
  expect(same).toHaveLength(1);
  expect(same[0]).toMatchObject({ close: 0.000_735, high: 0.000_735, low: 0.000_73, open: 0.000_73 });
  // Sizes are cNGN, so the candle's USDC volume grows by size × price: 1,000 cNGN at 0.000735.
  expect(same[0].volume).toBeCloseTo(10.735, 9);
  // The server candles are untouched: the derivation is pure.
  expect(candles[0].volume).toBe(10);

  const next = applyTradesToCandles(candles, [trade(day0 + DAY + 5000, 0.000_725, 2000)], DAY, "1d");
  expect(next).toHaveLength(2);
  expect(next[1]).toMatchObject({
    bucketStartMs: day0 + DAY,
    close: 0.000_725,
    high: 0.000_725,
    low: 0.000_725,
    open: 0.000_725,
    time: "10-06",
  });
  expect(next[1].volume).toBeCloseTo(1.45, 9);
  // No candles at all: the first fill opens the chart.
  expect(applyTradesToCandles([], [trade(T0, 0.000_73, 1000)], DAY, "1d")).toHaveLength(1);
  // Nothing new: the same array contents come back.
  expect(applyTradesToCandles(candles, [], DAY, "1d")).toEqual(candles);
});

test("24h stats grow by the fills' USDC value and widen to their prices", () => {
  const stats = { firstPrice: 0.000_728, high: 0.000_732, low: 0.000_726, quoteVolume: 6 };
  expect(applyTradesToStats(stats, [])).toBe(stats);
  const grown = applyTradesToStats(stats, [trade(T0, 0.000_735, 1000), trade(T0 + 1, 0.000_725, 2000)]);
  expect(grown).toMatchObject({ firstPrice: 0.000_728, high: 0.000_735, low: 0.000_725 });
  // 6 USDC + 1,000 × 0.000735 + 2,000 × 0.000725.
  expect(grown.quoteVolume).toBeCloseTo(8.185, 9);
  // No server stats: the fills are the whole window, measured from the first of them.
  const alone = applyTradesToStats(null, [trade(T0, 0.000_735, 1000), trade(T0 + 1, 0.000_725, 2000)]);
  expect(alone).toMatchObject({ firstPrice: 0.000_735, high: 0.000_735, low: 0.000_725 });
  expect(alone.quoteVolume).toBeCloseTo(2.185, 9);
});

test("a fill's stamp carries a date only when it is not from the viewer's today", () => {
  const now = Date.parse("2026-10-06T13:10:00+01:00");
  const london = { nowMs: now, timeZone: "Europe/London" };
  expect(formatTradeStamp(Date.parse("2026-10-06T12:08:53Z"), london)).toEqual({
    date: null,
    time: "13:08:53",
  });
  expect(formatTradeStamp(Date.parse("2026-10-05T16:32:13Z"), london)).toEqual({
    date: "Oct 5",
    time: "17:32:13",
  });
  // The day boundary is the viewer's, not UTC's: 23:30 UTC on the 5th is already the 6th in Lagos.
  const lagos = { nowMs: now, timeZone: "Africa/Lagos" };
  expect(formatTradeStamp(Date.parse("2026-10-05T23:30:00Z"), lagos)).toEqual({
    date: null,
    time: "00:30:00",
  });
});

test("the tape is the union of server and streamed fills, newest first, each once", () => {
  // Ids follow execution order: the older fill has the lower id.
  const s2 = { ...trade(T0 - 2000, 0.000_729, 1000), id: 101 };
  const s1 = { ...trade(T0 - 1000, 0.000_73, 1000), id: 102 };
  const server = [s1, s2];
  const streamed = [{ ...s1, price: 0.000_730_5 }, { ...trade(T0, 0.000_731, 2000), id: 103 }];
  const merged = mergeTrades(server, streamed);
  expect(merged.map((t) => t.id)).toEqual([103, 102, 101]);
  // The stream's copy of a shared fill is the one shown.
  expect(merged[1].price).toBe(0.000_730_5);
  // A fill with no id is kept as it came, after the identified ones.
  const legacy = { price: 0.000_73, side: "buy", size: 1, time: "12:00" };
  expect(mergeTrades([legacy], streamed).at(-1)).toBe(legacy);
});
