"use client";

import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, getAddress } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { getCngnTokenAddress } from "@/lib/subaccount-deposit-config";

export type CngnBalance = {
  decimals: number;
  units: bigint;
};

/**
 * Wallet balance of the underlying cNGN token, or null when no wallet is connected, the read
 * fails, or NEXT_PUBLIC_CNGN_TOKEN_ADDRESS is unset for the active chain. Mirrors
 * {@link useUsdcBalance}; unlike {@link useSubaccountBalance} this is wallet-held cNGN, not the
 * deposited ledger leg.
 */
export function useCngnBalance(walletAddress: string | null) {
  const [balance, setBalance] = useState<CngnBalance | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const token = getCngnTokenAddress();

    if (!(walletAddress && token)) {
      setBalance(null);
      return () => {
        cancelled = true;
      };
    }

    async function readBalance(tokenAddress: `0x${string}`, owner: `0x${string}`) {
      const publicClient = createBasePublicClient();

      const [units, decimals] = await Promise.all([
        publicClient.readContract({
          abi: erc20Abi,
          address: tokenAddress,
          args: [owner],
          functionName: "balanceOf",
        }),
        publicClient.readContract({
          abi: erc20Abi,
          address: tokenAddress,
          functionName: "decimals",
        }),
      ]);

      if (!cancelled) {
        setBalance({ decimals, units });
      }
    }

    readBalance(token, getAddress(walletAddress)).catch(() => {
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

export function formatCngnBalanceLabel(balance: CngnBalance | null) {
  if (balance === null) {
    return null;
  }

  const value = Number(formatUnits(balance.units, balance.decimals));
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} cNGN`;
}
