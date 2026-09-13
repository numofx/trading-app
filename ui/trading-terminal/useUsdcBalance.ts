"use client";

import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, getAddress } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { readAtOrAfterBlock } from "@/lib/read-at-block";
import { getUsdcTokenAddress } from "@/lib/subaccount-deposit-config";

export type UsdcBalance = {
  decimals: number;
  units: bigint;
};

/** Wallet balance of the underlying USDC token on Base Sepolia. */
export function useUsdcBalance(walletAddress: string | null) {
  const [balance, setBalance] = useState<UsdcBalance | null>(null);
  // A fresh object per refresh, so repeating the same block still re-runs the read.
  const [refreshRequest, setRefreshRequest] = useState<{ minBlock: bigint | null }>({
    minBlock: null,
  });

  useEffect(() => {
    let cancelled = false;

    if (!walletAddress) {
      setBalance(null);
      return () => {
        cancelled = true;
      };
    }

    async function readBalance(minBlock: bigint | null) {
      const publicClient = createBasePublicClient();
      const token = getUsdcTokenAddress();
      const owner = getAddress(walletAddress as string);

      const [units, decimals] = await readAtOrAfterBlock({
        getBlockNumber: () => publicClient.getBlockNumber({ cacheTime: 0 }),
        minBlock,
        read: (blockNumber) =>
          Promise.all([
            publicClient.readContract({
              abi: erc20Abi,
              address: token,
              args: [owner],
              blockNumber,
              functionName: "balanceOf",
            }),
            publicClient.readContract({
              abi: erc20Abi,
              address: token,
              blockNumber,
              functionName: "decimals",
            }),
          ]),
      });

      if (!cancelled) {
        setBalance({ decimals, units });
      }
    }

    readBalance(refreshRequest.minBlock).catch(() => {
      if (!cancelled) {
        setBalance(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [walletAddress, refreshRequest]);

  /** Re-reads the balance; pass a confirmed transaction's block to wait until the read reflects it. */
  function refresh(minBlock: bigint | null = null) {
    setRefreshRequest({ minBlock });
  }

  return { balance, refresh };
}

export function formatUsdcBalanceLabel(balance: UsdcBalance | null) {
  if (balance === null) {
    return null;
  }

  const value = Number(formatUnits(balance.units, balance.decimals));
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} USDC`;
}
