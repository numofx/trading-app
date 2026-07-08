"use client";

import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, getAddress } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { getUsdcTokenAddress } from "@/lib/subaccount-deposit-config";

export type UsdcBalance = {
  decimals: number;
  units: bigint;
};

/** Wallet balance of the underlying USDC token on Base Sepolia. */
export function useUsdcBalance(walletAddress: string | null) {
  const [balance, setBalance] = useState<UsdcBalance | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (!walletAddress) {
      setBalance(null);
      return () => {
        cancelled = true;
      };
    }

    async function readBalance() {
      const publicClient = createBasePublicClient();
      const token = getUsdcTokenAddress();
      const owner = getAddress(walletAddress as string);

      const [units, decimals] = await Promise.all([
        publicClient.readContract({
          abi: erc20Abi,
          address: token,
          args: [owner],
          functionName: "balanceOf",
        }),
        publicClient.readContract({
          abi: erc20Abi,
          address: token,
          functionName: "decimals",
        }),
      ]);

      if (!cancelled) {
        setBalance({ decimals, units });
      }
    }

    readBalance().catch(() => {
      if (!cancelled) {
        setBalance(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [walletAddress, refreshCount]);

  function refresh() {
    setRefreshCount((current) => current + 1);
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
