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
    close: 1381,
    high: 1385,
    low: 1377,
    open: 1379,
    time: "13:00",
    bucketStartMs: Date.parse("2026-07-19T13:00:00Z"),
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
    { ...futuresCandle, bucket_start: "2026-07-22T17:00:00Z", close: "0.0007", high: "0.0007", low: "0.0007", open: "0.0007" },
    "spot",
    "1h"
  );
  expect(spot.bucketStartMs).toBe(Date.parse("2026-07-22T17:00:00Z"));

  // A label can fall back to the raw string, but a timestamp cannot — an unparseable bucket would
  // otherwise become NaN and silently drop the candle out of every window comparison.
  expect(toUiCandle({ ...futuresCandle, bucket_start: "not-a-date" }, "future", "1h")).toBeNull();
});

test("spot inverts price and swaps high/low", () => {
  // Engine low 0.0007 is the *highest* displayed price (1/0.0007 ~= 1428.57).
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

  expect(candle.high).toBeCloseTo(1 / 0.0007, 6);
  expect(candle.low).toBeCloseTo(1 / 0.00075, 6);
  expect(candle.open).toBeCloseTo(1 / 0.00072, 6);
  expect(candle.close).toBeCloseTo(1 / 0.00073, 6);
  // high must remain >= low after inversion, which is the whole point of the swap.
  expect(candle.high).toBeGreaterThan(candle.low);
});

test("spot uses quote volume (USDC notional), not base volume", () => {
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
