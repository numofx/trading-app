import { getAddress, parseAbiItem } from "viem";
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

/** Emitted by Matching when a subaccount is deposited; carries the created account id. */
export const depositedSubAccountEvent = parseAbiItem(
  "event DepositedSubAccount(uint indexed accountId, address indexed owner)",
);

export function getMatchingAddress() {
  return getAddress(process.env.NEXT_PUBLIC_MATCHING_ADDRESS?.trim() || DEFAULT_MATCHING_ADDRESS);
}

/** WLWrappedERC20Asset contract — the deposit target and spender for direct deposits. */
export function getWrappedUsdcAssetAddress() {
  return getAddress(process.env.NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS?.trim() || DEFAULT_WRAPPED_USDC_ASSET_ADDRESS);
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
      DEFAULT_USDC_TOKEN_ADDRESS,
  );
}

export function getSubaccountCreatorAddress() {
  return getAddress(process.env.NEXT_PUBLIC_SUBACCOUNT_CREATOR_ADDRESS?.trim() || DEFAULT_SUBACCOUNT_CREATOR_ADDRESS);
}

export function getUsdcCngnManagerAddress() {
  return getAddress(process.env.NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS?.trim() || DEFAULT_USDCCNGN_MANAGER_ADDRESS);
}

export function getDepositAddresses(): DepositAddresses {
  return {
    baseAssetContract: getWrappedUsdcAssetAddress(),
    manager: getUsdcCngnManagerAddress(),
    subaccountCreator: getSubaccountCreatorAddress(),
    token: getUsdcTokenAddress(),
  };
}
