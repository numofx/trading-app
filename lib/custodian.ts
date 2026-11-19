import { Duration } from "effect";
import type { Hex } from "viem";
import { getAddress } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAppChain } from "@/lib/base-public-client";
import { bookTakeMaxFee, toWad } from "@/lib/book-take-submission";
import { createOrderNonce } from "@/lib/spot-order-submission";
import { getCustodianAddress } from "@/lib/subaccount-deposit-config";

export { getCustodianAddress } from "@/lib/subaccount-deposit-config";

/**
 * BookCustodian (exchange: contracts/risk-core/src/periphery/BookCustodian.sol, docs/book-custodian-spec.md) holds
 * the account so the onchain books can act on it, and only the wallet can withdraw or leave. Every call is relayed
 * by the venue (POST /api/custodian), so the user needs no ETH. Trades are signed by a trading key kept in this
 * browser and set once by the wallet: it can take on the books and nothing else (no withdrawal, no exit, no key
 * change), so an order needs no wallet prompt.
 */

/** How long a trading key the wallet sets stays valid. */
export const TRADING_KEY_LIFETIME_SECONDS = Duration.toSeconds("7 days");
/** A take's deadline: the venue refuses one more than 600 s away, and the book refuses it after. */
const TAKE_DEADLINE_SECONDS = Duration.toSeconds("90 seconds");
/** Withdrawals, exits and key changes: the wallet prompt and the relay. */
const WALLET_ACTION_DEADLINE_SECONDS = Duration.toSeconds("10 minutes");
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;
const SIGNATURE_PATTERN = /^0x[0-9a-fA-F]{130}$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;

/** Off unless NEXT_PUBLIC_CUSTODIAN_ENABLED is "true": the venue switches it on once its relay is deployed. */
export function isCustodianEnabled(): boolean {
  return (
    process.env.NEXT_PUBLIC_CUSTODIAN_ENABLED?.trim() === "true" && getCustodianAddress() !== null
  );
}

function custodianDomain() {
  const verifyingContract = getCustodianAddress();
  if (verifyingContract === null) {
    throw new Error("Onchain custody is not available on this network.");
  }
  return {
    chainId: getAppChain().id,
    name: "NumoBookCustodian" as const,
    verifyingContract,
    version: "1" as const,
  };
}

const TAKE_TYPES = {
  Take: [
    { name: "accountId", type: "uint256" },
    { name: "book", type: "address" },
    { name: "marketId", type: "uint256" },
    { name: "isBuy", type: "bool" },
    { name: "amount", type: "uint256" },
    { name: "limitPrice", type: "uint256" },
    { name: "minFill", type: "uint256" },
    { name: "maxFee", type: "uint256" },
    { name: "deadline", type: "uint64" },
    { name: "maxLevels", type: "uint16" },
    { name: "reduceOnly", type: "bool" },
    { name: "nonce", type: "uint256" },
  ],
} as const;

const WITHDRAW_TYPES = {
  Withdraw: [
    { name: "accountId", type: "uint256" },
    { name: "asset", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

const EXIT_TYPES = {
  Exit: [
    { name: "accountId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

const SET_TRADING_KEY_TYPES = {
  SetTradingKey: [
    { name: "wallet", type: "address" },
    { name: "key", type: "address" },
    { name: "validUntil", type: "uint64" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint64" },
  ],
} as const;

const PERMIT_TYPES = {
  Permit: [
    { name: "owner", type: "address" },
    { name: "spender", type: "address" },
    { name: "value", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "deadline", type: "uint256" },
  ],
} as const;

function accountIdOf(accountId: string): bigint {
  if (!UNSIGNED_INTEGER_PATTERN.test(accountId) || BigInt(accountId) === 0n) {
    throw new Error(`Invalid account id: ${accountId}`);
  }
  return BigInt(accountId);
}

/**
 * A take on the series' onchain book from a custodian account, all or nothing at the limit, the fee bounded from
 * it as for BookTakeModule. Signed by the trading key (or the wallet); `body` is POST /api/custodian's.
 */
export function buildCustodianTake({
  accountId,
  amountScale,
  book,
  contractSize,
  isBuy,
  limitPrice,
  marketId,
  nowSeconds = Math.floor(Date.now() / 1000),
  reduceOnly,
  takerFeeBps,
  units,
}: {
  accountId: string;
  amountScale: bigint;
  book: string;
  contractSize: bigint;
  isBuy: boolean;
  limitPrice: string;
  marketId: number;
  nowSeconds?: number;
  reduceOnly: boolean;
  takerFeeBps: number;
  units: number;
}) {
  if (!Number.isInteger(units) || units <= 0) {
    throw new Error("Enter a size of at least one unit.");
  }
  const amount = BigInt(units) * amountScale;
  const price = toWad(limitPrice);
  if (price <= 0n) {
    throw new Error("Enter a price above zero.");
  }
  const message = {
    accountId: accountIdOf(accountId),
    book: getAddress(book),
    marketId: BigInt(marketId),
    isBuy,
    amount,
    deadline: BigInt(nowSeconds + TAKE_DEADLINE_SECONDS),
    limitPrice: price,
    maxFee: bookTakeMaxFee(amount, price, contractSize, BigInt(Math.round(takerFeeBps))),
    maxLevels: 255,
    minFill: amount,
    reduceOnly,
    nonce: createOrderNonce(),
  };
  return {
    message,
    body: (signature: Hex) => ({
      call: "take",
      signature,
      take: {
        account_id: message.accountId.toString(),
        amount: message.amount.toString(),
        book: message.book,
        deadline: message.deadline.toString(),
        is_buy: message.isBuy,
        limit_price: message.limitPrice.toString(),
        market_id: message.marketId.toString(),
        max_fee: message.maxFee.toString(),
        max_levels: message.maxLevels,
        min_fill: message.minFill.toString(),
        nonce: message.nonce.toString(),
        reduce_only: message.reduceOnly,
      },
    }),
    typedData: {
      domain: custodianDomain(),
      primaryType: "Take" as const,
      types: TAKE_TYPES,
      message,
    },
  };
}

/** A withdrawal to the wallet itself, signed by the wallet (never the key). `amount` in the token's own decimals. */
export function buildCustodianWithdraw({
  accountId,
  amount,
  asset,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  accountId: string;
  amount: bigint;
  asset: string;
  nowSeconds?: number;
}) {
  if (amount <= 0n) {
    throw new Error("Enter an amount above zero.");
  }
  const message = {
    accountId: accountIdOf(accountId),
    asset: getAddress(asset),
    amount,
    deadline: BigInt(nowSeconds + WALLET_ACTION_DEADLINE_SECONDS),
    nonce: createOrderNonce(),
  };
  return {
    body: (signature: Hex) => ({
      account_id: message.accountId.toString(),
      amount: message.amount.toString(),
      asset: message.asset,
      call: "withdraw_for",
      deadline: message.deadline.toString(),
      nonce: message.nonce.toString(),
      signature,
    }),
    typedData: {
      domain: custodianDomain(),
      primaryType: "Withdraw" as const,
      types: WITHDRAW_TYPES,
      message,
    },
  };
}

/** The account, with its positions and balances, back to the wallet. Signed by the wallet. */
export function buildCustodianExit({
  accountId,
  nowSeconds = Math.floor(Date.now() / 1000),
}: {
  accountId: string;
  nowSeconds?: number;
}) {
  const message = {
    accountId: accountIdOf(accountId),
    deadline: BigInt(nowSeconds + WALLET_ACTION_DEADLINE_SECONDS),
    nonce: createOrderNonce(),
  };
  return {
    body: (signature: Hex) => ({
      account_id: message.accountId.toString(),
      call: "exit_for",
      deadline: message.deadline.toString(),
      nonce: message.nonce.toString(),
      signature,
    }),
    typedData: {
      domain: custodianDomain(),
      primaryType: "Exit" as const,
      types: EXIT_TYPES,
      message,
    },
  };
}

/** The wallet appoints `key` as its trading key until `validUntil`. Signed by the wallet. */
export function buildSetTradingKey({
  key,
  nowSeconds = Math.floor(Date.now() / 1000),
  wallet,
}: {
  key: string;
  nowSeconds?: number;
  wallet: string;
}) {
  const message = {
    deadline: BigInt(nowSeconds + WALLET_ACTION_DEADLINE_SECONDS),
    key: getAddress(key),
    nonce: createOrderNonce(),
    validUntil: BigInt(nowSeconds + TRADING_KEY_LIFETIME_SECONDS),
    wallet: getAddress(wallet),
  };
  return {
    message,
    body: (signature: Hex) => ({
      call: "set_trading_key_for",
      deadline: message.deadline.toString(),
      key: message.key,
      nonce: message.nonce.toString(),
      signature,
      valid_until: message.validUntil.toString(),
      wallet: message.wallet,
    }),
    typedData: {
      domain: custodianDomain(),
      primaryType: "SetTradingKey" as const,
      types: SET_TRADING_KEY_TYPES,
      message,
    },
  };
}

/**
 * A gasless USDC deposit: the wallet signs USDC's EIP-2612 permit for the custodian, and the venue relays
 * `depositWithPermit`. `amount` in USDC's 6 decimals. `permitNonce` is USDC's `nonces(wallet)`, read just before.
 */
export function buildUsdcPermitDeposit({
  accountId,
  amount,
  cashAsset,
  nowSeconds = Math.floor(Date.now() / 1000),
  permitNonce,
  usdc,
  wallet,
}: {
  accountId: string;
  amount: bigint;
  cashAsset: string;
  nowSeconds?: number;
  permitNonce: bigint;
  usdc: string;
  wallet: string;
}) {
  if (amount <= 0n) {
    throw new Error("Enter an amount above zero.");
  }
  const spender = getCustodianAddress();
  if (spender === null) {
    throw new Error("Onchain custody is not available on this network.");
  }
  const deadline = BigInt(nowSeconds + WALLET_ACTION_DEADLINE_SECONDS);
  const message = {
    owner: getAddress(wallet),
    spender,
    nonce: permitNonce,
    value: amount,
    deadline,
  };
  return {
    body: (signature: Hex) => {
      const { r, s, v } = splitSignature(signature);
      return {
        account_id: accountIdOf(accountId).toString(),
        amount: amount.toString(),
        asset: getAddress(cashAsset),
        call: "deposit_with_permit",
        permit_deadline: deadline.toString(),
        r,
        s,
        v,
      };
    },
    typedData: {
      primaryType: "Permit" as const,
      types: PERMIT_TYPES,
      // USDC on Base: name "USD Coin", version "2" (read 2026-11-19)
      domain: {
        chainId: getAppChain().id,
        name: "USD Coin",
        verifyingContract: getAddress(usdc),
        version: "2",
      },
      message,
    },
  };
}

export function splitSignature(signature: Hex): { r: Hex; s: Hex; v: number } {
  if (!SIGNATURE_PATTERN.test(signature)) {
    throw new Error("Expected a 65-byte signature");
  }
  const v = Number.parseInt(signature.slice(130, 132), 16);
  return {
    r: `0x${signature.slice(2, 66)}`,
    s: `0x${signature.slice(66, 130)}`,
    v: v < 27 ? v + 27 : v,
  };
}

/** The browser's trading key for a wallet: generated here, never sent anywhere; the wallet sets it on chain once. */
export type StoredTradingKey = { address: `0x${string}`; privateKey: Hex; validUntil: number };

const storageKey = (wallet: string) => `numo.custodian.tradingKey.${getAddress(wallet)}`;

export function loadTradingKey(
  wallet: string,
  storage: Pick<Storage, "getItem"> | undefined = globalThis.localStorage,
  nowSeconds = Math.floor(Date.now() / 1000)
): StoredTradingKey | null {
  try {
    const raw = storage?.getItem(storageKey(wallet));
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as StoredTradingKey;
    // a minute's margin, so a take is never signed by a key about to lapse
    if (typeof parsed.validUntil !== "number" || parsed.validUntil <= nowSeconds + 60) {
      return null;
    }
    if (privateKeyToAccount(parsed.privateKey).address !== parsed.address) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** A fresh key, not yet usable: store it only once the wallet's SetTradingKey has landed (`saveTradingKey`). */
export function newTradingKey(): { address: `0x${string}`; privateKey: Hex } {
  const privateKey = generatePrivateKey();
  return { address: privateKeyToAccount(privateKey).address, privateKey };
}

export function saveTradingKey(
  wallet: string,
  key: StoredTradingKey,
  storage: Pick<Storage, "setItem"> | undefined = globalThis.localStorage
) {
  try {
    storage?.setItem(storageKey(wallet), JSON.stringify(key));
  } catch {
    // private mode or blocked storage: the key just is not remembered; the next session sets a new one
  }
}

export type CustodianOutcome =
  | { kind: "done"; txHash: `0x${string}`; blockNumber: bigint; accountId?: string }
  | { kind: "pending"; txHash: `0x${string}` }
  | { kind: "reverted"; txHash: `0x${string}` }
  | { kind: "rejected"; reason: string }
  | { kind: "unknown"; reason: string };

const CUSTODIAN_REVERT_COPY: Record<string, string> = {
  BC_BadSignature:
    "The signature was not accepted. If you trade with a trading key, set it up again",
  BC_Expired: "The request expired before it could be submitted",
  BC_NonceUsed: "This request was already submitted",
  BC_NotAllowed: "This book or asset is not available through onchain custody",
  BC_NotHeld: "This account is not held in onchain custody",
  BC_NotReducing: "A reduce-only order needs an open position on the other side",
  BC_Paused: "Trading through onchain custody is paused. Withdrawals and exits still work",
  BC_PermitFailed: "The deposit permit was not accepted",
  OB_BelowMinFill: "Not enough liquidity on the book at your price for the whole size",
  OB_FeeTooHigh: "The fee would exceed the bound you signed",
  OB_MarketDisabled: "Trading on this series is paused",
  OB_TradingClosed: "Trading on this series has stopped",
};

const UNKNOWN_CUSTODIAN_OUTCOME =
  "The venue could not confirm whether this went through. Check your account before trying again.";

/** A 200: the receipt, the call still pending, or (no hash) unknown. */
function interpretCustodianReceipt(record: Record<string, unknown>): CustodianOutcome {
  {
    const txHash = record.tx_hash;
    if (typeof txHash !== "string" || !TX_HASH_PATTERN.test(txHash)) {
      return { kind: "unknown", reason: UNKNOWN_CUSTODIAN_OUTCOME };
    }
    if (record.receipt_status === "reverted") {
      return { kind: "reverted", txHash: txHash as `0x${string}` };
    }
    const block = record.block_number;
    if (
      record.receipt_status === "success" &&
      typeof block === "string" &&
      UNSIGNED_INTEGER_PATTERN.test(block)
    ) {
      const accountId = typeof record.account_id === "string" ? record.account_id : undefined;
      return {
        accountId,
        blockNumber: BigInt(block),
        kind: "done",
        txHash: txHash as `0x${string}`,
      };
    }
    return { kind: "pending", txHash: txHash as `0x${string}` };
  }
}

export function interpretCustodianResponse(httpStatus: number, body: unknown): CustodianOutcome {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const error = typeof record.error === "string" ? record.error : undefined;
  if (httpStatus === 200) {
    return interpretCustodianReceipt(record);
  }
  switch (httpStatus) {
    case 400:
    case 409:
      return { kind: "rejected", reason: error ?? "The venue refused the request" };
    case 422: {
      const revert = typeof record.revert === "string" ? record.revert : undefined;
      return {
        kind: "rejected",
        reason:
          (revert && CUSTODIAN_REVERT_COPY[revert]) ?? error ?? "The venue refused the request",
      };
    }
    case 429:
      return {
        kind: "rejected",
        reason: "A request for this wallet is already in progress. Try again shortly",
      };
    case 503:
      return { kind: "rejected", reason: error ?? "Onchain custody is temporarily unavailable" };
    default:
      return { kind: "unknown", reason: UNKNOWN_CUSTODIAN_OUTCOME };
  }
}

export async function postCustodian(body: unknown): Promise<CustodianOutcome> {
  const response = await fetch("/api/custodian", {
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  return interpretCustodianResponse(response.status, await response.json().catch(() => null));
}

/** The wallet's custodian accounts, newest first; empty when it has none or the venue's index is catching up. */
export async function fetchCustodianAccounts(wallet: string): Promise<string[]> {
  const response = await fetch(`/api/custodian/accounts?wallet=${getAddress(wallet)}`, {
    cache: "no-store",
  });
  if (!response.ok) {
    return [];
  }
  const body = (await response.json().catch(() => null)) as { accounts?: unknown } | null;
  return Array.isArray(body?.accounts)
    ? body.accounts.filter((id): id is string => typeof id === "string")
    : [];
}
