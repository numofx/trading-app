import { encodeAbiParameters, getAddress, parseUnits } from "viem";
import { getAppChain } from "@/lib/base-public-client";
import type { MarketDefinition } from "@/lib/trading.types";

const DEFAULT_MATCHING_ADDRESS = "0x9E90A9cD13d859Bd6a08168082FB1F6F7405F191";
const DEFAULT_TRADE_MODULE_ADDRESS = "0x44813aD30b2fFC1bB2871Eed9b19F63c8196eD1c";
const ENGINE_DECIMALS = 18;

/**
 * Taker fee tier as a fraction of USDC notional (15 bps). Makers pay zero. markets-service
 * does not expose fee tiers over the API yet, so this constant is the app-side source of
 * truth and must track the venue's fee schedule. TradeModule rejects any fill whose realized
 * fee-per-contract exceeds the signed worstFee, so this bounds what the keeper can charge.
 */
export const TAKER_FEE_RATE = "0.0015";
const DECIMAL_INPUT_PATTERN = /^(\d+(\.\d+)?|\.\d+)$/;
const TRAILING_ZEROES_PATTERN = /0+$/;
const UNSIGNED_INTEGER_PATTERN = /^\d+$/;

export type FutureOrderEnvelope = {
  actionJson: {
    data: `0x${string}`;
    expiry: string;
    module: `0x${string}`;
    nonce: string;
    owner: `0x${string}`;
    signer: `0x${string}`;
    subaccount_id: string;
  };
  /**
   * Deliberately carries no `ui_intent` (or `order_entry_spec`). markets-service accepts those two
   * fields only for the spot USDC/cNGN contract and rejects the order outright otherwise —
   * `order_entry_spec and ui_intent are only supported for the spot usdc/cngn contract`. Futures
   * send engine-native values, which is what the signed action encodes anyway.
   */
  payload: {
    action_json: {
      data: `0x${string}`;
      expiry: string;
      module: `0x${string}`;
      nonce: string;
      owner: `0x${string}`;
      signer: `0x${string}`;
      subaccount_id: string;
    };
    asset_address: `0x${string}`;
    desired_amount: string;
    expiry: number;
    filled_amount: string;
    limit_price: string;
    nonce: string;
    order_id: string;
    owner_address: `0x${string}`;
    recipient_id: string;
    side: "buy" | "sell";
    signer_address: `0x${string}`;
    sub_id: string;
    subaccount_id: string;
    worst_fee: string;
  };
  typedData: {
    domain: {
      chainId: number;
      name: "Matching";
      verifyingContract: `0x${string}`;
      version: "1.0";
    };
    message: {
      data: `0x${string}`;
      expiry: bigint;
      module: `0x${string}`;
      nonce: bigint;
      owner: `0x${string}`;
      signer: `0x${string}`;
      subaccountId: bigint;
    };
    primaryType: "Action";
    types: {
      Action: readonly [
        { name: "subaccountId"; type: "uint256" },
        { name: "nonce"; type: "uint256" },
        { name: "module"; type: "address" },
        { name: "data"; type: "bytes" },
        { name: "expiry"; type: "uint256" },
        { name: "owner"; type: "address" },
        { name: "signer"; type: "address" },
      ];
    };
  };
};

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

function formatFixedPointUnits(value: bigint, decimals: number) {
  const negative = value < 0n;
  const absoluteValue = negative ? -value : value;
  const divisor = 10n ** BigInt(decimals);
  const integerPart = absoluteValue / divisor;
  const fractionPart = absoluteValue % divisor;

  if (fractionPart === 0n) {
    return `${negative ? "-" : ""}${integerPart.toString()}`;
  }

  const fraction = fractionPart
    .toString()
    .padStart(decimals, "0")
    .replace(TRAILING_ZEROES_PATTERN, "");
  return `${negative ? "-" : ""}${integerPart.toString()}.${fraction}`;
}

type Rational = {
  denominator: bigint;
  numerator: bigint;
};

function parseDecimalToRational(value: string): Rational {
  const [wholePart, fractionPart = ""] = value.split(".");
  const normalizedWholePart = wholePart === "" ? "0" : wholePart;
  const denominator = 10n ** BigInt(fractionPart.length);
  const numerator = BigInt(normalizedWholePart + fractionPart);

  return {
    denominator,
    numerator,
  };
}

function divideRationals(left: Rational, right: Rational): Rational {
  if (right.numerator === 0n) {
    throw new Error("Cannot divide by zero");
  }

  return {
    denominator: left.denominator * right.numerator,
    numerator: left.numerator * right.denominator,
  };
}

function multiplyRationals(left: Rational, right: Rational): Rational {
  return {
    denominator: left.denominator * right.denominator,
    numerator: left.numerator * right.numerator,
  };
}

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

export function canSubmitFutureOrder(market: MarketDefinition) {
  return market.type === "future" && Boolean(market.assetAddress && market.subId);
}

export function buildFutureOrderEnvelope({
  limitPrice,
  market,
  side,
  size,
  subaccountId,
  walletAddress,
}: {
  limitPrice: string;
  market: MarketDefinition;
  side: "buy" | "sell";
  size: string;
  subaccountId: string;
  walletAddress: string;
}) {
  if (!canSubmitFutureOrder(market)) {
    throw new Error(
      "Futures execution requires a live deliverable future market from markets-service"
    );
  }

  if (!UNSIGNED_INTEGER_PATTERN.test(subaccountId)) {
    throw new Error("Trading subaccount ID must be an unsigned integer");
  }

  const sanitizedPrice = sanitizeDecimalInput(limitPrice, "Limit price");
  const sanitizedSize = sanitizeDecimalInput(size, "Size");
  const ownerAddress = getAddress(walletAddress);
  const matchingAddress = getMatchingAddress();
  const tradeModuleAddress = getTradeModuleAddress();
  const chainId = getMatchingChainId();
  const limitPriceUnits = parseUnits(sanitizedPrice, ENGINE_DECIMALS);
  const contractMultiplier = sanitizeDecimalInput(
    market.contractMultiplier ?? "1",
    "Contract multiplier"
  );
  const desiredAmountUnits = roundRationalToScaledUnits(
    divideRationals(
      parseDecimalToRational(sanitizedSize),
      parseDecimalToRational(contractMultiplier)
    ),
    ENGINE_DECIMALS
  );
  // TradeModule compares worstFee against fee-per-contract (fee / amountFilled), so the
  // signed bound is the fee tier scaled by the USDC notional of one engine contract.
  const worstFeeUnits = roundRationalToScaledUnits(
    multiplyRationals(
      parseDecimalToRational(TAKER_FEE_RATE),
      parseDecimalToRational(contractMultiplier)
    ),
    ENGINE_DECIMALS
  );

  if (limitPriceUnits <= 0n) {
    throw new Error("Limit price must be greater than zero");
  }

  if (desiredAmountUnits <= 0n) {
    throw new Error("Size must be greater than zero");
  }

  // markets-service requires `desired_amount` to be a whole multiple of the instrument's amount
  // step (its `min_size`) and rejects anything else with "desired_amount must align to amount step".
  // Caught here because the caller signs the order before submitting: without this the trader
  // approves a wallet signature for an order the venue was always going to refuse.
  const amountStep = sanitizeDecimalInput(market.minSize ?? "0.001", "Minimum size");
  const amountStepUnits = parseUnits(amountStep, ENGINE_DECIMALS);

  if (amountStepUnits > 0n) {
    const enteredContracts = formatFixedPointUnits(desiredAmountUnits, ENGINE_DECIMALS);

    if (desiredAmountUnits < amountStepUnits) {
      throw new Error(
        `Size must be at least ${amountStep} contracts (${enteredContracts} entered)`
      );
    }

    if (desiredAmountUnits % amountStepUnits !== 0n) {
      throw new Error(
        `Size must be a multiple of ${amountStep} contracts (${enteredContracts} entered)`
      );
    }
  }

  const nonce = BigInt(Date.now());
  const expiry = BigInt(Math.floor(Date.now() / 1000) + 5 * 60);
  const recipientId = BigInt(subaccountId);
  const subId = BigInt(market.subId ?? "0");
  const isBid = side === "buy";
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
        asset: getAddress(market.assetAddress as string),
        desiredAmount: desiredAmountUnits,
        isBid,
        limitPrice: limitPriceUnits,
        recipientId,
        subId,
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
      asset_address: getAddress(market.assetAddress as string),
      desired_amount: formatFixedPointUnits(desiredAmountUnits, ENGINE_DECIMALS),
      expiry: Number(expiry),
      filled_amount: "0",
      limit_price: formatFixedPointUnits(limitPriceUnits, ENGINE_DECIMALS),
      nonce: nonce.toString(),
      order_id: `future-${crypto.randomUUID()}`,
      owner_address: ownerAddress,
      recipient_id: subaccountId,
      side,
      signer_address: ownerAddress,
      sub_id: market.subId ?? "0",
      subaccount_id: subaccountId,
      worst_fee: formatFixedPointUnits(worstFeeUnits, ENGINE_DECIMALS),
    },
    typedData: {
      primaryType: "Action" as const,
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
      types: {
        Action: [
          { name: "subaccountId", type: "uint256" },
          { name: "nonce", type: "uint256" },
          { name: "module", type: "address" },
          { name: "data", type: "bytes" },
          { name: "expiry", type: "uint256" },
          { name: "owner", type: "address" },
          { name: "signer", type: "address" },
        ] as const,
      },
    },
  } satisfies FutureOrderEnvelope;
}
