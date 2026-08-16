import { formatNaira } from "@/lib/market-formatting";

/** Account USDC, e.g. "1,240.00"; an em dash until the balance is known. */
export function formatAccountUsdc(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  return value.toLocaleString("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
}

/**
 * Account cNGN in naira. These balances run to seven figures at this pair's rate, which would push
 * the header onto a second line, so a million and up is abbreviated ("₦2.1M") and anything smaller
 * keeps its kobo.
 */
export function formatAccountCngn(value: number | null) {
  if (value === null || !Number.isFinite(value)) {
    return "—";
  }

  if (Math.abs(value) >= 1_000_000) {
    return `₦${value.toLocaleString("en-US", { maximumFractionDigits: 1, notation: "compact" })}`;
  }

  return formatNaira(value);
}

/**
 * What this trader's resting orders have claimed out of the balance, or null when they have claimed
 * nothing worth printing.
 *
 * The note names the claim rather than restating the spendable balance, because the two figures
 * would be the same quantity at different precisions and cNGN's abbreviation loses that contest:
 * ₦2.14M with ₦40k resting prints "₦2.1M" on both sides, so a "free" note would silently agree with
 * the total while the ticket showed ₦40k less. The 1-decimal bucket in the millions is ₦100k wide —
 * around $65 of buying power at this pair's rate — which is far too much to round away. A claim is
 * its own quantity, so it can never collide with the balance beside it.
 */
export function getClaimedNote(
  balance: number | null,
  spendable: number | null,
  format: (value: number | null) => string
) {
  if (balance === null || spendable === null) {
    return null;
  }

  const claimed = Math.max(0, balance - spendable);
  const claimedLabel = format(claimed);
  // Below the note's own precision there is nothing to explain — and nothing the ticket can show
  // either, since `Available` would print the balance back.
  return claimedLabel === format(0) ? null : claimedLabel;
}
