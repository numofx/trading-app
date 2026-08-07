import { getAddress, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { getAppChain } from "@/lib/base-public-client";
import type { DepositAddresses } from "@/lib/subaccount-deposit.types";

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
/** Numo cNGN-side IAsset — held per subaccount after a USDC->cNGN buy. */
const DEFAULT_CNGN_ASSET_ADDRESS_MAINNET = "0x9d806fd040a719d27a8e5e77dc5ae0ed1e089493";
/** cNGN ERC-20s. Both verified on-chain: name/symbol "cNGN", 6 decimals. */
const DEFAULT_CNGN_TOKEN_ADDRESS_MAINNET = "0x46C85152bFe9f96829aA94755D9f915F9B10EF5F";
const DEFAULT_CNGN_TOKEN_ADDRESS_SEPOLIA = "0xe2387F04d3858e7Cb64Ef5Ed6617f9B2fcEEAfa2";

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
 * Underlying cNGN ERC-20 token held in the user's wallet — the cNGN counterpart to
 * {@link getUsdcTokenAddress}, and distinct from {@link getCngnAssetAddress}, which is the Numo
 * IAsset wrapper on the ledger side. Both chains getAppChain() can return have a verified default,
 * so unlike the ledger-side asset getters this always resolves to an address.
 */
export function getCngnTokenAddress(): `0x${string}` {
  const configured = process.env.NEXT_PUBLIC_CNGN_TOKEN_ADDRESS?.trim();
  if (configured) {
    return getAddress(configured);
  }
  return getAddress(
    isAppMainnet() ? DEFAULT_CNGN_TOKEN_ADDRESS_MAINNET : DEFAULT_CNGN_TOKEN_ADDRESS_SEPOLIA
  );
}

/** cNGN-side IAsset address for labeling the cNGN leg of a subaccount balance, or null if unknown. */
export function getCngnAssetAddress(): `0x${string}` | null {
  const override = process.env.NEXT_PUBLIC_CNGN_ASSET_ADDRESS?.trim();
  if (override) {
    return getAddress(override);
  }
  return isAppMainnet() ? getAddress(DEFAULT_CNGN_ASSET_ADDRESS_MAINNET) : null;
}

export function getDepositAddresses(): DepositAddresses {
  return {
    baseAssetContract: getWrappedUsdcAssetAddress(),
    manager: getUsdcCngnManagerAddress(),
    subaccountCreator: getSubaccountCreatorAddress(),
    token: getUsdcTokenAddress(),
  };
}
