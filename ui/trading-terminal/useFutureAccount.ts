"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import { formatUnits, isAddressEqual, parseAbi } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import type { FutureAccount, FutureStack } from "@/lib/future-market.types";
import { readAtOrAfterBlock } from "@/lib/read-at-block";
import { getCngnAssetAddress, getSubaccountsAddress } from "@/lib/subaccount-deposit-config";

const POLL_INTERVAL_MS = Duration.toMillis("15 seconds");

/** The ledger and the engine both report 18-decimal fixed point. */
const LEDGER_DECIMALS = 18;

const subAccountsAbi = parseAbi([
  "function getAccountBalances(uint256 accountId) view returns ((address asset, uint256 subId, int256 balance)[])",
]);

const marginEngineAbi = parseAbi([
  "function getMargin(uint256 accountId, bool isInitial) view returns (int256)",
  "function assetDetails(address asset) view returns ((bool isWhitelisted, uint8 assetType, uint256 marketId))",
  "function futureMarginRequirements(uint256 marketId) view returns (uint256 mmReq, uint256 imReq)",
]);

const futureAssetAbi = parseAbi([
  "function getPendingVM(uint256 accountId, uint256 subId) view returns (int256)",
]);

function toNumber(units: bigint) {
  return Number(formatUnits(units, LEDGER_DECIMALS));
}

export type FutureAccountRow = { asset: `0x${string}`; balance: bigint; subId: bigint };

type FutureAccountState = {
  account: FutureAccount | null;
  /** Every asset the account holds, as the ledger returns it: what a withdrawal draws on. */
  rows: FutureAccountRow[] | null;
  status: "idle" | "loading" | "ready" | "error";
};

const IDLE: FutureAccountState = { account: null, rows: null, status: "idle" };

/**
 * One read of the account under the series' MarginEngine, all pinned to one block: its ledger (cash,
 * cNGN, the position in the series), its margin surplus at initial and maintenance, the variation
 * margin accrued and not yet settled, and the engine's futures rates. markets-service serves none
 * of this for the future, so it comes from chain.
 */
async function readFutureAccount(
  subaccountId: string,
  stack: Pick<FutureStack, "assetAddress" | "cashAddress" | "managerAddress" | "subId">,
  minBlock: bigint | null
) {
  const publicClient = createBasePublicClient();
  const accountId = BigInt(subaccountId);
  return await readAtOrAfterBlock({
    getBlockNumber: () => publicClient.getBlockNumber({ cacheTime: 0 }),
    minBlock,
    read: async (blockNumber) => {
      const [balances, initial, maintenance, pendingVm, details] = await Promise.all([
        publicClient.readContract({
          abi: subAccountsAbi,
          address: getSubaccountsAddress(),
          args: [accountId],
          blockNumber,
          functionName: "getAccountBalances",
        }),
        publicClient.readContract({
          abi: marginEngineAbi,
          address: stack.managerAddress,
          args: [accountId, true],
          blockNumber,
          functionName: "getMargin",
        }),
        publicClient.readContract({
          abi: marginEngineAbi,
          address: stack.managerAddress,
          args: [accountId, false],
          blockNumber,
          functionName: "getMargin",
        }),
        publicClient.readContract({
          abi: futureAssetAbi,
          address: stack.assetAddress,
          args: [accountId, BigInt(stack.subId)],
          blockNumber,
          functionName: "getPendingVM",
        }),
        publicClient.readContract({
          abi: marginEngineAbi,
          address: stack.managerAddress,
          args: [stack.assetAddress],
          blockNumber,
          functionName: "assetDetails",
        }),
      ]);
      const [mmReq, imReq] = await publicClient.readContract({
        abi: marginEngineAbi,
        address: stack.managerAddress,
        args: [details.marketId],
        blockNumber,
        functionName: "futureMarginRequirements",
      });
      const rows: FutureAccountRow[] = balances.map((row) => ({
        asset: row.asset,
        balance: row.balance,
        subId: row.subId,
      }));
      const held = (asset: `0x${string}`, subId: bigint) =>
        rows.find((row) => isAddressEqual(row.asset, asset) && row.subId === subId)?.balance ?? 0n;
      const cashUnits = held(stack.cashAddress, 0n);
      const cngnUnits = held(getCngnAssetAddress(), 0n);
      const account: FutureAccount = {
        cash: toNumber(cashUnits),
        cashUnits,
        cngn: toNumber(cngnUnits),
        cngnUnits,
        imRate: toNumber(imReq),
        initialMarginSurplus: toNumber(initial),
        maintenanceMarginSurplus: toNumber(maintenance),
        mmRate: toNumber(mmReq),
        pendingVm: toNumber(pendingVm),
        positionUnits: held(stack.assetAddress, BigInt(stack.subId)),
      };
      return { account, rows };
    },
  });
}

/**
 * The trading account's futures position and margin, re-read every 15 seconds: the mark moves every hour
 * and the variation margin with it. `refresh` re-reads at once, at or past a receipt's block when
 * one is given, after a deposit, a withdrawal or a fill.
 */
export function useFutureAccount(subaccountId: string | null, stack: FutureStack | null) {
  const [state, setState] = useState<FutureAccountState>(IDLE);
  const [refreshRequest, setRefreshRequest] = useState<{ minBlock: bigint | null }>({
    minBlock: null,
  });
  // Keyed on the addresses, not the object: the stack is rebuilt every server refresh.
  const asset = stack?.assetAddress ?? null;
  const cash = stack?.cashAddress ?? null;
  const manager = stack?.managerAddress ?? null;
  const subId = stack?.subId ?? null;

  useEffect(() => {
    if (
      subaccountId === null ||
      asset === null ||
      cash === null ||
      manager === null ||
      subId === null
    ) {
      setState(IDLE);
      return;
    }
    const account = subaccountId;
    const pinned = { assetAddress: asset, cashAddress: cash, managerAddress: manager, subId };
    let cancelled = false;
    let minBlock = refreshRequest.minBlock;
    async function load() {
      try {
        const read = await readFutureAccount(account, pinned, minBlock);
        // Only the first read waits for the receipt's block; the poll reads latest.
        minBlock = null;
        if (!cancelled) {
          setState({ ...read, status: "ready" });
        }
      } catch {
        // Keep the last good read on screen rather than blanking it on one failed poll.
        if (!cancelled) {
          setState((current) => ({ ...current, status: "error" }));
        }
      }
    }

    setState((current) =>
      current.status === "idle" ? { ...current, status: "loading" } : current
    );
    void load();
    const timer = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [subaccountId, asset, cash, manager, subId, refreshRequest]);

  return {
    ...state,
    refresh: (minBlock: bigint | null = null) => setRefreshRequest({ minBlock }),
  };
}
