import type { OrderBookLevel } from "@/lib/trading.types";

/**
 * Which asset the ladder's Amount and Total columns are counted in.
 *
 * `base` is USDC notional — the size a spot order is entered in. `quote` restates the same resting
 * depth as the cNGN it would change hands for, which is the number a trader funding from a naira
 * balance actually cares about. Both are derived from the venue's own levels; neither invents depth.
 */
export type LadderUnit = "base" | "quote";

/**
 * The price increments the ladder can be grouped by, coarsest last.
 *
 * The venue quotes cNGN per USDC to two decimals, so `0.01` is the raw book: grouping at that tick
 * is a no-op and every level rests exactly where the ladder shows it.
 */
export const PRICE_GROUPS = [0.01, 0.1, 1, 10] as const;

export type PriceGroup = (typeof PRICE_GROUPS)[number];

/** One rendered ladder row: a price bucket, the depth resting in it, and the running total. */
export type LadderRow = {
  amount: number;
  price: number;
  total: number;
};

/** Prices are money, not floats — bucketing at 0.1 must not produce 1375.3000000000002. */
function roundPrice(value: number) {
  return Math.round(value * 1e8) / 1e8;
}

function roundAmount(value: number) {
  return Math.round(value * 1000) / 1000;
}

/**
 * The bucket a price falls in, rounded away from the touch so a grouped level never claims a
 * better price than anything resting in it: asks round up, bids round down.
 */
function bucketPrice(price: number, side: "ask" | "bid", tick: number) {
  const steps = price / tick;
  // Guard the float: a price that is already an exact multiple must stay in its own bucket.
  const bucket = side === "ask" ? Math.ceil(steps - 1e-9) : Math.floor(steps + 1e-9);
  return roundPrice(bucket * tick);
}

/**
 * The ladder rows for one side, ordered from the touch outward.
 *
 * Grouping merges the venue's real levels into `tick`-wide buckets; it never adds a price that
 * nothing rests at. Totals accumulate from the touch, so a row's total is what an order sweeping
 * to that price would take — and in `quote` units it is the cNGN that sweep would cost, summed at
 * each level's own price rather than by multiplying the base total by one of them.
 */
export function buildLadderRows({
  levels,
  side,
  tick,
  unit,
}: {
  levels: OrderBookLevel[];
  side: "ask" | "bid";
  tick: number;
  unit: LadderUnit;
}): LadderRow[] {
  const sizeByBucket = new Map<number, number>();
  const notionalByBucket = new Map<number, number>();

  for (const level of levels) {
    if (!(Number.isFinite(level.price) && Number.isFinite(level.size))) {
      continue;
    }
    const bucket = bucketPrice(level.price, side, tick);
    sizeByBucket.set(bucket, (sizeByBucket.get(bucket) ?? 0) + level.size);
    notionalByBucket.set(bucket, (notionalByBucket.get(bucket) ?? 0) + level.size * level.price);
  }

  const prices = [...sizeByBucket.keys()].sort((left, right) =>
    side === "ask" ? left - right : right - left
  );

  let runningTotal = 0;
  return prices.map((price) => {
    const amount =
      unit === "base" ? (sizeByBucket.get(price) ?? 0) : (notionalByBucket.get(price) ?? 0);
    runningTotal += amount;
    return {
      amount: roundAmount(amount),
      price,
      total: roundAmount(runningTotal),
    };
  });
}

/**
 * The widest bar on a side. The last row carries the full cumulative depth, so it is the max by
 * construction; `1` keeps an empty side from dividing by zero.
 */
export function getMaxLadderTotal(rows: LadderRow[]) {
  return Math.max(...rows.map((row) => row.total), 1);
}

/**
 * The spread in basis points of the mid — the unit a stablecoin FX trader quotes it in, where a
 * percentage of a ~1375 price rounds to noise.
 */
export function getSpreadBps(bestAsk: number | null, bestBid: number | null) {
  if (bestAsk === null || bestBid === null) {
    return null;
  }

  const mid = (bestAsk + bestBid) / 2;
  if (!Number.isFinite(mid) || mid <= 0) {
    return null;
  }

  return ((bestAsk - bestBid) / mid) * 10_000;
}
