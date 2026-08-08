import { parseAbi } from "viem";
import { base, baseSepolia } from "viem/chains";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";

/**
 * `DeliverableFXManager` per chain, from the risk-core deployment artifacts
 * (`contracts/risk-core/deployments/<chainId>/CNGN_SEP16_2026_FUTURE.json`, `manager` field).
 *
 * Deliberately not `NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS` — that env names an address which appears
 * in no deployment artifact on either chain, so it cannot be assumed to be this contract.
 */
const MANAGER_ADDRESS_BY_CHAIN: Record<number, `0x${string}`> = {
  [base.id]: "0xcE01f3D74400caE39bd7608cd2d286C2e3874d49",
  [baseSepolia.id]: "0x5921Ca5A694b47766476A69AF0f05c40bF24AB5e",
};

const MANAGER_ABI = parseAbi([
  "function marginParams() view returns (uint256 normalIM, uint256 normalMM)",
  "function lifecycleParams() view returns (uint64 rampDuration, uint256 rampIM, uint256 rampMM)",
]);

const FUTURE_ASSET_ABI = parseAbi([
  "function getSeries(uint96 subId) view returns ((bool listed,uint64 expiry,uint64 lastTradeTime,address baseAsset,address quoteAsset,uint128 contractSizeBase,uint128 minTradeIncrement,uint128 tickSize,uint96 markPrice,uint64 lastMarkTime))",
]);

/** Ratios are 18-decimal fixed point on-chain (2e17 = 20%). */
const RATIO_SCALE = 1e18;

/**
 * The venue's margin schedule for one series. Rates are fractions of USDC notional, so 0.2 is 20%.
 */
export type MarginSchedule = {
  normalIM: number;
  rampIM: number;
  rampDurationSeconds: number;
  lastTradeTimeSeconds: number;
};

export function getDeliverableFxManagerAddress(): `0x${string}` | null {
  const configured = process.env.NEXT_PUBLIC_DELIVERABLE_FX_MANAGER_ADDRESS?.trim();
  if (configured) {
    return configured as `0x${string}`;
  }

  return MANAGER_ADDRESS_BY_CHAIN[getAppChain().id] ?? null;
}

/**
 * Mirrors `DeliverableFXManager._getMarginRequirementRatio(series, isInitial = true)`.
 *
 * The requirement is not a constant: it sits at `normalIM` until `rampDuration` before the series'
 * last trade time, then climbs linearly to `rampIM` (100% on both chains today), which is what
 * forces positions to be fully collateralised into delivery.
 *
 * The contract does this in integer arithmetic; here it is floating point because the result only
 * feeds a display estimate. Do not reuse this to decide whether an order will be accepted.
 */
export function resolveInitialMarginRate(schedule: MarginSchedule, nowSeconds: number): number {
  const { lastTradeTimeSeconds, normalIM, rampDurationSeconds, rampIM } = schedule;

  if (nowSeconds >= lastTradeTimeSeconds) {
    return rampIM;
  }

  if (rampDurationSeconds === 0 || lastTradeTimeSeconds <= rampDurationSeconds) {
    return normalIM;
  }

  const rampStart = lastTradeTimeSeconds - rampDurationSeconds;

  if (nowSeconds <= rampStart || rampIM <= normalIM) {
    return normalIM;
  }

  const elapsed = nowSeconds - rampStart;
  return normalIM + ((rampIM - normalIM) * elapsed) / rampDurationSeconds;
}

/**
 * Reads the margin schedule for one series off-chain. Returns null when the manager address is
 * unknown, the series is not listed, or any call fails — callers must show "no quote" rather than
 * substituting a guess, since an invented margin number is worse than a missing one.
 */
export async function fetchMarginSchedule({
  assetAddress,
  subId,
}: {
  assetAddress: string;
  subId: string;
}): Promise<MarginSchedule | null> {
  const managerAddress = getDeliverableFxManagerAddress();

  if (!managerAddress) {
    return null;
  }

  let parsedSubId: bigint;
  try {
    parsedSubId = BigInt(subId);
  } catch {
    return null;
  }

  try {
    const publicClient = createBasePublicClient();
    const [marginParams, lifecycleParams, series] = await Promise.all([
      publicClient.readContract({
        abi: MANAGER_ABI,
        address: managerAddress,
        functionName: "marginParams",
      }),
      publicClient.readContract({
        abi: MANAGER_ABI,
        address: managerAddress,
        functionName: "lifecycleParams",
      }),
      publicClient.readContract({
        abi: FUTURE_ASSET_ABI,
        address: assetAddress as `0x${string}`,
        args: [parsedSubId],
        functionName: "getSeries",
      }),
    ]);

    if (!series.listed) {
      return null;
    }

    return {
      lastTradeTimeSeconds: Number(series.lastTradeTime),
      normalIM: Number(marginParams[0]) / RATIO_SCALE,
      rampDurationSeconds: Number(lifecycleParams[0]),
      rampIM: Number(lifecycleParams[1]) / RATIO_SCALE,
    };
  } catch {
    // A dead RPC must not put a fabricated requirement in front of a trader.
    return null;
  }
}
