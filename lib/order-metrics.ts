import { TAKER_FEE_RATE } from "@/lib/future-order-submission";

export type OrderMetrics = {
  fees: number | null;
  initialMargin: number | null;
};

/**
 * What the order costs, given a USDC notional and the venue's initial-margin rate.
 *
 * Both are null when no usable size has been entered. `0.00 USDC` next to an enabled submit
 * button reads as "this trade is free"; what it actually means is "you have not said how much
 * yet". The ticket already distinguishes known-zero from unknown everywhere else — `Position`
 * shows `Flat` for a real zero and `—` for an unreadable ledger — and this is the last place
 * where the two looked the same.
 *
 * Margin is posted as USDC collateral and the taker fee is charged on the USDC notional, so both
 * are sized off the notional rather than the quote-currency order value. The fee quote reuses the
 * tier that bounds `worstFee` on submission, so the ticket cannot under-quote what gets signed.
 */
export function getOrderMetrics(
  sizeUsdcNotional: string,
  initialMarginRate: number | null
): OrderMetrics {
  const sizeNumber = Number(sizeUsdcNotional || "0");

  if (!Number.isFinite(sizeNumber) || sizeNumber <= 0) {
    return { fees: null, initialMargin: null };
  }

  return {
    fees: sizeNumber * Number(TAKER_FEE_RATE),
    initialMargin: initialMarginRate === null ? null : sizeNumber * initialMarginRate,
  };
}
