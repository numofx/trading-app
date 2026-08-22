import { getAddress } from "viem";
import { base } from "viem/chains";
import { getAppChain } from "@/lib/base-public-client";
import { getCngnAssetAddress, getCngnTokenAddress } from "@/lib/subaccount-deposit-config";

/**
 * One escrow an account can be paid out of.
 *
 * Withdrawals are keyed by escrow rather than by the deposit currency, because the two are not
 * one-to-one: Base mainnet holds USDC in two separate assets — the CashAsset the spot engine
 * settles in, and a plain wrapped-USDC escrow — and an account can hold a balance in either. Only
 * naming both makes the second one reachable.
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

const USDC_TOKEN_MAINNET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

/**
 * The wrapped-USDC escrow (`WRAPPED_USDC_DELIVERABLE`), distinct from the CashAsset.
 *
 * Verified on Base mainnet: `wrappedAsset()` is canonical USDC, it holds the tokens backing its
 * ledger claims, and it has no `netSettledCash` — it is a plain `WrappedERC20Asset`, not cash.
 */
const WRAPPED_USDC_ASSET_MAINNET = "0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84";

/**
 * Everything an account can withdraw, in display order.
 *
 * Both USDC entries are listed because their balances are separate and neither substitutes for the
 * other: cash is what trading settles in, and the wrapped escrow is where earlier deposits landed.
 * A trader with a balance in one and not the other would otherwise be told they have nothing.
 */
export function getWithdrawableAssets(): WithdrawableAsset[] {
  const cngn: WithdrawableAsset = {
    escrow: getCngnAssetAddress(),
    id: "cngn",
    label: "cNGN",
    symbol: "cNGN",
    token: getCngnTokenAddress(),
  };

  if (getAppChain().id !== base.id) {
    return [
      {
        escrow: getAddress(
          process.env.NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS?.trim() ||
            "0xdC3f31B61a2128B3D1ECB8b6f6d0DE82eBd6c7Ae"
        ),
        id: "usdc",
        label: "USDC",
        symbol: "USDC",
        token: getAddress(
          process.env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS?.trim() ||
            "0x8b3C43D2b2555ca3fc4Fa1BC34544133B8576110"
        ),
      },
      cngn,
    ];
  }

  return [
    {
      escrow: getAddress(
        process.env.NEXT_PUBLIC_CASH_ASSET_ADDRESS?.trim() ||
          "0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6"
      ),
      id: "usdc-cash",
      label: "USDC",
      symbol: "USDC",
      token: getAddress(process.env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS?.trim() || USDC_TOKEN_MAINNET),
    },
    {
      escrow: getAddress(WRAPPED_USDC_ASSET_MAINNET),
      id: "usdc-wrapped",
      label: "Wrapped USDC",
      symbol: "USDC",
      token: getAddress(USDC_TOKEN_MAINNET),
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
