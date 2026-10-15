"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import { parseAbi } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { futureOpenInterestUsd } from "@/lib/future-market";
import type { FutureMarket } from "@/lib/future-market.types";

const POLL_INTERVAL_MS = Duration.toMillis("30 seconds");

const positionTrackingAbi = parseAbi([
  "function totalPosition(address manager) view returns (uint256)",
]);

/**
 * The future's open interest at its USDC notional, read from the asset's own position tracking
 * every 30 seconds; null until the first read lands, or while the chain cannot be read.
 */
export function useFutureOpenInterest(market: Pick<FutureMarket, "stack" | "state"> | null) {
  const [openInterestUsd, setOpenInterestUsd] = useState<number | null>(null);
  const asset = market?.stack.assetAddress ?? null;
  const manager = market?.stack.managerAddress ?? null;
  const contractSizeUsdc = market?.state.contractSizeUsdc ?? null;

  useEffect(() => {
    if (asset === null || manager === null || contractSizeUsdc === null) {
      setOpenInterestUsd(null);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const total = await createBasePublicClient().readContract({
          abi: positionTrackingAbi,
          address: asset as `0x${string}`,
          args: [manager as `0x${string}`],
          functionName: "totalPosition",
        });
        if (!cancelled) {
          setOpenInterestUsd(futureOpenInterestUsd(total, contractSizeUsdc as number));
        }
      } catch {
        // Keep the last good read rather than blanking the figure on one failed poll.
      }
    }
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [asset, manager, contractSizeUsdc]);

  return openInterestUsd;
}
