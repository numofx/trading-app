import { expect, test } from "bun:test";
import {
  buildEmptyRungs,
  buildLadderRows,
  formatLadderAmount,
  getSpreadBps,
} from "./order-book-display.ts";

/** Real-shaped USDC/cNGN depth: cNGN per USDC prices, USDC notional sizes. */
const ASKS = [
  { price: 1376.27, size: 1.2, total: 1.2 },
  { price: 1376.31, size: 0.4, total: 1.6 },
  { price: 1377.02, size: 2, total: 3.6 },
];

const BIDS = [
  { price: 1374.02, size: 1.5, total: 1.5 },
  { price: 1373.98, size: 0.5, total: 2 },
];

test("the raw tick leaves the venue's levels exactly where they rest", () => {
  const rows = buildLadderRows({ levels: ASKS, side: "ask", tick: 0.01, unit: "base" });

  expect(rows.map((row) => row.price)).toEqual([1376.27, 1376.31, 1377.02]);
  expect(rows.map((row) => row.amount)).toEqual([1.2, 0.4, 2]);
});

// Cumulative depth is what an order sweeping to that price would take, so it runs from the touch
// outward: the best price carries only its own size.
test("totals accumulate from the touch outward on both sides", () => {
  const asks = buildLadderRows({ levels: ASKS, side: "ask", tick: 0.01, unit: "base" });
  const bids = buildLadderRows({ levels: BIDS, side: "bid", tick: 0.01, unit: "base" });

  expect(asks.map((row) => row.total)).toEqual([1.2, 1.6, 3.6]);
  expect(bids.map((row) => row.total)).toEqual([1.5, 2]);
});

// Grouping merges real levels; it must never quote a better price than anything resting in the
// bucket, so asks round up and bids round down.
test("grouping rounds each side away from the touch", () => {
  const asks = buildLadderRows({ levels: ASKS, side: "ask", tick: 1, unit: "base" });
  const bids = buildLadderRows({ levels: BIDS, side: "bid", tick: 1, unit: "base" });

  expect(asks).toEqual([
    { amount: 1.6, price: 1377, total: 1.6 },
    { amount: 2, price: 1378, total: 3.6 },
  ]);
  expect(bids).toEqual([
    { amount: 1.5, price: 1374, total: 1.5 },
    { amount: 0.5, price: 1373, total: 2 },
  ]);
});

test("a price already on the tick keeps its own bucket", () => {
  const rows = buildLadderRows({
    levels: [{ price: 1377, size: 1, total: 1 }],
    side: "ask",
    tick: 1,
    unit: "base",
  });

  expect(rows[0].price).toBe(1377);
});

// The cNGN column is each level's own price times its own size — multiplying the cumulative USDC
// total by a single price would misprice every level but one.
test("quote units value each level at its own price", () => {
  const rows = buildLadderRows({ levels: ASKS, side: "ask", tick: 0.01, unit: "quote" });

  expect(rows[0].amount).toBeCloseTo(1376.27 * 1.2, 3);
  expect(rows[1].total).toBeCloseTo(1376.27 * 1.2 + 1376.31 * 0.4, 3);
});

test("an empty side has no rows", () => {
  expect(buildLadderRows({ levels: [], side: "bid", tick: 0.01, unit: "base" })).toEqual([]);
});

test("the spread is quoted in basis points of the mid", () => {
  expect(getSpreadBps(1376.27, 1374.02)).toBeCloseTo((2.25 / 1375.145) * 10_000, 6);
  expect(getSpreadBps(null, 1374.02)).toBeNull();
  expect(getSpreadBps(1376.27, null)).toBeNull();
});

test("ladder sizes keep full precision below ten thousand and abbreviate above, on both markets", () => {
  expect(formatLadderAmount(0.25)).toBe("0.25");
  expect(formatLadderAmount(49.766)).toBe("49.766");
  expect(formatLadderAmount(999.999)).toBe("999.999");
  // The old cut at a thousand printed this as "1K".
  expect(formatLadderAmount(1000)).toBe("1,000");
  expect(formatLadderAmount(9999.5)).toBe("9,999.5");
  expect(formatLadderAmount(10_000)).toBe("10K");
  expect(formatLadderAmount(10_240)).toBe("10.2K");
  expect(formatLadderAmount(1_400_000)).toBe("1.4M");
});

test("a thin side is continued with empty rungs one tick past its last level, never with depth", () => {
  const asks = [
    { amount: 1000, price: 1362.08, total: 1000 },
    { amount: 1000, price: 1365.48, total: 2000 },
    { amount: 1000, price: 1368.88, total: 3000 },
  ];
  const rungs = buildEmptyRungs({ minimum: 6, rows: asks, side: "ask", tick: 0.01 });
  expect(rungs).toEqual([1368.89, 1368.9, 1368.91]);
  // At a whole-naira tick the grouped rows sit on whole prices, and so do the rungs below them.
  const bids = [{ amount: 1000, price: 1355, total: 1000 }];
  expect(buildEmptyRungs({ minimum: 4, rows: bids, side: "bid", tick: 1 })).toEqual([
    1354, 1353, 1352,
  ]);
  // Nothing resting: the empty state speaks, not a grid hanging from no price.
  expect(buildEmptyRungs({ rows: [], side: "ask", tick: 0.01 })).toEqual([]);
  // A side already at the minimum gets no padding.
  expect(buildEmptyRungs({ minimum: 3, rows: asks, side: "ask", tick: 0.01 })).toEqual([]);
});
