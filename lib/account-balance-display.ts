/** The two assets this venue holds, and the symbols their balances are printed with. */
export type BalanceSymbol = "cNGN" | "USDC";

/** Rendered when a balance is genuinely unknown — never substitute a zero the account may not hold. */
const UNKNOWN_BALANCE = "—";

/**
 * The figure alone, at the precision that balance is printed to.
 *
 * Exists for the one place that already names the currency beside the number — the ticket's
 * `Available (cNGN)` row — so it can share these rules without printing the symbol twice.
 *
 * cNGN balances run to seven figures at this pair's rate, which would push the header onto a second
 * line, so a million and up is abbreviated ("2.1M") and anything smaller keeps its kobo.
 */
export function formatBalanceFigure(value: number | null, symbol: BalanceSymbol) {
  if (value === null || !Number.isFinite(value)) {
    return UNKNOWN_BALANCE;
  }

  if (symbol === "cNGN" && Math.abs(value) >= 1_000_000) {
    return value.toLocaleString("en-US", { maximumFractionDigits: 1, notation: "compact" });
  }

  return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

/**
 * A balance in ticker form — the figure then its symbol, "1,300 cNGN" and "3.94 USDC".
 *
 * One shape for every holding on screen: the header, the ticket's shortfall note and the Assets tab
 * all read the same way, so two figures for the same asset can no longer look like two different
 * quantities. The ₦ sign stays on *prices*, where naira is the unit a market is quoted in rather
 * than something the account holds — the header previously spent it on both, which made the cNGN
 * balance read as a price.
 */
export function formatBalance(value: number | null, symbol: BalanceSymbol) {
  const figure = formatBalanceFigure(value, symbol);
  return figure === UNKNOWN_BALANCE ? figure : `${figure} ${symbol}`;
}

/** Account USDC, e.g. "3.94 USDC"; an em dash until the balance is known. */
export function formatAccountUsdc(value: number | null) {
  return formatBalance(value, "USDC");
}

/** Account cNGN, e.g. "1,300 cNGN", abbreviated past a million; an em dash until it is known. */
export function formatAccountCngn(value: number | null) {
  return formatBalance(value, "cNGN");
}

/**
 * What this trader's resting orders have claimed out of the balance, or null when they have claimed
 * nothing worth printing.
 *
 * The note names the claim rather than restating the spendable balance, because the two figures
 * would be the same quantity at different precisions and cNGN's abbreviation loses that contest:
 * 2.14M cNGN with 40k resting prints "2.1M cNGN" on both sides, so a "free" note would silently
 * agree with the total while the ticket showed 40k less. The 1-decimal bucket in the millions is
 * 100k cNGN wide — around $65 of buying power at this pair's rate — which is far too much to round
 * away. A claim is its own quantity, so it can never collide with the balance beside it.
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
