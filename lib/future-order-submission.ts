import { encodeAbiParameters, getAddress, parseUnits } from "viem";
import type { MarketDefinition } from "@/lib/trading.types";

const DEFAULT_MATCHING_CHAIN_ID = 84_532;
const DEFAULT_MATCHING_ADDRESS = "0xe4c2a55401F73A540CA6e1C43067Aa7164f89088";
const DEFAULT_TRADE_MODULE_ADDRESS = "0x5fba217bFf9DfE7EDaD333972866DbA83c50B0f2";
const ENGINE_DECIMALS = 18;
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
    ui_intent: {
      price: string;
      side: "buy" | "sell";
      size: string;
    };
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

  const fraction = fractionPart.toString().padStart(decimals, "0").replace(TRAILING_ZEROES_PATTERN, "");
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

function roundRationalToScaledUnits(value: Rational, decimals: number) {
  const scale = 10n ** BigInt(decimals);
  const scaledNumerator = value.numerator * scale;
  const quotient = scaledNumerator / value.denominator;
  const remainder = scaledNumerator % value.denominator;

  return remainder * 2n >= value.denominator ? quotient + 1n : quotient;
}

function getMatchingChainId() {
  const configuredChainId = process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID?.trim();

  if (!configuredChainId) {
    return DEFAULT_MATCHING_CHAIN_ID;
  }

  const parsedChainId = Number(configuredChainId);

  if (!Number.isInteger(parsedChainId) || parsedChainId <= 0) {
    throw new Error("NEXT_PUBLIC_MATCHING_CHAIN_ID must be a positive integer");
  }

  if (parsedChainId !== DEFAULT_MATCHING_CHAIN_ID) {
    throw new Error(`NEXT_PUBLIC_MATCHING_CHAIN_ID must be ${DEFAULT_MATCHING_CHAIN_ID} (Base Sepolia)`);
  }

  return parsedChainId;
}

function getMatchingAddress() {
  return getAddress(process.env.NEXT_PUBLIC_MATCHING_ADDRESS?.trim() || DEFAULT_MATCHING_ADDRESS);
}

function getTradeModuleAddress() {
  return getAddress(process.env.NEXT_PUBLIC_TRADE_MODULE_ADDRESS?.trim() || DEFAULT_TRADE_MODULE_ADDRESS);
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
    throw new Error("Futures execution requires a live deliverable future market from markets-service");
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
  const contractMultiplier = sanitizeDecimalInput(market.contractMultiplier ?? "1", "Contract multiplier");
  const desiredAmountUnits = roundRationalToScaledUnits(
    divideRationals(parseDecimalToRational(sanitizedSize), parseDecimalToRational(contractMultiplier)),
    ENGINE_DECIMALS,
  );

  if (limitPriceUnits <= 0n) {
    throw new Error("Limit price must be greater than zero");
  }

  if (desiredAmountUnits <= 0n) {
    throw new Error("Size must be greater than zero");
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
        worstFee: 0n,
      },
    ],
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
      ui_intent: {
        price: sanitizedPrice,
        side,
        size: sanitizedSize,
      },
      worst_fee: "0",
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
        ] as const,
      },
    },
  } satisfies FutureOrderEnvelope;
}
