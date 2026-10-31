import { expect, test } from "bun:test";
import { expectedTakerPrice, slippageBps, summarizeTakerFill } from "./order-fill.ts";

/** Trades #527 and #529 (2026-10-31), with a second fill and another taker's trade beside them. */
const TRADES = [
  { price: "0.000728885148513665", size: "13719", taker_order_id: "spot-e2a7044b" },
  { price: "0.000722204955954796", size: "28", taker_order_id: "future-f33732ac" },
  { price: "0.000723", size: "12", taker_order_id: "future-f33732ac" },
];

test("summarizeTakerFill averages only the order's own fills, weighted by size", () => {
  const fill = summarizeTakerFill(TRADES, "future-f33732ac");
  expect(fill?.filledUnits).toBe(40);
  expect(fill?.averagePrice).toBeCloseTo((28 * 0.000_722_204_955_954_796 + 12 * 0.000_723) / 40, 15);
  expect(summarizeTakerFill(TRADES, "spot-e2a7044b")?.filledUnits).toBe(13_719);
  expect(summarizeTakerFill(TRADES, "absent")).toBeNull();
});

test("slippageBps is positive when the fill is worse than expected, on either side", () => {
  expect(slippageBps("buy", 1.115, 1.116)).toBeCloseTo(8.97, 2);
  expect(slippageBps("buy", 1.116, 1.115)).toBeCloseTo(-8.96, 2);
  expect(slippageBps("sell", 1.116, 1.115)).toBeCloseTo(8.96, 2);
  expect(slippageBps("buy", null, 1.115)).toBeNull();
});

test("expectedTakerPrice is the touch the order crosses", () => {
  const touch = { bestAsk: 1.1156, bestBid: 1.1142 };
  expect(expectedTakerPrice("buy", touch)).toBe(1.1156);
  expect(expectedTakerPrice("sell", touch)).toBe(1.1142);
});
