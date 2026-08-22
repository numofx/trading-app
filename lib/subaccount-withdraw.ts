import { parseUnits } from "viem";

const DECIMAL_INPUT_PATTERN = /^(\d+(\.\d+)?|\.\d+)$/;
const WALLET_REJECTION_PATTERN = /user rejected|user denied|rejected the request/i;

/** Drops fraction digits the token cannot represent, without rounding. */
function truncateToDecimals(value: string, decimals: number) {
  const [whole, fraction] = value.split(".");

  if (fraction === undefined) {
    return value;
  }

  return decimals === 0 ? whole : `${whole}.${fraction.slice(0, decimals)}`;
}

export type WithdrawAmount =
  | { kind: "ok"; amountUnits: bigint }
  | { kind: "invalid"; reason: string };

/** A balance carries its own scale, because the ledger's is not the token's. */
export type ScaledBalance = { decimals: number; units: bigint };

/**
 * Restates a balance in the token's decimals, rounding **down**.
 *
 * Down matters: this is the number Max fills in and the ceiling the amount is checked against, and
 * rounding a 3.942881792831387705 ledger balance up to 3.942882 would ask the escrow for more than
 * the account holds.
 */
export function toTokenUnits(balance: ScaledBalance, tokenDecimals: number) {
  if (balance.decimals === tokenDecimals) {
    return balance.units;
  }

  if (balance.decimals > tokenDecimals) {
    return balance.units / 10n ** BigInt(balance.decimals - tokenDecimals);
  }

  return balance.units * 10n ** BigInt(tokenDecimals - balance.decimals);
}

/**
 * Validates a withdrawal against what the account actually holds.
 *
 * The two numbers can arrive in different scales — the input is in the token's decimals, the
 * account balance in the ledger's 18 — so both are normalized to token units first, in integers.
 * Neither side is ever formatted into a float to be compared.
 */
export function validateWithdrawAmount({
  amountInput,
  balance,
  currency,
  tokenDecimals,
}: {
  amountInput: string;
  /** The account's balance of this asset, in whatever scale the caller holds it, or null. */
  balance: ScaledBalance | null;
  /** Ticker for the copy, e.g. "USDC". */
  currency: string;
  tokenDecimals: number;
}): WithdrawAmount {
  const trimmed = amountInput.trim().replaceAll(",", "");

  if (!DECIMAL_INPUT_PATTERN.test(trimmed)) {
    return { kind: "invalid", reason: `Enter a valid ${currency} amount` };
  }

  let amountUnits: bigint;
  try {
    // Truncate rather than let parseUnits round: rounding the last digit up turns "withdraw
    // everything I have" into a request for a fraction more than the account holds.
    amountUnits = parseUnits(truncateToDecimals(trimmed, tokenDecimals), tokenDecimals);
  } catch {
    return { kind: "invalid", reason: `Enter a valid ${currency} amount` };
  }

  if (amountUnits <= 0n) {
    return { kind: "invalid", reason: "Enter an amount greater than zero." };
  }

  if (balance === null) {
    return { kind: "invalid", reason: `Your ${currency} account balance could not be read.` };
  }

  if (amountUnits > toTokenUnits(balance, tokenDecimals)) {
    return { kind: "invalid", reason: `That is more ${currency} than the account holds.` };
  }

  return { amountUnits, kind: "ok" };
}

/**
 * Turns a chain error into something a trader can act on.
 *
 * The one worth naming is an escrow that cannot pay out: the account's claim is real but the
 * contract holding the tokens is short, which is the venue's problem and not something retrying
 * or a smaller amount will fix. Saying "nothing was sent" matters because the simulation runs
 * before the wallet prompt — there is no failed transaction and no gas spent.
 */
export function describeWithdrawFailure(message: string, currency: string) {
  if (message.includes("transfer amount exceeds balance")) {
    return `The venue's ${currency} escrow is short of tokens, so this withdrawal cannot settle right now. Nothing was sent — ask the venue operator.`;
  }

  if (WALLET_REJECTION_PATTERN.test(message)) {
    return "You rejected the transaction in your wallet.";
  }

  return message;
}
