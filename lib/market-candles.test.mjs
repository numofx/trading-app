import { expect, test } from "bun:test";

import { formatCandleTimeLabel, toUiCandle, toUiCandles } from "./market-candles.ts";

const futuresCandle = {
  bucket_start: "2026-07-19T13:00:00Z",
  close: "1381",
  high: "1385",
  low: "1377",
  open: "1379",
  quote_volume: "16548",
  trade_count: 12,
  volume: "12",
};

test("futures candles pass engine values through and use base volume", () => {
  const candle = toUiCandle(futuresCandle, "future", "1h");

  expect(candle).toEqual({
    bucketStartMs: Date.parse("2026-07-19T13:00:00Z"),
    close: 1381,
    high: 1385,
    low: 1377,
    open: 1379,
    time: "13:00",
    volume: 12,
  });
});

// `time` is a display label and cannot be compared, so windowed stats (24h high, low, volume)
// depend on this timestamp being the real bucket start.
test("carries the bucket start as a comparable timestamp", () => {
  expect(toUiCandle(futuresCandle, "future", "1h").bucketStartMs).toBe(
    Date.parse("2026-07-19T13:00:00Z")
  );

  const spot = toUiCandle(
    {
      ...futuresCandle,
      bucket_start: "2026-07-22T17:00:00Z",
      close: "0.0007",
      high: "0.0007",
      low: "0.0007",
      open: "0.0007",
    },
    "spot",
    "1h"
  );
  expect(spot.bucketStartMs).toBe(Date.parse("2026-07-22T17:00:00Z"));

  // A label can fall back to the raw string, but a timestamp cannot — an unparseable bucket would
  // otherwise become NaN and silently drop the candle out of every window comparison.
  expect(toUiCandle({ ...futuresCandle, bucket_start: "not-a-date" }, "future", "1h")).toBeNull();
});

test("spot candles keep the engine's prices, USDC per cNGN, with high still the high", () => {
  const candle = toUiCandle(
    {
      bucket_start: "2026-07-22T17:00:00Z",
      close: "0.00073",
      high: "0.00075",
      low: "0.0007",
      open: "0.00072",
      quote_volume: "250",
      trade_count: 3,
      volume: "342000",
    },
    "spot",
    "1h"
  );

  expect(candle.high).toBe(0.000_75);
  expect(candle.low).toBe(0.0007);
  expect(candle.open).toBe(0.000_72);
  expect(candle.close).toBe(0.000_73);
  expect(candle.high).toBeGreaterThan(candle.low);
});

test("spot volume is the USDC that changed hands (quote_volume), not the cNGN count", () => {
  const candle = toUiCandle(
    {
      bucket_start: "2026-07-22T17:00:00Z",
      close: "0.0007",
      high: "0.0007",
      low: "0.0007",
      open: "0.0007",
      quote_volume: "250",
      trade_count: 1,
      volume: "342000",
    },
    "spot",
    "1h"
  );

  expect(candle.volume).toBe(250);
});

test("drops candles that cannot be represented instead of emitting Infinity", () => {
  const zeroPriced = {
    bucket_start: "2026-07-22T17:00:00Z",
    close: "0",
    high: "0",
    low: "0",
    open: "0",
    quote_volume: "0",
    trade_count: 1,
    volume: "0",
  };

  expect(toUiCandle(zeroPriced, "spot", "1h")).toBeNull();
  expect(toUiCandles([zeroPriced, futuresCandle], "future", "1h")).toHaveLength(2);
  expect(toUiCandles([zeroPriced], "spot", "1h")).toHaveLength(0);
});

test("labels are UTC and interval-aware", () => {
  expect(formatCandleTimeLabel("2026-07-19T13:05:00Z", "1h")).toBe("13:05");
  expect(formatCandleTimeLabel("2026-07-19T00:00:00Z", "1d")).toBe("07-19");
  expect(formatCandleTimeLabel("not-a-date", "1h")).toBe("not-a-date");
});

test("perp candles are shown like spot's: USDC per cNGN as served, USDC volume", () => {
  const [candle] = toUiCandles(
    [
      {
        bucket_start: "2026-09-29T00:00:00Z",
        close: "0.0008",
        high: "0.001",
        low: "0.0005",
        open: "0.0008",
        quote_volume: "12",
        trade_count: 1,
        volume: "15000",
      },
    ],
    "perp",
    "1d"
  );
  expect(candle?.close).toBe(0.0008);
  expect(candle?.high).toBe(0.001);
  expect(candle?.low).toBe(0.0005);
  expect(candle?.volume).toBe(12);
});
