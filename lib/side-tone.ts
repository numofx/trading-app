import type { CellTone } from "@/lib/trading.types";

/**
 * The one colour rule for a side, wherever one is shown: a buy of cNGN (the perp's long) takes the
 * buy colour, a sell the sell colour, whatever words the cell or button carries. The
 * ticket's submit button, the positions tab, open orders and both history tabs all go through it.
 */
export function sideTone(side: "buy" | "sell"): CellTone {
  return side === "buy" ? "positive" : "negative";
}
