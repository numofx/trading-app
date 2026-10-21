"use client";

import { useEffect, useState } from "react";
import { erc20Abi, getAddress } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { readAtOrAfterBlock } from "@/lib/read-at-block";

export type TokenBalance = {
  decimals: number;
  units: bigint;
};

/**
 * Wallet balance of an ERC-20 (cNGN, EURC), or null when no wallet is connected, the token is not
 * configured, or the read fails. Mirrors {@link useUsdcBalance}; unlike {@link useSubaccountBalance}
 * this is wallet-held, not the deposited ledger leg.
 */
export function useTokenBalance(walletAddress: string | null, tokenAddress: `0x${string}` | null) {
  const [balance, setBalance] = useState<TokenBalance | null>(null);
  // A fresh object per refresh, so repeating the same block still re-runs the read.
  const [refreshRequest, setRefreshRequest] = useState<{ minBlock: bigint | null }>({
    minBlock: null,
  });

  useEffect(() => {
    let cancelled = false;

    if (!walletAddress || tokenAddress === null) {
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

    readBalance(tokenAddress, getAddress(walletAddress), refreshRequest.minBlock).catch(() => {
      if (!cancelled) {
        setBalance(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [walletAddress, tokenAddress, refreshRequest]);

  /** Re-reads the balance; pass a confirmed transaction's block to wait until the read reflects it. */
  function refresh(minBlock: bigint | null = null) {
    setRefreshRequest({ minBlock });
  }

  return { balance, refresh };
}
