"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import { createWalletClient, custom, decodeEventLog, getAddress } from "viem";
import { base } from "viem/chains";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import {
  depositedSubAccountEvent,
  getTradeModuleAddress as getConfiguredTradeModuleAddress,
  getMatchingAddress,
  getSubaccountCreatorAddress,
  getUsdcCngnManagerAddress,
  getWrappedUsdcAssetAddress,
} from "@/lib/subaccount-deposit-config";
import {
  buildSubaccountCacheKey,
  readSubaccountCache,
  resolveScanFloor,
  writeSubaccountCache,
} from "@/lib/trading-subaccount-cache";

/**
 * Blocks per `eth_getLogs` query when scanning for a subaccount.
 *
 * The default is what the public Base RPCs accept, and it is far too slow for mainnet: the ~1.5M
 * blocks since the Matching deployment take ~750 sequential calls, and Base adds ~22 more a day.
 * Until that finishes the app reports no trading account at all, offering to create a second one.
 *
 * Providers with a higher limit collapse this. Alchemy serves the entire range in one 1.1s call,
 * so set `NEXT_PUBLIC_LOG_QUERY_BLOCK_RANGE=1000000` alongside a `NEXT_PUBLIC_BASE_RPC_URL` that
 * supports it. Too large a value for the configured provider makes it reject every query, so
 * raise it only to what that endpoint allows.
 */
const DEFAULT_LOG_QUERY_BLOCK_RANGE = 2000n;

/**
 * How far below the last scanned block a cached result is re-scanned, so a reorg near the previous
 * head cannot drop an event.
 *
 * Deliberately independent of the query window. Reorgs are a handful of blocks deep; ~2000 is
 * roughly an hour on Base and costs one query. Tying this to the window would mean a provider
 * configured for a 1,000,000-block span re-scanned a million blocks on every visit, which is the
 * work the cache exists to avoid.
 */
const REORG_SAFETY_BLOCKS = 2000n;

function getLogQueryBlockRange() {
  const configured = process.env.NEXT_PUBLIC_LOG_QUERY_BLOCK_RANGE?.trim();
  if (!configured) {
    return DEFAULT_LOG_QUERY_BLOCK_RANGE;
  }

  try {
    const parsed = BigInt(configured);
    return parsed > 0n ? parsed : DEFAULT_LOG_QUERY_BLOCK_RANGE;
  } catch {
    // A malformed value must not break the lookup — fall back to the safe span.
    return DEFAULT_LOG_QUERY_BLOCK_RANGE;
  }
}
// Block at which the Matching contract was deployed, per chain. Used as the scan
// floor so subaccount lookups terminate there instead of walking back to genesis.
// Update if NEXT_PUBLIC_MATCHING_ADDRESS is pointed at a different deployment.
const SUBACCOUNT_EVENT_FLOOR_BLOCK_SEPOLIA = 40_461_151n;
const SUBACCOUNT_EVENT_FLOOR_BLOCK_MAINNET = 48_833_365n; // matching 0x9E90…F191

function getSubaccountEventFloorBlock() {
  return getAppChain().id === base.id
    ? SUBACCOUNT_EVENT_FLOOR_BLOCK_MAINNET
    : SUBACCOUNT_EVENT_FLOOR_BLOCK_SEPOLIA;
}

function getMatchingChainId() {
  return getAppChain().id;
}

/** Shared with order submission so the module cannot differ between creating and trading. */
function getTradeModuleAddress() {
  return getConfiguredTradeModuleAddress();
}

/**
 * Scans `DepositedSubAccount` logs backwards from `latestBlock` to `floorBlock`, returning the
 * most recent subaccount for the owner, or null once the floor is reached without a match.
 */
async function scanForSubaccountId(
  ownerAddress: `0x${string}`,
  latestBlock: bigint,
  floorBlock: bigint
) {
  const publicClient = createBasePublicClient();
  const normalizedOwnerAddress = ownerAddress;
  const blockRange = getLogQueryBlockRange();
  let windowEnd = latestBlock;

  while (windowEnd >= floorBlock) {
    const rangeStart = windowEnd > blockRange ? windowEnd - blockRange + 1n : 0n;
    const windowStart = rangeStart > floorBlock ? rangeStart : floorBlock;
    const logs = await publicClient.getLogs({
      address: getMatchingAddress(),
      event: depositedSubAccountEvent,
      fromBlock: windowStart,
      toBlock: windowEnd,
      args: {
        owner: normalizedOwnerAddress,
      },
    });
    const latestLog = logs.at(-1);

    if (latestLog?.args.accountId) {
      return latestLog.args.accountId.toString();
    }

    if (windowStart === floorBlock) {
      return null;
    }

    windowEnd = windowStart - 1n;
  }

  return null;
}

/**
 * Resolves the wallet's trading subaccount, scanning only the blocks produced since the last
 * lookup.
 *
 * The first call for a wallet still scans the full range, but it is the only one that does: the
 * result and the block it was accurate as of are cached, so later calls scan a few hundred blocks
 * instead of the ~800k (and growing) between the Matching deployment and the chain head. A null
 * result is cached too — a wallet with no subaccount is the case that scans the whole range.
 */
async function findTradingSubaccountId(ownerAddress: string) {
  const publicClient = createBasePublicClient();
  const latestBlock = await publicClient.getBlockNumber();
  const normalizedOwnerAddress = getAddress(ownerAddress);

  const cacheKey = buildSubaccountCacheKey({
    chainId: getMatchingChainId(),
    matchingAddress: getMatchingAddress(),
    ownerAddress: normalizedOwnerAddress,
  });
  const cached = readSubaccountCache(cacheKey);
  const scanFloor = resolveScanFloor({
    cached,
    floorBlock: getSubaccountEventFloorBlock(),
    latestBlock,
    reorgMargin: REORG_SAFETY_BLOCKS,
  });

  // A hit in the newly scanned range wins: it is a subaccount created since the cache was written.
  const found = await scanForSubaccountId(normalizedOwnerAddress, latestBlock, scanFloor);
  const resolved = found ?? cached?.subaccountId ?? null;

  writeSubaccountCache(cacheKey, {
    scannedToBlock: latestBlock.toString(),
    subaccountId: resolved,
  });

  return resolved;
}

async function createTradingSubaccount(wallet: ConnectedWallet) {
  const targetChainId = getMatchingChainId();

  await wallet.switchChain(targetChainId);

  const provider = await wallet.getEthereumProvider();
  const walletClient = createWalletClient({
    chain: getAppChain(),
    transport: custom(provider),
  });
  const [account] = await walletClient.getAddresses();

  if (!account) {
    throw new Error("Connected wallet address unavailable");
  }

  const publicClient = createBasePublicClient();
  const subaccountCreatorAddress = getSubaccountCreatorAddress();
  const creatorCode = await publicClient.getCode({
    address: subaccountCreatorAddress,
  });

  const shouldFallbackToMatching = creatorCode === undefined || creatorCode === "0x";
  const hash = await walletClient.writeContract({
    abi: shouldFallbackToMatching
      ? [
          {
            inputs: [{ name: "module", type: "address" }],
            name: "createSubAccount",
            outputs: [{ name: "accountId", type: "uint256" }],
            stateMutability: "nonpayable",
            type: "function",
          },
        ]
      : [
          {
            name: "createAndDepositSubAccount",
            outputs: [{ name: "accountId", type: "uint256" }],
            stateMutability: "nonpayable",
            type: "function",
            inputs: [
              { name: "baseAsset", type: "address" },
              { name: "initDeposit", type: "uint256" },
              { name: "manager", type: "address" },
            ],
          },
        ],
    account,
    address: shouldFallbackToMatching ? getMatchingAddress() : subaccountCreatorAddress,
    args: shouldFallbackToMatching
      ? [getTradeModuleAddress()]
      : // The creator expects the WLWrappedERC20Asset contract, not the ERC-20 token:
        // it calls baseAsset.wrappedAsset() to resolve the token when initDeposit > 0.
        [getWrappedUsdcAssetAddress(), 0n, getUsdcCngnManagerAddress()],
    functionName: shouldFallbackToMatching ? "createSubAccount" : "createAndDepositSubAccount",
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  const matchingAddress = getMatchingAddress();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== matchingAddress.toLowerCase()) {
      continue;
    }

    const decodedLog = decodeEventLog({
      abi: [depositedSubAccountEvent],
      data: log.data,
      topics: log.topics,
    });

    if (decodedLog.eventName !== "DepositedSubAccount") {
      continue;
    }

    return decodedLog.args.accountId.toString();
  }

  return await findTradingSubaccountId(account);
}

export function useTradingSubaccount(walletAddress: string | null) {
  const [subaccountId, setSubaccountId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;

    if (!walletAddress) {
      setSubaccountId(null);
      setIsLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setIsLoading(true);

    void findTradingSubaccountId(walletAddress)
      .then((nextSubaccountId) => {
        if (!cancelled) {
          setSubaccountId(nextSubaccountId);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  async function ensureTradingSubaccount(wallet: ConnectedWallet) {
    const existingSubaccountId = await findTradingSubaccountId(wallet.address);

    if (existingSubaccountId) {
      setSubaccountId(existingSubaccountId);
      return existingSubaccountId;
    }

    setIsLoading(true);

    try {
      const createdSubaccountId = await createTradingSubaccount(wallet);

      if (!createdSubaccountId) {
        throw new Error(
          "Trading account creation completed, but the deposited subaccount id could not be resolved"
        );
      }

      setSubaccountId(createdSubaccountId);
      return createdSubaccountId;
    } finally {
      setIsLoading(false);
    }
  }

  /** Adopt a subaccount id resolved outside this hook (e.g. created by the deposit flow). */
  function adoptSubaccountId(nextSubaccountId: string) {
    setSubaccountId(nextSubaccountId);
  }

  return {
    adoptSubaccountId,
    ensureTradingSubaccount,
    isLoading,
    subaccountId,
  };
}
