"use client";

import { useEffect, useState } from "react";
import { erc20Abi, formatUnits, getAddress } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { readAtOrAfterBlock } from "@/lib/read-at-block";
import { getCngnTokenAddress } from "@/lib/subaccount-deposit-config";

export type CngnBalance = {
  decimals: number;
  units: bigint;
};

/**
 * Wallet balance of the underlying cNGN token, or null when no wallet is connected or the read
 * fails. Mirrors {@link useUsdcBalance}; unlike {@link useSubaccountBalance} this is wallet-held
 * cNGN, not the deposited ledger leg.
 */
export function useCngnBalance(walletAddress: string | null) {
  const [balance, setBalance] = useState<CngnBalance | null>(null);
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

    async function readBalance(
      tokenAddress: `0x${string}`,
      owner: `0x${string}`,
      minBlock: bigint | null
    ) {
      const publicClient = createBasePublicClient();

      const [units, decimals] = await readAtOrAfterBlock({
        getBlockNumber: () => publicClient.getBlockNumber({ cacheTime: 0 }),
        minBlock,
        read: (blockNumber) =>
          Promise.all([
            publicClient.readContract({
              abi: erc20Abi,
              address: tokenAddress,
              args: [owner],
              blockNumber,
              functionName: "balanceOf",
            }),
            publicClient.readContract({
              abi: erc20Abi,
              address: tokenAddress,
              blockNumber,
              functionName: "decimals",
            }),
          ]),
      });

      if (!cancelled) {
        setBalance({ decimals, units });
      }
    }

    readBalance(getCngnTokenAddress(), getAddress(walletAddress), refreshRequest.minBlock).catch(
      () => {
        if (!cancelled) {
          setBalance(null);
        }
      }
    );

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

export function formatCngnBalanceLabel(balance: CngnBalance | null) {
  if (balance === null) {
    return null;
  }

  const value = Number(formatUnits(balance.units, balance.decimals));
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} cNGN`;
}
