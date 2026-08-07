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
    { numerator: priceRational.denominator, denominator: priceRational.numerator },
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

  const nonce = BigInt(Date.now());
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
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
    },
  };
}
