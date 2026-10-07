import { getAddress, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { getAppChain } from "@/lib/base-public-client";
import stackDefaults from "@/lib/matching-stack-defaults.json";
import type { DepositAddresses, DepositCurrency } from "@/lib/subaccount-deposit.types";

/**
 * Address plumbing for the subaccount deposit flow (Base mainnet defaults).
 *
 * Terminology follows the risk-core deployment artifacts, which is easy to invert:
 * - "base asset" / `base` = the WLWrappedERC20Asset contract that holds deposits
 * - `wrappedAsset` = the underlying ERC-20 token pulled from the wallet
 */

/**
 * The matching stack, per chain, from `matching-stack-defaults.json`. The JSON is shared with
 * `scripts/check-market-stack.mjs`, which compares the resolved stack (env, else these defaults)
 * against what the venue serves before every build, so a default that falls behind the venue
 * fails the build rather than shipping. These used to be single Sepolia constants, which made a
 * chain flip a silent misconfiguration: none of the Sepolia addresses have code on mainnet, so
 * every deposit and order would have been built against contracts that do not exist.
 *
 * Mainnet is the unified stack spot and the perp share since the cutover on 2026-10-04, each
 * entry read back from `GET /v1/markets` and the Base 8453 chain:
 * - `matching` emits the `DepositedSubAccount` / `ModuleAllowed` events this app decodes, and is
 *   the contract the venue's own trades are submitted to.
 * - `subaccountCreator` answers to `createAndDepositSubAccount(address,uint256,address)` and
 *   points back at that same matching and subaccounts pair.
 * - `manager` is the perp StandardManager (SRM): the one manager every trading account is resolved
 *   and created under, for spot and the perp alike. The two it replaced can never trade again:
 *   DeliverableFXManager `0xcE01…4d49` (settlement reverts `MW_UnknownManager`) and the spot SRM
 *   `0x3195…E49b` of 2026-09-10 to 2026-10-04 (its module is disallowed), and SubAccounts has no
 *   way to change an account's manager, so those balances leave by withdrawal only.
 * - `tradeModule` is the perp TradeModule, the only module Matching allows and the one
 *   markets-service pins every order, spot or perp, to; it trades any base asset the order names.
 *   The CashAsset-quoted module `0x4481…eD1c` and the wrapped-quote module `0x1242…d071` are
 *   both disallowed.
 * - `wrappedUsdcAsset` is that module's `quoteAsset()`: the perp CashAsset, holding real USDC
 *   (canonical Base USDC, 6 decimals) 1:1 — not the original CashAsset `0x6B23…6fc6`, whose
 *   accounting is corrupted, nor the wrapped USDC `0x3640…5e84` of the 2026-09-10 stack.
 * - `cngnAsset` / `cngnToken` are the cNGN escrow and the ERC-20 it wraps; see
 *   `getCngnDeployment` below.
 */
const MATCHING_STACK = stackDefaults;

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
 * The cNGN escrow and token per chain, from the same JSON. On mainnet the escrow is the perp
 * stack's cNGN escrow (`0x37c9…7c98`, deployed at block 52112046): the spot market's
 * `asset_address`, the cNGN deposit escrow, and the collateral the perp SRM credits at its
 * factor, so cNGN deposits, cNGN orders and cNGN margin all settle against one contract. The
 * escrow of the 2026-09-10 stack (`0x9d80…9493`) is reachable withdraw-only through the legacy
 * envs below.
 *
 * Kept as a pair because the two must match: the escrow only accepts the exact ERC-20 it wraps,
 * and Base Sepolia hosts two unrelated contracts both calling themselves cNGN — the one this
 * venue wraps (18 decimals) and `0xe2387F04d3858e7Cb64Ef5Ed6617f9B2fcEEAfa2` (6 decimals), which
 * the app previously pointed at. Approving the wrong one leaves a deposit that cannot settle, so
 * these are only ever read together.
 *
 * Each escrow is verified on-chain: `wrappedAsset()` returns the paired token,
 * `deposit(uint256,uint256)` is present, and none has a `wlEnabled()` gate.
 */
function getCngnDeployment() {
  const stack = getMatchingStack();
  return { asset: stack.cngnAsset, token: stack.cngnToken };
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

/**
 * The Matching module a signed withdrawal is submitted through. It pays the action's owner out of an account
 * Matching holds, which is every account the app creates, without taking the account out of Matching.
 */
export function getWithdrawalModuleAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_WITHDRAWAL_MODULE_ADDRESS?.trim() || getMatchingStack().withdrawalModule
  );
}

export function getSubaccountCreatorAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_SUBACCOUNT_CREATOR_ADDRESS?.trim() ||
      getMatchingStack().subaccountCreator
  );
}

/**
 * The spot stack retired by the unified-account cutover: its manager and the two escrows a wallet
 * may still hold balances in. Set all three `NEXT_PUBLIC_LEGACY_SPOT_*` envs on the deployment
 * that moves spot onto the perp stack, so the terminal keeps finding a wallet's old spot account
 * and offers to withdraw from it; unset, there is no legacy stack and nothing is shown.
 */
export function getLegacySpotStack(): {
  manager: `0x${string}`;
  usdcEscrow: `0x${string}`;
  cngnEscrow: `0x${string}`;
} | null {
  const manager = process.env.NEXT_PUBLIC_LEGACY_SPOT_MANAGER_ADDRESS?.trim();
  const usdcEscrow = process.env.NEXT_PUBLIC_LEGACY_SPOT_USDC_ESCROW_ADDRESS?.trim();
  const cngnEscrow = process.env.NEXT_PUBLIC_LEGACY_SPOT_CNGN_ESCROW_ADDRESS?.trim();
  if (!(manager && usdcEscrow && cngnEscrow)) {
    return null;
  }
  return {
    cngnEscrow: getAddress(cngnEscrow),
    manager: getAddress(manager),
    usdcEscrow: getAddress(usdcEscrow),
  };
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
