import { Duration } from "effect";
import { encodeAbiParameters, getAddress } from "viem";
import { getAppChain } from "@/lib/base-public-client";
import { createOrderNonce } from "@/lib/spot-order-submission";
import { getBookTakeModuleAddress, getMatchingAddress } from "@/lib/subaccount-deposit-config";
import type { OrderBookLevel } from "@/lib/trading.types";

/**
 * Futures liquidity is on the venue's onchain books (risk-core OnchainBook): makers quote curves there, and a
 * trader takes against them. The app keeps its gasless flow: the wallet signs a BookTakeModule `Action` for its
 * trading account, and the venue's executor submits it through `Matching.verifyAndMatch`, which lends the account
 * to the module for the call. The take fills (or reverts) in that one transaction: nothing rests.
 */

/** How long a signed take stays valid: the wallet prompt and the venue's submission. */
export const BOOK_TAKE_SIGNATURE_LIFETIME_SECONDS = Duration.toSeconds("2 minutes");
/** How long the book itself accepts the take, from signing: past it, the book refuses rather than fill late. */
const BOOK_TAKE_DEADLINE_SECONDS = Duration.toSeconds("90 seconds");
/** Fee headroom over the published schedule, so a schedule change between quote and fill does not refuse it. */
const FEE_HEADROOM_BPS = 5n;
const WAD = 10n ** 18n;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;
const TX_HASH_PATTERN = /^0x[0-9a-fA-F]{64}$/;
const DIGITS_PATTERN = /^\d+$/;
const OPTIONAL_DIGITS_PATTERN = /^\d*$/;
const TRAILING_PERIOD_PATTERN = /\.?$/;

const ACTION_TYPES = {
  Action: [
    { name: "subaccountId", type: "uint256" },
    { name: "nonce", type: "uint256" },
    { name: "module", type: "address" },
    { name: "data", type: "bytes" },
    { name: "expiry", type: "uint256" },
    { name: "owner", type: "address" },
    { name: "signer", type: "address" },
  ],
} as const;

/** IBookTakeModule.BookTakeData, field for field. */
const BOOK_TAKE_DATA = [
  { type: "address" },
  { type: "uint256" },
  { type: "bool" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint256" },
  { type: "uint64" },
  { type: "uint16" },
  { type: "bool" },
] as const;

/** A decimal string as an 18-dp integer, exactly; rejects more than 18 places rather than round. */
export function toWad(decimal: string): bigint {
  const [whole, fraction = ""] = decimal.replaceAll(",", "").trim().split(".");
  if (
    !DIGITS_PATTERN.test(whole ?? "") ||
    !OPTIONAL_DIGITS_PATTERN.test(fraction) ||
    fraction.length > 18
  ) {
    throw new Error(`Not a price: ${decimal}`);
  }
  return BigInt(whole as string) * WAD + BigInt(fraction.padEnd(18, "0"));
}

/**
 * The most the take may charge, in USDC (18 dp): the fee rate plus headroom on the notional at the limit price,
 * which bounds every fill inside the limit. `amount` is position units (1e18 a contract), `contractSize` the base
 * per contract.
 */
export function bookTakeMaxFee(
  amount: bigint,
  limitPrice: bigint,
  contractSize: bigint,
  takerFeeBps: bigint
) {
  return (amount * contractSize * limitPrice * (takerFeeBps + FEE_HEADROOM_BPS)) / (WAD * 10_000n);
}

export function buildBookTakeEnvelope({
  book,
  contractSize,
  isBuy,
  limitPrice,
  nowSeconds = Math.floor(Date.now() / 1000),
  reduceOnly,
  subaccountId,
  takerFeeBps,
  units,
  amountScale,
  walletAddress,
}: {
  /** The series' OnchainBook, as GET /book-depth names it. */
  book: string;
  /** The base per contract (`contract_multiplier`): 1,000,000 cNGN, 1,000 EURC. */
  contractSize: bigint;
  isBuy: boolean;
  /** The worst price, as a decimal in the series' terms (USDC per unit of the base). */
  limitPrice: string;
  nowSeconds?: number;
  reduceOnly: boolean;
  subaccountId: string;
  takerFeeBps: number;
  /** In the venue's units (0.001 contract each). */
  units: number;
  /** One unit as position units: 1e15. */
  amountScale: bigint;
  walletAddress: string;
}) {
  if (!UNSIGNED_INTEGER_PATTERN.test(subaccountId)) {
    throw new Error(`Invalid subaccount id: ${subaccountId}`);
  }
  if (!Number.isInteger(units) || units <= 0) {
    throw new Error("Enter a size of at least one unit.");
  }
  const moduleAddress = getBookTakeModuleAddress();
  if (moduleAddress === null) {
    throw new Error("Trading on the onchain book is not available on this network.");
  }
  const owner = getAddress(walletAddress);
  const amount = BigInt(units) * amountScale;
  const price = toWad(limitPrice);
  if (price <= 0n) {
    throw new Error("Enter a price above zero.");
  }
  const maxFee = bookTakeMaxFee(amount, price, contractSize, BigInt(Math.round(takerFeeBps)));
  const data = encodeAbiParameters(BOOK_TAKE_DATA, [
    getAddress(book),
    1n, // the book's market id: each book carries one series
    isBuy,
    amount,
    price,
    amount, // minFill: all of it or nothing, so a take never half-fills unseen
    maxFee,
    BigInt(nowSeconds + BOOK_TAKE_DEADLINE_SECONDS),
    255,
    reduceOnly,
  ]);
  const nonce = createOrderNonce();
  const expiry = BigInt(nowSeconds + BOOK_TAKE_SIGNATURE_LIFETIME_SECONDS);
  return {
    amount,
    maxFee,
    payload: {
      action: {
        data,
        expiry: expiry.toString(),
        module: moduleAddress,
        nonce: nonce.toString(),
        owner,
        signer: owner,
        subaccount_id: subaccountId,
      },
    },
    typedData: {
      primaryType: "Action" as const,
      types: ACTION_TYPES,
      domain: {
        chainId: getAppChain().id,
        name: "Matching" as const,
        verifyingContract: getMatchingAddress(),
        version: "1.0" as const,
      },
      message: {
        data,
        expiry,
        module: moduleAddress,
        nonce,
        owner,
        signer: owner,
        subaccountId: BigInt(subaccountId),
      },
    },
  };
}

export type BookTakeOutcome =
  | { kind: "filled"; txHash: `0x${string}`; blockNumber: bigint }
  | { kind: "pending"; txHash: `0x${string}` }
  | { kind: "reverted"; txHash: `0x${string}`; reason: string }
  | { kind: "rejected"; reason: string }
  | { kind: "unknown"; reason: string };

const REVERT_COPY: Record<string, string> = {
  BM_NonceAlreadyUsed: "This order was already submitted",
  BTM_BookNotAllowed: "This book is not available for trading",
  BTM_NotReducing: "A reduce-only order needs an open position on the other side",
  OB_BelowMinFill: "Not enough liquidity on the book at your price for the whole size",
  OB_Expired: "The take expired before it could be submitted",
  OB_FeeTooHigh: "The fee would exceed the bound you signed",
  OB_MarketDisabled: "Trading on this series is paused",
  OB_TradingClosed: "Trading on this series has stopped",
};

const UNKNOWN_OUTCOME =
  "The venue could not confirm whether the order went through. Check your position before trying again.";

function rejected(reason: string): BookTakeOutcome {
  return {
    kind: "rejected",
    reason: `${reason.replace(TRAILING_PERIOD_PATTERN, ".")} Nothing was traded.`,
  };
}

/**
 * Reads markets-service's answer to `POST /book-takes`. A take settles in the request: 200 carries its receipt.
 * Any refusal says nothing was traded; an outcome the venue could not confirm says to check the position rather
 * than sign again, since a second signed take is a second trade.
 */
export function interpretBookTakeResponse(httpStatus: number, body: unknown): BookTakeOutcome {
  const record = (typeof body === "object" && body !== null ? body : {}) as Record<string, unknown>;
  const error = typeof record.error === "string" ? record.error : undefined;
  if (httpStatus === 200) {
    const txHash = record.tx_hash;
    if (typeof txHash !== "string" || !TX_HASH_PATTERN.test(txHash)) {
      return { kind: "unknown", reason: UNKNOWN_OUTCOME };
    }
    if (record.receipt_status === "reverted") {
      return {
        kind: "reverted",
        reason: "The take reverted on chain. Nothing was traded.",
        txHash: txHash as `0x${string}`,
      };
    }
    const block = record.block_number;
    if (
      record.receipt_status === "success" &&
      record.accepted === true &&
      typeof block === "string" &&
      UNSIGNED_INTEGER_PATTERN.test(block)
    ) {
      return { blockNumber: BigInt(block), kind: "filled", txHash: txHash as `0x${string}` };
    }
    return { kind: "pending", txHash: txHash as `0x${string}` };
  }
  switch (httpStatus) {
    case 400:
      return rejected(error ?? "The venue refused the order");
    case 401:
      return rejected("Your signature was not accepted");
    case 403:
      return rejected("This wallet is not the recorded owner of the trading account");
    case 404:
    case 503:
      return rejected(error ?? "Trading on the onchain book is temporarily unavailable");
    case 422: {
      const revert = typeof record.revert === "string" ? record.revert : undefined;
      return rejected((revert && REVERT_COPY[revert]) ?? error ?? "The venue refused the order");
    }
    case 429:
      return rejected(
        "An order from this account is already in progress. Wait for it to finish, then try again"
      );
    default:
      return { kind: "unknown", reason: UNKNOWN_OUTCOME };
  }
}

/** GET /book-depth: what a take would fill now, each side, at a ladder of sizes (contracts). */
export type BookDepth = {
  book: string;
  bids: { contracts: string; filled: string; avg_price?: string }[];
  asks: { contracts: string; filled: string; avg_price?: string }[];
};

/**
 * The depth ladder as book levels, in the venue's units: each rung's marginal price, the average over the slice
 * between it and the rung before (avg_i·filled_i − avg_{i−1}·filled_{i−1}) / (filled_i − filled_{i−1}). Rungs
 * that add nothing (the curve ran out) end the side.
 */
export function depthToLevels(side: BookDepth["asks"], unitsPerContract: number): OrderBookLevel[] {
  const levels: OrderBookLevel[] = [];
  let prevFilled = 0;
  let prevCost = 0;
  let total = 0;
  for (const rung of side) {
    const filled = Number(rung.filled);
    const avg = rung.avg_price === undefined ? Number.NaN : Number(rung.avg_price);
    if (!(filled > prevFilled) || !Number.isFinite(avg)) {
      break;
    }
    const cost = avg * filled;
    const size = (filled - prevFilled) * unitsPerContract;
    total += size;
    levels.push({ price: (cost - prevCost) / (filled - prevFilled), size, total });
    prevFilled = filled;
    prevCost = cost;
  }
  return levels;
}
