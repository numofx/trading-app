"use client";

import { Duration } from "effect";
import { useEffect, useState } from "react";
import { parseAbi, parseAbiItem } from "viem";
import { base } from "viem/chains";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import { buildFundingPayments, estimateFundingAccrual } from "@/lib/perp-funding-history";
import type {
  PerpFundingAccrual,
  PerpFundingLog,
  PerpFundingPayment,
} from "@/lib/perp-funding-history.types";

const POLL_INTERVAL_MS = Duration.toMillis("1 minute");

// The cNGN-PERP asset 0xC74E…8b8E was deployed here; no funding event can be older. On Sepolia,
// the Matching floor the subaccount scan uses.
const PERP_EVENT_FLOOR_BLOCK_MAINNET = 51_998_433n;
const PERP_EVENT_FLOOR_BLOCK_SEPOLIA = 40_461_151n;
// Well inside what the keyed RPC serves per `eth_getLogs`; the perp emits a few events per trade.
const LOG_WINDOW_BLOCKS = 5_000_000n;

const FUNDING_EVENTS = [
  parseAbiItem(
    "event AggregatedFundingUpdated(int256 aggregatedFundingRate, int256 fundingRate, uint256 lastFundingPaidAt)"
  ),
  parseAbiItem(
    "event FundingAppliedOnAccount(uint256 accountId, int256 funding, int256 aggregatedFundingRate)"
  ),
];

const PERP_ABI = parseAbi([
  "function aggregatedFunding() view returns (int256)",
  "function lastFundingPaidAt() view returns (uint256)",
  "function getFundingRate() view returns (int256)",
  "function getIndexPrice() view returns (uint256, uint256)",
  "function positions(uint256) view returns (uint256 lastMarkPrice, int256 funding, int256 pnl, int256 lastAggregatedFunding, uint256 lastFundingPaid)",
]);

type FundingHistoryState = {
  accrual: PerpFundingAccrual | null;
  payments: PerpFundingPayment[];
  status: "idle" | "loading" | "ready" | "error";
};

const IDLE: FundingHistoryState = { accrual: null, payments: [], status: "idle" };

async function readFundingLogs(perp: `0x${string}`): Promise<PerpFundingLog[]> {
  const client = createBasePublicClient();
  const head = await client.getBlockNumber();
  const floor =
    getAppChain().id === base.id ? PERP_EVENT_FLOOR_BLOCK_MAINNET : PERP_EVENT_FLOOR_BLOCK_SEPOLIA;
  const logs: PerpFundingLog[] = [];
  for (let from = floor; from <= head; from += LOG_WINDOW_BLOCKS) {
    const to = from + LOG_WINDOW_BLOCKS - 1n < head ? from + LOG_WINDOW_BLOCKS - 1n : head;
    const window = await client.getLogs({
      address: perp,
      events: FUNDING_EVENTS,
      fromBlock: from,
      strict: true,
      toBlock: to,
    });
    for (const log of window) {
      logs.push(
        log.eventName === "AggregatedFundingUpdated"
          ? {
              eventName: log.eventName,
              fundingRate: log.args.fundingRate,
              lastFundingPaidAt: log.args.lastFundingPaidAt,
            }
          : {
              accountId: log.args.accountId,
              aggregatedFundingRate: log.args.aggregatedFundingRate,
              eventName: log.eventName,
              funding: log.args.funding,
            }
      );
    }
  }
  return logs;
}

async function readAccrual(perp: `0x${string}`, accountId: bigint, size: bigint) {
  if (size === 0n) {
    return null;
  }
  const client = createBasePublicClient();
  const [aggregatedFunding, lastFundingPaidAt, fundingRate, [indexPrice], position] =
    await client.multicall({
      allowFailure: false,
      contracts: [
        { abi: PERP_ABI, address: perp, functionName: "aggregatedFunding" },
        { abi: PERP_ABI, address: perp, functionName: "lastFundingPaidAt" },
        { abi: PERP_ABI, address: perp, functionName: "getFundingRate" },
        { abi: PERP_ABI, address: perp, functionName: "getIndexPrice" },
        { abi: PERP_ABI, address: perp, args: [accountId], functionName: "positions" },
      ],
    });
  return estimateFundingAccrual({
    aggregatedFunding,
    fundingRate,
    indexPrice,
    lastAggregatedFunding: position[3],
    lastFundingPaidAt,
    nowSeconds: BigInt(Math.floor(Date.now() / 1000)),
    size,
  });
}

/**
 * The account's funding, read from the PerpAsset's own events while the tab is open and re-read
 * every minute: each payment the contract booked, and what the open position has accrued since.
 * `size` is the open position in whole cNGN, signed (positive long), or 0 with none.
 */
export function usePerpFundingHistory({
  enabled,
  perp,
  size,
  subaccountId,
}: {
  enabled: boolean;
  perp: `0x${string}` | null;
  size: bigint;
  subaccountId: string | null;
}) {
  const [state, setState] = useState<FundingHistoryState>(IDLE);

  useEffect(() => {
    if (!enabled || perp === null || subaccountId === null) {
      return;
    }
    const asset = perp;
    const accountId = BigInt(subaccountId);
    let cancelled = false;
    async function load() {
      try {
        const [logs, accrual] = await Promise.all([
          readFundingLogs(asset),
          readAccrual(asset, accountId, size),
        ]);
        if (!cancelled) {
          setState({ accrual, payments: buildFundingPayments(logs, accountId), status: "ready" });
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
  }, [enabled, perp, size, subaccountId]);

  return state;
}
