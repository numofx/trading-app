"use client";

import { Duration } from "effect";
import { useCallback, useEffect, useState } from "react";
import { formatUnits, isAddressEqual, parseAbi } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { readAtOrAfterBlock } from "@/lib/read-at-block";
import { getSubaccountsAddress } from "@/lib/subaccount-deposit-config";

const POLL_INTERVAL_MS = Duration.toMillis("15 seconds");

const subAccountsAbi = parseAbi([
  "function getAccountBalances(uint256 accountId) view returns ((address asset, uint256 subId, int256 balance)[])",
]);
const marginEngineAbi = parseAbi([
  "function getMargin(uint256 accountId, bool isInitial) view returns (int256)",
]);

function toNumber(units: bigint) {
  return Number(formatUnits(units, 18));
}

export type OptionAccountRow = { asset: `0x${string}`; balance: bigint; subId: bigint };

export type OptionAccount = {
  /** USDC cash on the ledger. */
  cash: number;
  /** `getMargin(account, true)`: what is left above initial margin, USDC. */
  initialMarginSurplus: number;
  /** Every asset the account holds, as the ledger returns it. */
  rows: OptionAccountRow[];
};

async function readOptionAccount(
  subaccountId: string,
  cashAddress: `0x${string}`,
  managerAddress: `0x${string}`,
  minBlock: bigint | null
): Promise<OptionAccount> {
  const client = createBasePublicClient();
  const accountId = BigInt(subaccountId);
  return await readAtOrAfterBlock({
    getBlockNumber: () => client.getBlockNumber({ cacheTime: 0 }),
    minBlock,
    read: async (blockNumber) => {
      const [rows, surplus] = await Promise.all([
        client.readContract({
          abi: subAccountsAbi,
          address: getSubaccountsAddress(),
          args: [accountId],
          blockNumber,
          functionName: "getAccountBalances",
        }),
        client.readContract({
          abi: marginEngineAbi,
          address: managerAddress,
          args: [accountId, true],
          blockNumber,
          functionName: "getMargin",
        }),
      ]);
      const cash = rows.find((row) => isAddressEqual(row.asset, cashAddress))?.balance ?? 0n;
      return {
        cash: toNumber(cash),
        initialMarginSurplus: toNumber(surplus),
        rows: rows.map(({ asset, balance, subId }) => ({ asset, balance, subId })),
      };
    },
  });
}

/**
 * The trading account's cash, margin and option positions, re-read every 15 seconds. `refresh` re-reads at once,
 * at or past a block when one is given, after a fill or a transfer. A failed poll keeps the last good read.
 */
export function useOptionAccount(
  subaccountId: string | null,
  cashAddress: `0x${string}` | null,
  managerAddress: `0x${string}` | null
) {
  const [account, setAccount] = useState<OptionAccount | null>(null);
  const [request, setRequest] = useState<{ minBlock: bigint | null }>({ minBlock: null });

  useEffect(() => {
    if (subaccountId === null || cashAddress === null || managerAddress === null) {
      setAccount(null);
      return;
    }
    let cancelled = false;
    let minBlock = request.minBlock;
    async function load(id: string, cash: `0x${string}`, manager: `0x${string}`) {
      try {
        const read = await readOptionAccount(id, cash, manager, minBlock);
        minBlock = null;
        if (!cancelled) {
          setAccount(read);
        }
      } catch {
        // Keep the last good read on screen rather than blanking it on one failed poll.
      }
    }
    void load(subaccountId, cashAddress, managerAddress);
    const timer = window.setInterval(() => {
      if (!document.hidden) {
        void load(subaccountId, cashAddress, managerAddress);
      }
    }, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [subaccountId, cashAddress, managerAddress, request]);

  const refresh = useCallback((minBlock: bigint | null = null) => setRequest({ minBlock }), []);
  return { account, refresh };
}
