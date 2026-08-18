import { Duration } from "effect";
import { encodeAbiParameters, getAddress } from "viem";
import { getAppChain } from "@/lib/base-public-client";

const DEFAULT_MATCHING_ADDRESS = "0x9E90A9cD13d859Bd6a08168082FB1F6F7405F191";
const DEFAULT_TRADE_MODULE_ADDRESS = "0x44813aD30b2fFC1bB2871Eed9b19F63c8196eD1c";
// The spot instrument's asset in markets-service (/v1/markets USDCcNGN-SPOT.asset_address):
// the wrapped-cNGN WLWrappedERC20Asset, always sub_id 0.
const DEFAULT_SPOT_ASSET_ADDRESS = "0x9d806fd040a719d27a8e5e77dc5ae0ed1e089493";
const ENGINE_DECIMALS = 18;

/**
 * Spot taker fee tier as a fraction of USDC notional (5 bps). Makers pay zero. Deliberately
 * below the futures taker tier (15 bps) because spot is the single-leg conversion rail, not
 * the leveraged product. Like the futures rate, this is the app-side source of truth until
 * markets-service exposes fee tiers; TradeModule rejects any fill whose realized fee-per-unit
 * exceeds the signed worstFee, so it bounds what the keeper can charge.
 */
export const SPOT_TAKER_FEE_RATE = "0.0005";

/**
 * How long a signed order stays valid. The engine drops it at this point whether or not it filled,
 * and — because `expiry` is inside the signed action — it is also the window in which the signature
 * authorizes a fill, so a resting limit order can fill at its price until it expires or is cancelled.
 *
 * This was five minutes while `/v1/orders` was POST-only: expiry was the only way an order could
 * ever leave the book, so a long lifetime meant an order that could not be withdrawn. That reason
 * is gone — cancellation now exists (signed `Cancel`, `buildCancelEnvelope`), and a cancel frees its
 * reservation immediately (`withoutCancelledOrders`) — so the lifetime is a full trading day, long
 * enough for a limit order to actually rest. A trader who leaves one out can cancel it from Open
 * Orders; one they forget stays visible there until it expires.
 */
export const SPOT_ORDER_LIFETIME_SECONDS = Duration.toSeconds("1 day");

/** The order lifetime as ticket copy, e.g. "24 hours". */
export const SPOT_ORDER_LIFETIME_LABEL = `${SPOT_ORDER_LIFETIME_SECONDS / 3600} hours`;

const DECIMAL_INPUT_PATTERN = /^(\d+(\.\d+)?|\.\d+)$/;
const TRAILING_ZEROES_PATTERN = /0+$/;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

/**
 * USDCcNGN-SPOT trades wrapped cNGN against internal USDC cash. The UI expresses an
 * order as: side (buy/sell USDC), price in cNGN per USDC, size in USDC notional. The
 * matching engine, however, is quoted the other way round — price in USDC per cNGN,
 * amount in whole cNGN, side inverted:
 *
 *   engineSide  = ui buy -> sell, ui sell -> buy   (BUY acquires USDC by selling cNGN)
 *   enginePrice = 1 / uiPrice
 *   engineAmount = floor(uiSize * uiPrice)          (whole cNGN; markets-service enforces
 *                                                    an atomic amount step of "1")
 *
 * The order BODY carries the engine-native values (side/limit_price/desired_amount) with
 * no ui_intent — markets-service's ui_intent path recomputes ui_size*ui_price as an exact
 * rational, which almost never lands on a whole cNGN and is rejected. The SIGNED action
 * carries the same values scaled to 1e18 wei. This mirrors the market-maker's spot path.
 */

type Rational = { numerator: bigint; denominator: bigint };

function sanitizeDecimalInput(rawValue: string, label: string) {
  const trimmed = rawValue.trim().replaceAll(",", "");
  if (trimmed === "") {
    throw new Error(`${label} is required`);
  }
  if (!DECIMAL_INPUT_PATTERN.test(trimmed)) {
    throw new Error(`${label} must be a valid number`);
  }
  return trimmed.startsWith(".") ? `0${trimmed}` : trimmed;
}

function parseDecimalToRational(value: string): Rational {
  const [wholePart, fractionPart = ""] = value.split(".");
  const normalizedWholePart = wholePart === "" ? "0" : wholePart;
  return {
    denominator: 10n ** BigInt(fractionPart.length),
    numerator: BigInt(normalizedWholePart + fractionPart),
  };
}

function formatFixedPointUnits(value: bigint, decimals: number) {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const integerPart = absolute / divisor;
  const fractionPart = absolute % divisor;
  if (fractionPart === 0n) {
    return `${negative ? "-" : ""}${integerPart.toString()}`;
  }
  const fraction = fractionPart
    .toString()
    .padStart(decimals, "0")
    .replace(TRAILING_ZEROES_PATTERN, "");
  return `${negative ? "-" : ""}${integerPart.toString()}.${fraction}`;
}

// round(numerator / denominator * 10^decimals), half-up.
function roundRationalToScaledUnits(value: Rational, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const scaledNumerator = value.numerator * scale;
  const quotient = scaledNumerator / value.denominator;
  const remainder = scaledNumerator % value.denominator;
  return remainder * 2n >= value.denominator ? quotient + 1n : quotient;
}

function getMatchingChainId() {
  return getAppChain().id;
}

function getMatchingAddress() {
  return getAddress(process.env.NEXT_PUBLIC_MATCHING_ADDRESS?.trim() || DEFAULT_MATCHING_ADDRESS);
}

function getTradeModuleAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_TRADE_MODULE_ADDRESS?.trim() || DEFAULT_TRADE_MODULE_ADDRESS
  );
}

function getSpotAssetAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_SPOT_ASSET_ADDRESS?.trim() || DEFAULT_SPOT_ASSET_ADDRESS
  );
}

/**
 * How many distinct nonces one millisecond can carry: the clock is multiplied up by this and a
 * sequence number fills the space below it, so the two never overlap.
 *
 * Sized so the packed nonce stays a **float64-exact integer** — `Date.now() * 4096` runs to about
 * 7.3e15, inside the 2^53 (~9.0e15) range where JSON numbers survive a parse unrounded. It crosses
 * 2^53 at 2039-09-07T15:47:35Z, after which nonces silently start rounding again and this constant
 * has to shrink. Above 2^53 a nonce rounds to a multiple of 1024 on any JSON-number hop, producing
 * an order that submits under one identity and rests under another — and `(owner_address, nonce)`
 * is the cancel key, so it could never be cancelled. Silent, and worst exactly during the fast
 * quoting this scheme exists to serve.
 *
 * This is a defensive bound rather than a live requirement: `/v1/book` was checked with orders
 * resting on 2026-08-17 and markets-service quotes `nonce` as a string, so today no hop rounds it.
 * It is kept because that quoting is incidental rather than principled — in one response `expiry`
 * arrives bare at the order level (`"expiry":1786983830`) and quoted inside `action_json`
 * (`"expiry":"1786983830"`), the same value treated two ways, and `last_trade_timestamp` is bare
 * too. Nothing on either side of the repo boundary pins the nonce's quoting, a Go struct tag losing
 * its `,string` would flip it silently, and a PostHog cast or a `jq '... | tonumber'` reintroduces
 * the hop downstream regardless. 4096 nonces per millisecond is ample, so the bound costs nothing.
 */
const NONCE_SEQUENCE_RANGE = 2n ** 12n;

/** Sequence state for `createOrderNonce`, module-scoped so the counter spans every order signed. */
let lastIssuedNonce = 0n;
let nonceSequenceSeed: bigint | null = null;

/**
 * A nonce unique to each signed order.
 *
 * `(owner_address, nonce)` is the venue's *cancel key*, not just replay protection —
 * `POST /v1/orders/cancel` takes that pair and nothing else, and `collectOpenOrders` drops book
 * rows missing either field because they cannot be acted on. So two orders sharing a nonce are not
 * merely a rejection risk: they cannot be cancelled independently. The previous `BigInt(Date.now())`
 * collided for any two orders signed in the same millisecond — unreachable for a human clicking the
 * ticket, routine for a quoting loop replacing both sides across several levels.
 *
 * The clock stays in the high bits because the old scheme gave away the signing time for free, and
 * that is worth keeping: the nonce is what identifies an order on the book and in the
 * `server_order_cancel_received` telemetry, so being able to read when it was signed off the value
 * itself is a real debugging affordance.
 *
 * Below the clock is a strictly increasing sequence number rather than random bits. Uniqueness is
 * only required per owner and one owner signs from one process, so a counter rules collisions out
 * within that process instead of merely making them unlikely — which matters because the room under
 * 2^53 is 4096 nonces per millisecond, narrow enough that random draws would collide by the
 * birthday bound at a few dozen orders in one millisecond. Signing more than 4096 in a millisecond
 * simply borrows from the next one's space, staying unique and reading a millisecond or two late.
 *
 * The sequence starts at a random offset, seeded lazily on first use so nothing touches `crypto` at
 * import time: two tabs signing for the same owner in the same millisecond would otherwise both
 * start at zero. That leaves one uncovered window, since the counter is per-process and cannot see
 * a sibling tab: two tabs signing for the same owner in the same millisecond collide if they drew
 * the same seed, which is 1 in 4096 per such pair, or if one has issued enough orders inside that
 * millisecond to walk up onto the other's seed. Nothing here closes it — a venue-side reject on a
 * duplicate `(owner_address, nonce)` is what would, and this only makes the case rare enough to be
 * worth living with.
 */
function createOrderNonce() {
  if (nonceSequenceSeed === null) {
    const entropy = new Uint32Array(1);
    crypto.getRandomValues(entropy);
    nonceSequenceSeed = BigInt(entropy[0]) % NONCE_SEQUENCE_RANGE;
  }

  const fromClock = BigInt(Date.now()) * NONCE_SEQUENCE_RANGE + nonceSequenceSeed;
  lastIssuedNonce = fromClock > lastIssuedNonce ? fromClock : lastIssuedNonce + 1n;

  return lastIssuedNonce;
}

/**
 * When an order carrying this nonce was signed, in epoch milliseconds.
 *
 * The counterpart to `createOrderNonce`. Exported because the nonce is how an order is identified
 * on the book, in Open Orders and in the `server_order_cancel_received` telemetry, and recovering
 * the signing time from that identity alone is the debugging affordance the packed layout exists
 * to preserve.
 */
export function getNonceSignedAtMs(nonce: bigint | string) {
  return Number(BigInt(nonce) / NONCE_SEQUENCE_RANGE);
}

export function buildSpotOrderEnvelope({
  uiPrice,
  uiSize,
  side,
  subaccountId,
  walletAddress,
}: {
  uiPrice: string;
  uiSize: string;
  side: "buy" | "sell";
  subaccountId: string;
  walletAddress: string;
}) {
  if (!UNSIGNED_INTEGER_PATTERN.test(subaccountId)) {
    throw new Error("Trading subaccount ID must be an unsigned integer");
  }

  const sanitizedPrice = sanitizeDecimalInput(uiPrice, "Price");
  const sanitizedSize = sanitizeDecimalInput(uiSize, "Size");
  const priceRational = parseDecimalToRational(sanitizedPrice);
  const sizeRational = parseDecimalToRational(sanitizedSize);

  if (priceRational.numerator <= 0n) {
    throw new Error("Price must be greater than zero");
  }
  if (sizeRational.numerator <= 0n) {
    throw new Error("Size must be greater than zero");
  }

  // enginePrice = 1 / uiPrice, as an 18-decimal fixed-point wei value.
  const enginePriceWei = roundRationalToScaledUnits(
    { denominator: priceRational.numerator, numerator: priceRational.denominator },
    ENGINE_DECIMALS
  );

  // engineAmount = floor(uiSize * uiPrice), in whole cNGN.
  const productNumerator = sizeRational.numerator * priceRational.numerator;
  const productDenominator = sizeRational.denominator * priceRational.denominator;
  const engineAmountWhole = productNumerator / productDenominator;

  if (engineAmountWhole < 1n) {
    throw new Error("Order too small: USDC size × price must be at least 1 cNGN");
  }
  if (enginePriceWei <= 0n) {
    throw new Error("Price is too large to represent");
  }

  const engineAmountWei = engineAmountWhole * 10n ** BigInt(ENGINE_DECIMALS);
  const engineSide: "buy" | "sell" = side === "buy" ? "sell" : "buy";
  const isBid = engineSide === "buy";

  // TradeModule compares worstFee against fee-per-cNGN (fee / amountFilled). One whole cNGN is
  // worth enginePrice = 1 / uiPrice USDC, so the signed bound is the fee tier scaled by that
  // per-cNGN notional — mirroring the futures worstFee = feeRate × contract notional. Charging
  // worstFee on every filled cNGN totals SPOT_TAKER_FEE_RATE of the USDC notional.
  const spotFeeRational = parseDecimalToRational(SPOT_TAKER_FEE_RATE);
  const worstFeeUnits = roundRationalToScaledUnits(
    {
      denominator: spotFeeRational.denominator * priceRational.numerator,
      numerator: spotFeeRational.numerator * priceRational.denominator,
    },
    ENGINE_DECIMALS
  );

  const ownerAddress = getAddress(walletAddress);
  const matchingAddress = getMatchingAddress();
  const tradeModuleAddress = getTradeModuleAddress();
  const spotAsset = getSpotAssetAddress();
  const chainId = getMatchingChainId();

  const nonce = createOrderNonce();
  const expiry = BigInt(Math.floor(Date.now() / 1000) + SPOT_ORDER_LIFETIME_SECONDS);
  const recipientId = BigInt(subaccountId);

  const actionData = encodeAbiParameters(
    [
      {
        type: "tuple",
        components: [
          { name: "asset", type: "address" },
          { name: "subId", type: "uint256" },
          { name: "limitPrice", type: "int256" },
          { name: "desiredAmount", type: "int256" },
          { name: "worstFee", type: "uint256" },
          { name: "recipientId", type: "uint256" },
          { name: "isBid", type: "bool" },
        ],
      },
    ],
    [
      {
        asset: spotAsset,
        desiredAmount: engineAmountWei,
        isBid,
        limitPrice: enginePriceWei,
        recipientId,
        subId: 0n,
        worstFee: worstFeeUnits,
      },
    ]
  );

  const actionJson = {
    data: actionData,
    expiry: expiry.toString(),
    module: tradeModuleAddress,
    nonce: nonce.toString(),
    owner: ownerAddress,
    signer: ownerAddress,
    subaccount_id: subaccountId,
  };

  return {
    actionJson,
    payload: {
      action_json: actionJson,
      asset_address: spotAsset,
      desired_amount: engineAmountWhole.toString(),
      expiry: Number(expiry),
      filled_amount: "0",
      limit_price: formatFixedPointUnits(enginePriceWei, ENGINE_DECIMALS),
      nonce: nonce.toString(),
      order_id: `spot-${crypto.randomUUID()}`,
      owner_address: ownerAddress,
      recipient_id: subaccountId,
      side: engineSide,
      signer_address: ownerAddress,
      sub_id: "0",
      subaccount_id: subaccountId,
      worst_fee: formatFixedPointUnits(worstFeeUnits, ENGINE_DECIMALS),
    },
    typedData: {
      primaryType: "Action" as const,
      types: {
        Action: [
          { name: "subaccountId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "module", type: "address" },
          { name: "data", type: "bytes" },
          { name: "expiry", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "signer", type: "address" },
        ],
      } as const,
      domain: {
        chainId,
        name: "Matching" as const,
        verifyingContract: matchingAddress,
        version: "1.0" as const,
      },
      message: {
        data: actionData,
        expiry,
        module: tradeModuleAddress,
        nonce,
        owner: ownerAddress,
        signer: ownerAddress,
        subaccountId: recipientId,
      },
    },
  };
}

/**
 * How long a signed cancel stays valid, bounding how long its signature can be replayed.
 *
 * Kept short — a cancel is signed and sent immediately, so this only has to cover the wallet
 * prompt, the round trip, and any clock skew between the browser and markets-service. It is not a
 * resting lifetime like {@link SPOT_ORDER_LIFETIME_SECONDS}; the shorter it is, the smaller the
 * window in which a captured cancel signature could be reused.
 */
export const CANCEL_SIGNATURE_LIFETIME_SECONDS = Duration.toSeconds("2 minutes");

/**
 * Builds the EIP-712 envelope that authorizes cancelling a resting order.
 *
 * markets-service used to cancel on `(owner_address, nonce)` alone — both public book data — so
 * anyone could cancel anyone's order. It now verifies a signature over
 * `Cancel(address owner,address signer,uint256 nonce,uint256 expiry)`, signed against the same
 * `Matching` domain as an order. `signer` equals `owner` until session keys exist; `expiry` bounds
 * replay. The address casing does not affect the digest — the contract encodes the 20 raw bytes —
 * so the owner value the book exposes and the checksummed signer recover to the same signer.
 */
export function buildCancelEnvelope({
  nonce,
  ownerAddress,
  signerAddress,
}: {
  nonce: string;
  ownerAddress: string;
  signerAddress: string;
}) {
  const owner = getAddress(ownerAddress);
  const signer = getAddress(signerAddress);
  const nonceValue = BigInt(nonce);
  const expiry = BigInt(Math.floor(Date.now() / 1000) + CANCEL_SIGNATURE_LIFETIME_SECONDS);
  const chainId = getMatchingChainId();
  const matchingAddress = getMatchingAddress();

  return {
    payload: {
      expiry: expiry.toString(),
      nonce,
      owner_address: ownerAddress,
      signer_address: signerAddress,
    },
    typedData: {
      primaryType: "Cancel" as const,
      types: {
        Cancel: [
          { name: "owner", type: "address" },
          { name: "signer", type: "address" },
          { name: "nonce", type: "uint256" },
          { name: "expiry", type: "uint256" },
        ],
      } as const,
      domain: {
        chainId,
        name: "Matching" as const,
        verifyingContract: matchingAddress,
        version: "1.0" as const,
      },
      message: {
        expiry,
        nonce: nonceValue,
        owner,
        signer,
      },
    },
  };
}
