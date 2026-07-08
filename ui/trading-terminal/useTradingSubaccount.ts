"use client";

import { useEffect, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";
import { createWalletClient, custom, decodeEventLog, getAddress } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import {
  depositedSubAccountEvent,
  getMatchingAddress,
  getSubaccountCreatorAddress,
  getUsdcCngnManagerAddress,
  getWrappedUsdcAssetAddress,
} from "@/lib/subaccount-deposit-config";

const DEFAULT_CHAIN_ID = 84_532;
const DEFAULT_TRADE_MODULE_ADDRESS = "0x0AAE65AaA66Fe7f54486cDbD007956d3De611990";
// The public Base Sepolia RPC caps eth_getLogs at a 2000-block span per query.
const LOG_QUERY_BLOCK_RANGE = 2000n;
// Block at which the Matching contract (DEFAULT_MATCHING_ADDRESS) was deployed on
// Base Sepolia. Used as the scan floor so subaccount lookups terminate here
// instead of walking back to genesis (~43M blocks). Update this if
// NEXT_PUBLIC_MATCHING_ADDRESS is pointed at a different deployment.
const SUBACCOUNT_EVENT_FLOOR_BLOCK = 40_461_151n;

function getMatchingChainId() {
  const configuredChainId = process.env.NEXT_PUBLIC_MATCHING_CHAIN_ID?.trim();

  if (!configuredChainId) {
    return DEFAULT_CHAIN_ID;
  }

  const parsedChainId = Number(configuredChainId);

  if (!Number.isInteger(parsedChainId) || parsedChainId <= 0) {
    throw new Error("NEXT_PUBLIC_MATCHING_CHAIN_ID must be a positive integer");
  }

  if (parsedChainId !== DEFAULT_CHAIN_ID) {
    throw new Error(`NEXT_PUBLIC_MATCHING_CHAIN_ID must be ${DEFAULT_CHAIN_ID} (Base Sepolia)`);
  }

  return parsedChainId;
}

function getTradeModuleAddress() {
  return getAddress(process.env.NEXT_PUBLIC_TRADE_MODULE_ADDRESS?.trim() || DEFAULT_TRADE_MODULE_ADDRESS);
}

async function findTradingSubaccountId(ownerAddress: string) {
  const publicClient = createBasePublicClient();
  const latestBlock = await publicClient.getBlockNumber();
  const normalizedOwnerAddress = getAddress(ownerAddress);
  let windowEnd = latestBlock;

  while (windowEnd >= SUBACCOUNT_EVENT_FLOOR_BLOCK) {
    const rangeStart = windowEnd > LOG_QUERY_BLOCK_RANGE ? windowEnd - LOG_QUERY_BLOCK_RANGE + 1n : 0n;
    const windowStart = rangeStart > SUBACCOUNT_EVENT_FLOOR_BLOCK ? rangeStart : SUBACCOUNT_EVENT_FLOOR_BLOCK;
    const logs = await publicClient.getLogs({
      address: getMatchingAddress(),
      args: {
        owner: normalizedOwnerAddress,
      },
      event: depositedSubAccountEvent,
      fromBlock: windowStart,
      toBlock: windowEnd,
    });
    const latestLog = logs.at(-1);

    if (latestLog?.args.accountId) {
      return latestLog.args.accountId.toString();
    }

    if (windowStart === SUBACCOUNT_EVENT_FLOOR_BLOCK) {
      return null;
    }

    windowEnd = windowStart - 1n;
  }

  return null;
}

async function createTradingSubaccount(wallet: ConnectedWallet) {
  const targetChainId = getMatchingChainId();

  await wallet.switchChain(targetChainId);

  const provider = await wallet.getEthereumProvider();
  const walletClient = createWalletClient({
    chain: baseSepolia,
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
            inputs: [
              { name: "baseAsset", type: "address" },
              { name: "initDeposit", type: "uint256" },
              { name: "manager", type: "address" },
            ],
            name: "createAndDepositSubAccount",
            outputs: [{ name: "accountId", type: "uint256" }],
            stateMutability: "nonpayable",
            type: "function",
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
        throw new Error("Trading account creation completed, but the deposited subaccount id could not be resolved");
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
