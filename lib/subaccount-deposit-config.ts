import { getAddress, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { getAppChain } from "@/lib/base-public-client";
import type { DepositAddresses, DepositCurrency } from "@/lib/subaccount-deposit.types";

/**
 * Address plumbing for the subaccount deposit flow (Base mainnet defaults).
 *
 * Terminology follows the risk-core deployment artifacts, which is easy to invert:
 * - "base asset" / `base` = the WLWrappedERC20Asset contract that holds deposits
 * - `wrappedAsset` = the underlying ERC-20 token pulled from the wallet
 */

/**
 * The matching stack, per chain. These used to be single Sepolia constants, which made a chain
 * flip a silent misconfiguration: none of the Sepolia addresses have code on mainnet, so every
 * deposit and order would have been built against contracts that do not exist.
 *
 * Every mainnet entry is verified on-chain (Base 8453):
 * - `matching` emits the `DepositedSubAccount` / `ModuleAllowed` events this app decodes, and is
 *   the contract the venue's own trades are submitted to.
 * - `subaccountCreator` answers to `createAndDepositSubAccount(address,uint256,address)` and
 *   points back at that same matching and subaccounts pair; accounts 11 and 12 were minted
 *   through it.
 * - `manager` is the StandardManager (SRM) spot moved onto on 2026-09-10. The previous manager,
 *   DeliverableFXManager `0xcE01…4d49`, is deprecated: the settlement vault reverts
 *   `MW_UnknownManager` on its accounts, and SubAccounts has no way to change an account's manager.
 * - `tradeModule` is the wrapped-quote TradeModule, the only module Matching still allows and the
 *   one markets-service pins every order to. The CashAsset-quoted module `0x4481…eD1c` is disabled.
 * - `wrappedUsdcAsset` is that module's `quoteAsset()`: a plain WrappedERC20Asset over canonical
 *   Base USDC (6 decimals), token-backed 1:1 — not the CashAsset, whose accounting is corrupted.
 */
const MATCHING_STACK = {
  mainnet: {
    manager: "0x3195Bd7e02d93982bCF8b34DF5B941fFCaE1E49b",
    matching: "0x9E90A9cD13d859Bd6a08168082FB1F6F7405F191",
    subaccountCreator: "0x568890A8D63Ba8a03b6eCbEedA1bD9f6ea014D5D",
    tradeModule: "0x12423B366F6F07130961900bE00d05Ea63Acd071",
    usdcToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    wrappedUsdcAsset: "0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84",
  },
  sepolia: {
    manager: "0x1917960763BF3a0DfA10a05f0a112E828C1A934f",
    matching: "0x1599636347FD5bA1fBE21D58AfE0b8B9cbe283FF",
    subaccountCreator: "0x5448B304AD283f24A741B54AE9b3a71C8d7DCDF2",
    tradeModule: "0x0AAE65AaA66Fe7f54486cDbD007956d3De611990",
    usdcToken: "0x8b3C43D2b2555ca3fc4Fa1BC34544133B8576110",
    wrappedUsdcAsset: "0xdC3f31B61a2128B3D1ECB8b6f6d0DE82eBd6c7Ae",
  },
} as const;

function getMatchingStack() {
  return isAppMainnet() ? MATCHING_STACK.mainnet : MATCHING_STACK.sepolia;
}

/**
 * SubAccounts ERC-721 ledger — holds every subaccount's per-asset balances and is
 * the source of truth for deposited/traded funds (Matching.subAccounts()). Wallet
 * ERC-20 balances do NOT reflect deposits; only this ledger does.
 */
const DEFAULT_SUBACCOUNTS_ADDRESS_MAINNET = "0x7019244e25fa416e6ca2ed2f3ca25277aef72843";
const DEFAULT_SUBACCOUNTS_ADDRESS_SEPOLIA = "0xdEEF5903FEfEEde7A4F4369050AFd228dFB3E9c0";

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
  return getAddress(
    process.env.NEXT_PUBLIC_MATCHING_ADDRESS?.trim() || getMatchingStack().matching
  );
}

/** WLWrappedERC20Asset contract — the deposit target and spender for direct deposits. */
export function getWrappedUsdcAssetAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_WRAPPED_USDC_ASSET_ADDRESS?.trim() ||
      getMatchingStack().wrappedUsdcAsset
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
      getMatchingStack().usdcToken
  );
}

/**
 * The Matching module orders are submitted through, and the one a new subaccount is created
 * against. Shared so those two can never disagree — a subaccount created against a module the
 * engine does not trade on cannot be filled.
 */
export function getTradeModuleAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_TRADE_MODULE_ADDRESS?.trim() || getMatchingStack().tradeModule
  );
}

export function getSubaccountCreatorAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_SUBACCOUNT_CREATOR_ADDRESS?.trim() ||
      getMatchingStack().subaccountCreator
  );
}

export function getUsdcCngnManagerAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS?.trim() || getMatchingStack().manager
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
 * The asset the trade module settles the USDC leg in, used to label the USDC leg of a subaccount
 * balance. On mainnet that is the wrapped USDC deposit escrow itself, so a deposit and the balance
 * it funds can never be read off different ledgers. Null on Sepolia, where the module's quote
 * asset is not pinned, so the balance is left unlabeled rather than guessed.
 */
export function getQuoteAssetAddress(): `0x${string}` | null {
  return isAppMainnet() ? getWrappedUsdcAssetAddress() : null;
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

/** The currencies this deployment lists, in display order. Some may be paused for deposits. */
export function getDepositableCurrencies(): DepositCurrency[] {
  return ["USDC", "cNGN"];
}

/**
 * Currencies whose deposits are closed, and why.
 *
 * Nothing is paused by default. USDC used to be, because deposits landed in the CashAsset, whose
 * accounting a mis-scaled mint corrupted (0.000001 USDC held against a 1.368e40 claim). USDC
 * deposits now land in the wrapped USDC escrow the trade module settles in, which is token-backed
 * 1:1, so that reason no longer applies to anything a deposit touches.
 *
 * Set `NEXT_PUBLIC_PAUSED_DEPOSIT_CURRENCIES` to close some: a comma-separated list, or `none`.
 * Withdrawals stay open either way.
 */
export function getDepositPauseReason(currency: DepositCurrency): string | null {
  const configured = process.env.NEXT_PUBLIC_PAUSED_DEPOSIT_CURRENCIES?.trim();

  if (configured === undefined || configured === "" || configured.toLowerCase() === "none") {
    return null;
  }

  const paused = configured.split(",").map((entry) => entry.trim().toLowerCase());
  return paused.includes(currency.toLowerCase())
    ? `${currency} deposits are paused. Withdrawals stay open.`
    : null;
}

/** The first currency a deposit can actually be made in, for defaults and fallbacks. */
export function getFirstDepositableCurrency(): DepositCurrency {
  const currencies = getDepositableCurrencies();
  return currencies.find((currency) => getDepositPauseReason(currency) === null) ?? currencies[0];
}
