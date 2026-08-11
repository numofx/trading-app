import { getAddress, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { getAppChain } from "@/lib/base-public-client";
import type { DepositAddresses, DepositCurrency } from "@/lib/subaccount-deposit.types";

/**
 * Address plumbing for the subaccount deposit flow (Base Sepolia defaults).
 *
 * Terminology follows the risk-core deployment artifacts, which is easy to invert:
 * - "base asset" / `base` = the WLWrappedERC20Asset contract that holds deposits
 * - `wrappedAsset` = the underlying ERC-20 token pulled from the wallet
 */

const DEFAULT_WRAPPED_USDC_ASSET_ADDRESS = "0xdC3f31B61a2128B3D1ECB8b6f6d0DE82eBd6c7Ae";
const DEFAULT_USDC_TOKEN_ADDRESS = "0x8b3C43D2b2555ca3fc4Fa1BC34544133B8576110";
const DEFAULT_SUBACCOUNT_CREATOR_ADDRESS = "0x5448B304AD283f24A741B54AE9b3a71C8d7DCDF2";
const DEFAULT_USDCCNGN_MANAGER_ADDRESS = "0x1917960763BF3a0DfA10a05f0a112E828C1A934f";
const DEFAULT_MATCHING_ADDRESS = "0x1599636347FD5bA1fBE21D58AfE0b8B9cbe283FF";

/**
 * SubAccounts ERC-721 ledger — holds every subaccount's per-asset balances and is
 * the source of truth for deposited/traded funds (Matching.subAccounts()). Wallet
 * ERC-20 balances do NOT reflect deposits; only this ledger does.
 */
const DEFAULT_SUBACCOUNTS_ADDRESS_MAINNET = "0x7019244e25fa416e6ca2ed2f3ca25277aef72843";
const DEFAULT_SUBACCOUNTS_ADDRESS_SEPOLIA = "0xdEEF5903FEfEEde7A4F4369050AFd228dFB3E9c0";

/** Numo CashAsset — deposited USDC is minted into this per-subaccount cash balance. */
const DEFAULT_CASH_ASSET_ADDRESS_MAINNET = "0x6b232a2155bd0c9bf741db4cf8e7e8a0176a6fc6";
/**
 * cNGN deployment per chain, mirroring `risk-core/deployments/<chainId>/WRAPPED_CNGN.json`
 * (`asset` is the artifact's `base`, `token` its `wrappedAsset`).
 *
 * Kept as a pair because the two must match: the escrow only accepts the exact ERC-20 it wraps,
 * and Base Sepolia hosts two unrelated contracts both calling themselves cNGN — the one this
 * venue wraps (18 decimals) and `0xe2387F04d3858e7Cb64Ef5Ed6617f9B2fcEEAfa2` (6 decimals), which
 * the app previously pointed at. Approving the wrong one leaves a deposit that cannot settle, so
 * these are only ever read together.
 *
 * Both `asset` entries are verified on-chain: `wrappedAsset()` returns the paired token,
 * `deposit(uint256,uint256)` is present, and neither has a `wlEnabled()` gate. The mainnet asset
 * is also the spot market's `asset_address` from `GET /v1/markets`, so cNGN deposits and cNGN
 * orders settle against one escrow.
 */
const CNGN_DEPLOYMENTS = {
  mainnet: {
    asset: "0x9d806fd040a719d27a8e5e77dc5ae0ed1e089493",
    token: "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F",
  },
  sepolia: {
    asset: "0x1c08f30c204EE18EbBDc161c0f0864AFb826934b",
    token: "0x6B232A2155Bd0C9bf741dB4cf8E7e8A0176A6fc6",
  },
} as const;

function getCngnDeployment() {
  return isAppMainnet() ? CNGN_DEPLOYMENTS.mainnet : CNGN_DEPLOYMENTS.sepolia;
}

function isAppMainnet() {
  return getAppChain().id === base.id;
}

/** Emitted by Matching when a subaccount is deposited; carries the created account id. */
export const depositedSubAccountEvent = parseAbiItem(
  "event DepositedSubAccount(uint indexed accountId, address indexed owner)"
);

export function getMatchingAddress() {
  return getAddress(process.env.NEXT_PUBLIC_MATCHING_ADDRESS?.trim() || DEFAULT_MATCHING_ADDRESS);
}

/** WLWrappedERC20Asset contract — the deposit target and spender for direct deposits. */
export function getWrappedUsdcAssetAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS?.trim() || DEFAULT_WRAPPED_USDC_ASSET_ADDRESS
  );
}

/**
 * Underlying USDC ERC-20 token. Falls back to the legacy
 * NEXT_PUBLIC_USDC_DELIVERABLE_BASE_ASSET_ADDRESS env, whose deployed value has always
 * been the token address despite the "base asset" name.
 */
export function getUsdcTokenAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_USDC_TOKEN_ADDRESS?.trim() ||
      process.env.NEXT_PUBLIC_USDC_DELIVERABLE_BASE_ASSET_ADDRESS?.trim() ||
      DEFAULT_USDC_TOKEN_ADDRESS
  );
}

export function getSubaccountCreatorAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_SUBACCOUNT_CREATOR_ADDRESS?.trim() || DEFAULT_SUBACCOUNT_CREATOR_ADDRESS
  );
}

export function getUsdcCngnManagerAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS?.trim() || DEFAULT_USDCCNGN_MANAGER_ADDRESS
  );
}

/** SubAccounts ERC-721 ledger address for the active chain (env override wins). */
export function getSubaccountsAddress() {
  const override = process.env.NEXT_PUBLIC_SUBACCOUNTS_ADDRESS?.trim();
  if (override) {
    return getAddress(override);
  }
  return getAddress(
    isAppMainnet() ? DEFAULT_SUBACCOUNTS_ADDRESS_MAINNET : DEFAULT_SUBACCOUNTS_ADDRESS_SEPOLIA
  );
}

/**
 * CashAsset address used to label the USDC cash leg of a subaccount balance.
 * Returns null when unknown for the active chain (only mainnet has a baked-in default),
 * in which case the cash balance is left unlabeled rather than guessed.
 */
export function getCashAssetAddress(): `0x${string}` | null {
  const override = process.env.NEXT_PUBLIC_CASH_ASSET_ADDRESS?.trim();
  if (override) {
    return getAddress(override);
  }
  return isAppMainnet() ? getAddress(DEFAULT_CASH_ASSET_ADDRESS_MAINNET) : null;
}

/**
 * Underlying cNGN ERC-20 held in the user's wallet — the cNGN counterpart to
 * {@link getUsdcTokenAddress}, and the token {@link getCngnAssetAddress} wraps. Decimals differ by
 * chain (6 on mainnet, 18 on Sepolia), so never assume: read them from the token.
 */
export function getCngnTokenAddress(): `0x${string}` {
  const configured = process.env.NEXT_PUBLIC_CNGN_TOKEN_ADDRESS?.trim();
  if (configured) {
    return getAddress(configured);
  }
  return getAddress(getCngnDeployment().token);
}

/**
 * cNGN WrappedERC20Asset for the active chain: the contract a cNGN deposit approves and pays into,
 * and the asset id labeling the cNGN leg of a subaccount balance. Both chains have a deployment,
 * so this always resolves.
 */
export function getCngnAssetAddress(): `0x${string}` {
  const override = process.env.NEXT_PUBLIC_CNGN_ASSET_ADDRESS?.trim();
  if (override) {
    return getAddress(override);
  }
  return getAddress(getCngnDeployment().asset);
}

/**
 * Deposit plumbing for one currency.
 *
 * Both currencies share the manager and the creator periphery; only the escrow contract and the
 * ERC-20 pulled from the wallet differ. The machine reads decimals off the token, so nothing
 * downstream assumes 6.
 */
export function getDepositAddresses(currency: DepositCurrency): DepositAddresses {
  const shared = {
    manager: getUsdcCngnManagerAddress(),
    subaccountCreator: getSubaccountCreatorAddress(),
  };

  if (currency === "USDC") {
    return {
      ...shared,
      baseAssetContract: getWrappedUsdcAssetAddress(),
      token: getUsdcTokenAddress(),
    };
  }

  return {
    ...shared,
    baseAssetContract: getCngnAssetAddress(),
    token: getCngnTokenAddress(),
  };
}

/** The currencies this deployment can accept, in display order. */
export function getDepositableCurrencies(): DepositCurrency[] {
  return ["USDC", "cNGN"];
}
