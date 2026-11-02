import type { OptionOverviewRow } from "@/lib/option-chain";

/**
 * A bought option's profit and loss at expiry against the settlement price, in USDC: what it pays at settlement less
 * everything paid for it. The line has one kink, at the strike, so three points draw it exactly.
 */
export type OptionPayoff = {
  breakeven: number;
  /** The most it can lose: the premium and fee. */
  maxLoss: number;
  /** The most it can make; null for a call, whose payoff has no ceiling. */
  maxProfit: number | null;
  /** Settlement price and profit, ascending in price. */
  points: { pnl: number; settlement: number }[];
};

const RANGE_PADDING = 0.15;

export function optionPnlAt(
  row: Pick<OptionOverviewRow, "optionType" | "strike">,
  settlement: number,
  size: number,
  cost: number
) {
  const intrinsic =
    row.optionType === "call"
      ? Math.max(0, settlement - row.strike)
      : Math.max(0, row.strike - settlement);
  return size * intrinsic - cost;
}

/**
 * The payoff of buying `size` for `cost` in all, over a range holding the strike, the breakeven and the forward. Null
 * without a size and a cost to draw it from.
 */
export function buildOptionPayoff({
  cost,
  forward,
  row,
  size,
}: {
  cost: number | null;
  forward: number | null;
  row: Pick<OptionOverviewRow, "optionType" | "strike">;
  size: number | null;
}): OptionPayoff | null {
  if (cost === null || size === null || !(cost > 0) || !(size > 0)) {
    return null;
  }
  const isCall = row.optionType === "call";
  const breakeven = row.strike + (isCall ? cost / size : -cost / size);
  const anchors = [row.strike, breakeven, ...(forward === null ? [] : [forward])];
  const low = Math.max(0, Math.min(...anchors) * (1 - RANGE_PADDING));
  const high = Math.max(...anchors) * (1 + RANGE_PADDING);
  return {
    breakeven,
    maxLoss: cost,
    maxProfit: isCall ? null : size * row.strike - cost,
    points: [low, row.strike, high].map((settlement) => ({
      pnl: optionPnlAt(row, settlement, size, cost),
      settlement,
    })),
  };
}

/** A USDC amount at the precision a small option needs: `$12.40`, `-$0.034`. */
export function formatPayoffUsd(value: number) {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs === 0) {
    return "$0";
  }
  return `${sign}$${abs >= 1 ? abs.toFixed(2) : abs.toPrecision(2)}`;
}
