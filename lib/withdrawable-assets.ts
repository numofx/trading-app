import {
  getCngnAssetAddress,
  getCngnTokenAddress,
  getUsdcTokenAddress,
  getWrappedUsdcAssetAddress,
} from "@/lib/subaccount-deposit-config";

/**
 * One escrow an account can be paid out of.
 *
 * Withdrawals are keyed by escrow rather than by the deposit currency: the escrow is the contract a
 * withdrawal is called on, and the id the ledger reports a balance under.
 */
export type WithdrawableAsset = {
  /** The contract the withdrawal is called on, and the id the ledger reports a balance under. */
  escrow: `0x${string}`;
  /** Stable selection key. */
  id: string;
  /** Row label in the picker. */
  label: string;
  /** Ticker shown beside the amount. */
  symbol: string;
  /** The ERC-20 that lands in the wallet; its decimals denominate the withdrawal. */
  token: `0x${string}`;
};

/**
 * Everything an account can withdraw, in display order: the wrapped-USDC escrow the spot engine
 * settles in, then cNGN. The same on Base mainnet and Sepolia.
 *
 * The legacy USDC CashAsset (`0x6B232A21…6fc6`), which spot settled in before 2026-09-10, is
 * deliberately not offered. Its ledger claims far exceed the USDC it holds, so a withdrawal from it
 * cannot be paid, and listing it — at zero for nearly every account — only suggested a second USDC
 * balance to go looking for. Do not add it back until that escrow can pay out.
 */
export function getWithdrawableAssets(): WithdrawableAsset[] {
  return [
    {
      escrow: getWrappedUsdcAssetAddress(),
      id: "usdc",
      label: "USDC",
      symbol: "USDC",
      token: getUsdcTokenAddress(),
    },
    {
      escrow: getCngnAssetAddress(),
      id: "cngn",
      label: "cNGN",
      symbol: "cNGN",
      token: getCngnTokenAddress(),
    },
  ];
}

export function findWithdrawableAsset(id: string) {
  return getWithdrawableAssets().find((asset) => asset.id === id) ?? null;
}

/**
 * The account's balance of one escrow, straight off the ledger rows.
 *
 * Returns null rather than zero when the ledger has not been read, so "nothing to withdraw" and
 * "not loaded yet" stay distinguishable — the withdraw form hides Max on one and not the other.
 */
export function getAssetLedgerUnits(
  rows: { asset: string; balance: bigint }[] | null,
  escrow: `0x${string}`
) {
  if (rows === null) {
    return null;
  }

  const row = rows.find((entry) => entry.asset.toLowerCase() === escrow.toLowerCase());
  return row === undefined ? 0n : row.balance;
}

/**
 * Another escrow holding the same ticker, when the chosen one cannot pay.
 *
 * It applies only when the list names two escrows for one ticker, as it did while the legacy USDC
 * CashAsset was offered beside the wrapped one. Today's list has one escrow per ticker, so this finds
 * nothing; the progress panel's "switch" offer stays dormant until a ticker has two escrows again.
 *
 * Deliberately says nothing about whether the alternative will settle — only that a balance exists
 * there. Solvency is not knowable without simulating, which happens when they try it.
 */
export function findSiblingAssetWithBalance({
  assets,
  current,
  rows,
}: {
  assets: WithdrawableAsset[];
  current: WithdrawableAsset;
  rows: { asset: string; balance: bigint }[] | null;
}) {
  return (
    assets.find(
      (asset) =>
        asset.id !== current.id &&
        asset.symbol === current.symbol &&
        (getAssetLedgerUnits(rows, asset.escrow) ?? 0n) > 0n
    ) ?? null
  );
}
