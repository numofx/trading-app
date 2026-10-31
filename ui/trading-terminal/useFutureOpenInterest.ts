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
 * The future's open interest at its USDC notional (a v2 series' at the mark), read from the asset's
 * own position tracking every 30 seconds; null until the first read lands, or while the chain cannot be read.
 */
export function useFutureOpenInterest(market: Pick<FutureMarket, "stack" | "state"> | null) {
  const [openInterestUsd, setOpenInterestUsd] = useState<number | null>(null);
  const asset = market?.stack.assetAddress ?? null;
  const manager = market?.stack.managerAddress ?? null;
  // Primitives, not the state object, which is rebuilt every server refresh.
  const contractSize = market?.state.contractSize ?? null;
  const markPrice = market?.state.markPrice ?? null;
  const terms = market?.state.terms ?? null;

  useEffect(() => {
    if (asset === null || manager === null || contractSize === null || terms === null) {
      setOpenInterestUsd(null);
      return;
    }
    // Narrowed here: the closure below does not keep the guard's narrowing.
    const quoted = { contractSize, markPrice, terms };
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
          setOpenInterestUsd(futureOpenInterestUsd(total, quoted));
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
  }, [asset, manager, contractSize, markPrice, terms]);

  return openInterestUsd;
}
