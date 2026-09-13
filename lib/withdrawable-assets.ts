import { getAddress } from "viem";
import { base } from "viem/chains";
import { getAppChain } from "@/lib/base-public-client";
import {
  getCngnAssetAddress,
  getCngnTokenAddress,
  getUsdcTokenAddress,
  getWrappedUsdcAssetAddress,
} from "@/lib/subaccount-deposit-config";

/**
 * One escrow an account can be paid out of.
 *
 * Withdrawals are keyed by escrow rather than by the deposit currency, because the two are not
 * one-to-one: Base mainnet holds USDC in two separate assets — the wrapped-USDC escrow the spot
 * engine settles in, and the legacy CashAsset it settled in before 2026-09-10 — and an account can
 * hold a balance in either. Only naming both makes the second one reachable.
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
 * The legacy USDC CashAsset. Nothing deposits into or settles in it any more; it is listed so
 * balances left there stay withdrawable once it can pay.
 */
const LEGACY_CASH_ASSET_MAINNET = "0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6";

/**
 * Everything an account can withdraw, in display order.
 *
 * Both mainnet USDC entries are listed because their balances are separate and neither substitutes
 * for the other: the wrapped escrow is what deposits fund and trading settles in, and the CashAsset
 * holds whatever earlier trading left there. A trader with a balance in one and not the other would
 * otherwise be told they have nothing.
 */
export function getWithdrawableAssets(): WithdrawableAsset[] {
  const usdc: WithdrawableAsset = {
    escrow: getWrappedUsdcAssetAddress(),
    id: "usdc-wrapped",
    label: "USDC",
    symbol: "USDC",
    token: getUsdcTokenAddress(),
  };
  const cngn: WithdrawableAsset = {
    escrow: getCngnAssetAddress(),
    id: "cngn",
    label: "cNGN",
    symbol: "cNGN",
    token: getCngnTokenAddress(),
  };

  if (getAppChain().id !== base.id) {
    return [{ ...usdc, id: "usdc" }, cngn];
  }

  return [
    usdc,
    {
      escrow: getAddress(
        process.env.NEXT_PUBLIC_CASH_ASSET_ADDRESS?.trim() || LEGACY_CASH_ASSET_MAINNET
      ),
      id: "usdc-cash",
      label: "Legacy USDC",
      symbol: "USDC",
      token: getUsdcTokenAddress(),
    },
    cngn,
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
 * Mainnet's two USDC escrows are the reason this exists: an account can hold a claim on both, one
 * of them can be short of tokens, and the trader has no way to know the other row is the live one.
 * Offering it turns a dead end into the next tap.
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
