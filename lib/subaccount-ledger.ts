import { isAddressEqual } from "viem";

/**
 * The two legs an order can spend, in the SubAccounts ledger's 1e18 units. Null means unknown —
 * never "none": a ticket cannot compare an order against a balance it does not have, so it lets
 * the order through.
 */
type LedgerLegs = {
  /** The trade module's quote asset (USDC). */
  cashUnits: bigint | null;
  cngnUnits: bigint | null;
};

/**
 * Reads the two legs off a subaccount's `getAccountBalances` rows.
 *
 * The ledger only lists assets an account has touched, so a missing row is a balance of zero, not
 * an unknown one. Reading it as unknown is what let empty account #19 sign a 1,336 cNGN bid: the
 * ticket's shortfall check had nothing to compare the order against and stood aside. Null is kept
 * for the one thing that really is unknown — a quote asset this chain has not pinned.
 */
export function getLedgerLegs({
  cngnAsset,
  quoteAsset,
  rows,
}: {
  cngnAsset: `0x${string}`;
  quoteAsset: `0x${string}` | null;
  rows: readonly { asset: `0x${string}`; balance: bigint }[];
}): LedgerLegs {
  function balanceOf(asset: `0x${string}`) {
    let balance = 0n;
    for (const row of rows) {
      if (isAddressEqual(row.asset, asset)) {
        balance = row.balance;
      }
    }
    return balance;
  }

  return {
    cashUnits: quoteAsset === null ? null : balanceOf(quoteAsset),
    cngnUnits: balanceOf(cngnAsset),
  };
}

/**
 * The legs a wallet's trading account holds, as far as the order ticket can know.
 *
 * A wallet whose lookup has finished without finding an account holds nothing, and that is zero:
 * submitting would create the account and sign the order against it empty, which the venue accepts
 * and rests as depth that cannot settle. Until the lookup finishes — or when it fails — the answer
 * stays unknown rather than guessing zero and sending a funded trader to the deposit dialog.
 */
export function getAccountLegs({
  balance,
  isAccountResolved,
  subaccountId,
}: {
  /** The ledger read for `subaccountId`, or null while it is outstanding or failed. */
  balance: LedgerLegs | null;
  /** The lookup for the connected wallet has completed. */
  isAccountResolved: boolean;
  subaccountId: string | null;
}): LedgerLegs {
  if (subaccountId === null && isAccountResolved) {
    return { cashUnits: 0n, cngnUnits: 0n };
  }

  return { cashUnits: balance?.cashUnits ?? null, cngnUnits: balance?.cngnUnits ?? null };
}
