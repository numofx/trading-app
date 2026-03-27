"use client";

import { useEffect, useState } from "react";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { base } from "viem/chains";
import { createPublicClient, createWalletClient, custom, decodeEventLog, getAddress, http, parseAbiItem } from "viem";

const DEFAULT_BASE_RPC_URL = "https://mainnet.base.org";
const DEFAULT_CHAIN_ID = 8453;
const DEFAULT_MATCHING_ADDRESS = "0xe4c2a55401F73A540CA6e1C43067Aa7164f89088";
const DEFAULT_SUBACCOUNT_CREATOR_ADDRESS = "0x5448B304AD283f24A741B54AE9b3a71C8d7DCDF2";
const DEFAULT_USDCCNGN_MANAGER_ADDRESS = "0x0777C37C3925666474C77f5907E3805177705543";
const DEFAULT_USDC_DELIVERABLE_BASE_ASSET_ADDRESS = "0x25b77602a493ec8fe2155b8E82be8Bc447c955c5";
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

  return parsedChainId;
}

function getMatchingAddress() {
  return getAddress(process.env.NEXT_PUBLIC_MATCHING_ADDRESS?.trim() || DEFAULT_MATCHING_ADDRESS);
}

function getSubaccountCreatorAddress() {
  return getAddress(process.env.NEXT_PUBLIC_SUBACCOUNT_CREATOR_ADDRESS?.trim() || DEFAULT_SUBACCOUNT_CREATOR_ADDRESS);
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
    chain: base,
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
    chain: base,
    transport: custom(provider),
  });
  const [account] = await walletClient.getAddresses();

  if (!account) {
    throw new Error("Connected wallet address unavailable");
  }

  const hash = await walletClient.writeContract({
    abi: [
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
    address: getSubaccountCreatorAddress(),
    args: [getUSDCDeliverableBaseAssetAddress(), 0n, getUSDCCNGNManagerAddress()],
    functionName: "createAndDepositSubAccount",
  });

  const publicClient = createBasePublicClient();
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
