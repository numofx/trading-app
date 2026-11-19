import { parseUnits } from "viem";

type TransferMode = "deposit" | "withdraw";

export const USDC_DECIMALS = 6;
/** The engine's cash is 18 decimals; USDC moves in 6. */
const CASH_TO_USDC = 10n ** 12n;

/** A typed amount as 6-dp USDC: null when it does not parse, 0 when empty. */
export function parseUsdcAmount(text: string): bigint | null {
  const trimmed = text.trim().replace(",", ".");
  if (trimmed === "") {
    return 0n;
  }
  try {
    const value = parseUnits(trimmed, USDC_DECIMALS);
    return value < 0n ? null : value;
  } catch {
    return null;
  }
}

/** What the custodian account can pay out, in 6-dp USDC, from its 18-dp cash: rounded down, never negative. */
export function withdrawableUsdc(cashUnits: bigint | null): bigint {
  return cashUnits === null || cashUnits <= 0n ? 0n : cashUnits / CASH_TO_USDC;
}

/** Why the amount cannot be sent, or null when it can. */
export function custodyAmountError(
  mode: TransferMode,
  amount: bigint | null,
  available: bigint | null
): string | null {
  if (amount === null) {
    return "Enter a number.";
  }
  if (amount === 0n) {
    return "Enter an amount.";
  }
  if (available !== null && amount > available) {
    return mode === "deposit"
      ? "More than the wallet holds."
      : "More than the account can withdraw.";
  }
  return null;
}

/**
 * Which account the terminal shows, trades and funds. With onchain custody on, the custodian's, and every
 * Deposit goes there (opening it on the first). Except while the Matching account holds a position: that
 * account stays in front, trading and funded as before, until it is flat, so the position can always be
 * closed and topped up. A Matching balance left behind gets its own withdraw-only row.
 */
export function custodyRouting(input: {
  custodyAccountId: string | null;
  custodyEnabled: boolean;
  matchingPositionUnits: bigint | null;
  matchingSubaccountId: string | null;
}): { subaccountId: string | null; viaCustody: boolean } {
  const matchingBusy =
    input.matchingSubaccountId !== null && (input.matchingPositionUnits ?? 0n) !== 0n;
  const viaCustody = input.custodyEnabled && !matchingBusy;
  return {
    subaccountId:
      viaCustody && input.custodyAccountId !== null
        ? input.custodyAccountId
        : input.matchingSubaccountId,
    viaCustody,
  };
}
