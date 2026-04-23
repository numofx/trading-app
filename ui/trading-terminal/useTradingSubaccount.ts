"use client";

import { useEffect, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";
import { createPublicClient, createWalletClient, custom, decodeEventLog, getAddress, http, parseAbiItem } from "viem";

const DEFAULT_BASE_RPC_URL = "https://sepolia.base.org";
const DEFAULT_CHAIN_ID = 84_532;
const DEFAULT_MATCHING_ADDRESS = "0x1599636347FD5bA1fBE21D58AfE0b8B9cbe283FF";
const DEFAULT_TRADE_MODULE_ADDRESS = "0x0AAE65AaA66Fe7f54486cDbD007956d3De611990";
const DEFAULT_SUBACCOUNT_CREATOR_ADDRESS = "0x5448B304AD283f24A741B54AE9b3a71C8d7DCDF2";
const DEFAULT_USDCCNGN_MANAGER_ADDRESS = "0x1917960763BF3a0DfA10a05f0a112E828C1A934f";
const DEFAULT_USDC_DELIVERABLE_BASE_ASSET_ADDRESS = "0x8b3C43D2b2555ca3fc4Fa1BC34544133B8576110";
const LOG_QUERY_BLOCK_RANGE = 10_000n;

const depositedSubAccountEvent = parseAbiItem("event DepositedSubAccount(uint indexed accountId, address indexed owner)");

function getBaseRpcUrl() {
  return process.env.NEXT_PUBLIC_BASE_RPC_URL?.trim() || DEFAULT_BASE_RPC_URL;
}

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

function getMatchingAddress() {
  return getAddress(process.env.NEXT_PUBLIC_MATCHING_ADDRESS?.trim() || DEFAULT_MATCHING_ADDRESS);
}

function getSubaccountCreatorAddress() {
  return getAddress(process.env.NEXT_PUBLIC_SUBACCOUNT_CREATOR_ADDRESS?.trim() || DEFAULT_SUBACCOUNT_CREATOR_ADDRESS);
}

function getTradeModuleAddress() {
  return getAddress(process.env.NEXT_PUBLIC_TRADE_MODULE_ADDRESS?.trim() || DEFAULT_TRADE_MODULE_ADDRESS);
}

function getUSDCCNGNManagerAddress() {
  return getAddress(process.env.NEXT_PUBLIC_USDCCNGN_MANAGER_ADDRESS?.trim() || DEFAULT_USDCCNGN_MANAGER_ADDRESS);
}

function getUSDCDeliverableBaseAssetAddress() {
  return getAddress(
    process.env.NEXT_PUBLIC_USDC_DELIVERABLE_BASE_ASSET_ADDRESS?.trim() || DEFAULT_USDC_DELIVERABLE_BASE_ASSET_ADDRESS,
  );
}

function createBasePublicClient() {
  return createPublicClient({
    chain: baseSepolia,
    transport: http(getBaseRpcUrl()),
  });
}

async function findTradingSubaccountId(ownerAddress: string) {
  const publicClient = createBasePublicClient();
  const latestBlock = await publicClient.getBlockNumber();
  const normalizedOwnerAddress = getAddress(ownerAddress);
  let windowEnd = latestBlock;

  while (true) {
    const windowStart = windowEnd > LOG_QUERY_BLOCK_RANGE ? windowEnd - LOG_QUERY_BLOCK_RANGE + 1n : 0n;
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

    if (windowStart === 0n) {
      return null;
    }

    windowEnd = windowStart - 1n;
  }
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
      : [getUSDCDeliverableBaseAssetAddress(), 0n, getUSDCCNGNManagerAddress()],
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

  return {
    ensureTradingSubaccount,
    isLoading,
    subaccountId,
  };
}
