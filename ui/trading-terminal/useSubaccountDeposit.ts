"use client";

import posthog from "posthog-js";
import type { ConnectedWallet } from "@privy-io/react-auth";
import { useEffect, useEffectEvent, useState } from "react";
import { createWalletClient, custom, decodeEventLog, erc20Abi, getAddress, parseUnits } from "viem";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import {
  getDepositEffect,
  startDepositFlow,
  transitionDepositFlow,
} from "@/lib/subaccount-deposit-machine";
import {
  depositedSubAccountEvent,
  getDepositAddresses,
  getMatchingAddress,
} from "@/lib/subaccount-deposit-config";
import type {
  DepositFlowEvent,
  DepositFlowState,
  DepositPreflight,
} from "@/lib/subaccount-deposit.types";

const DECIMAL_INPUT_PATTERN = /^(\d+(\.\d+)?|\.\d+)$/;

const wrappedAssetAbi = [
  {
    inputs: [],
    name: "wlEnabled",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "accountId", type: "uint256" }],
    name: "wlAccounts",
    outputs: [{ type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { name: "recipientAccount", type: "uint256" },
      { name: "assetAmount", type: "uint256" },
    ],
    name: "deposit",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const subaccountCreatorAbi = [
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
] as const;

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Deposit step failed";
}

async function createConnectedWalletClient(wallet: ConnectedWallet) {
  const chain = getAppChain();
  await wallet.switchChain(chain.id);
  const provider = await wallet.getEthereumProvider();

  return createWalletClient({
    account: getAddress(wallet.address),
    chain,
    transport: custom(provider),
  });
}

/**
 * Read the whitelist gate if the deployed asset has one. Plain WrappedERC20Asset
 * deployments (like the current Base Sepolia one) have no wlEnabled() and revert,
 * which means deposits are ungated.
 */
async function readWhitelistState(
  publicClient: ReturnType<typeof createBasePublicClient>,
  assetAddress: `0x${string}`,
  subaccountId: string | null
): Promise<Pick<DepositPreflight, "whitelistEnabled" | "whitelisted">> {
  try {
    const whitelistEnabled = await publicClient.readContract({
      abi: wrappedAssetAbi,
      address: assetAddress,
      functionName: "wlEnabled",
    });

    if (!whitelistEnabled || subaccountId === null) {
      return { whitelistEnabled, whitelisted: null };
    }

    const whitelisted = await publicClient.readContract({
      abi: wrappedAssetAbi,
      address: assetAddress,
      args: [BigInt(subaccountId)],
      functionName: "wlAccounts",
    });

    return { whitelistEnabled, whitelisted };
  } catch {
    return { whitelistEnabled: false, whitelisted: null };
  }
}

async function readPreflight(effect: {
  owner: `0x${string}`;
  spender: `0x${string}`;
  subaccountId: string | null;
  token: `0x${string}`;
}): Promise<DepositPreflight> {
  const publicClient = createBasePublicClient();
  const assetAddress = getDepositAddresses().baseAssetContract;

  const [allowance, tokenBalance, tokenDecimals, whitelistState] = await Promise.all([
    publicClient.readContract({
      abi: erc20Abi,
      address: effect.token,
      args: [effect.owner, effect.spender],
      functionName: "allowance",
    }),
    publicClient.readContract({
      abi: erc20Abi,
      address: effect.token,
      args: [effect.owner],
      functionName: "balanceOf",
    }),
    publicClient.readContract({
      abi: erc20Abi,
      address: effect.token,
      functionName: "decimals",
    }),
    readWhitelistState(publicClient, assetAddress, effect.subaccountId),
  ]);

  return { allowance, tokenBalance, tokenDecimals, ...whitelistState };
}

/** Extract the created subaccount id from a createAndDepositSubAccount receipt. */
function extractDepositedSubaccountId(receipt: {
  logs: {
    address: string;
    data: `0x${string}`;
    topics: [] | [`0x${string}`, ...`0x${string}`[]];
  }[];
}) {
  const matchingAddress = getMatchingAddress().toLowerCase();

  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== matchingAddress) {
      continue;
    }

    try {
      const decodedLog = decodeEventLog({
        abi: [depositedSubAccountEvent],
        data: log.data,
        topics: log.topics,
      });

      if (decodedLog.eventName === "DepositedSubAccount") {
        return decodedLog.args.accountId.toString();
      }
    } catch {
      // Not the DepositedSubAccount event; keep scanning.
    }
  }

  return null;
}

/** Wait for a receipt and translate it into the machine event for the step it confirms. */
async function resolveReceiptEvent(
  txHash: `0x${string}`,
  isApprovalReceipt: boolean
): Promise<DepositFlowEvent> {
  const publicClient = createBasePublicClient();
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

  if (receipt.status !== "success") {
    return { error: "Transaction reverted on-chain", type: "ERRORED" };
  }

  if (isApprovalReceipt) {
    return { type: "APPROVAL_CONFIRMED" };
  }

  const createdSubaccountId = extractDepositedSubaccountId(receipt);
  return createdSubaccountId === null
    ? { type: "DEPOSIT_CONFIRMED" }
    : { subaccountId: createdSubaccountId, type: "DEPOSIT_CONFIRMED" };
}

/**
 * Drives the deposit state machine against Base Sepolia. Reads (preflight) and
 * receipt waits run automatically; approve() and deposit() are user-initiated so
 * each wallet signature maps to an explicit click.
 */
export function useSubaccountDeposit({
  onDeposited,
}: {
  onDeposited?: (subaccountId: string) => void;
} = {}) {
  const [flowState, setFlowState] = useState<DepositFlowState | null>(null);
  const [activeWallet, setActiveWallet] = useState<ConnectedWallet | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  function dispatch(event: DepositFlowEvent) {
    setFlowState((current) => (current === null ? current : transitionDepositFlow(current, event)));
  }

  const notifyDeposited = useEffectEvent((subaccountId: string) => {
    onDeposited?.(subaccountId);
  });

  useEffect(() => {
    if (flowState === null) {
      return;
    }

    if (flowState.status === "success") {
      posthog.capture("deposit_confirmed", {
        subaccount_id: flowState.subaccountId,
      });
      notifyDeposited(flowState.subaccountId);
      return;
    }

    if (flowState.status === "failed") {
      posthog.captureException(new Error(flowState.error), {
        properties: { deposit_flow_status: "failed" },
      });
      posthog.capture("deposit_failed", {
        error_message: flowState.error,
      });
    }

    const effect = getDepositEffect(flowState);

    // request-approval / request-deposit wait for an explicit user action.
    if (
      effect === null ||
      effect.kind === "request-approval" ||
      effect.kind === "request-deposit"
    ) {
      return;
    }

    // Re-bind after the guard so the narrowed union survives into the async closure.
    const pendingEffect = effect;
    const isApprovalReceipt = flowState.status === "approving";
    let cancelled = false;

    async function runEffect() {
      try {
        const event =
          pendingEffect.kind === "read-preflight"
            ? ({
                preflight: await readPreflight(pendingEffect),
                type: "PREFLIGHT_RESOLVED",
              } as const)
            : await resolveReceiptEvent(pendingEffect.txHash, isApprovalReceipt);

        if (!cancelled) {
          dispatch(event);
        }
      } catch (error) {
        if (!cancelled) {
          dispatch({ error: getErrorMessage(error), type: "ERRORED" });
        }
      }
    }

    void runEffect();

    return () => {
      cancelled = true;
    };
  }, [flowState]);

  async function startDeposit(
    wallet: ConnectedWallet,
    amountInput: string,
    subaccountId: string | null
  ) {
    const trimmedAmount = amountInput.trim().replaceAll(",", "");

    if (!DECIMAL_INPUT_PATTERN.test(trimmedAmount)) {
      setInputError("Enter a valid USDC amount");
      return;
    }

    setInputError(null);
    setActiveWallet(wallet);

    const addresses = getDepositAddresses();

    try {
      const publicClient = createBasePublicClient();
      const tokenDecimals = await publicClient.readContract({
        abi: erc20Abi,
        address: addresses.token,
        functionName: "decimals",
      });

      setFlowState(
        startDepositFlow({
          addresses,
          amountUnits: parseUnits(trimmedAmount, tokenDecimals),
          subaccountId,
          walletAddress: getAddress(wallet.address),
        })
      );
    } catch (error) {
      setInputError(getErrorMessage(error));
    }
  }

  async function approve() {
    if (flowState?.status !== "awaiting-approval" || activeWallet === null) {
      return;
    }

    const effect = getDepositEffect(flowState);
    if (effect?.kind !== "request-approval") {
      return;
    }

    try {
      const walletClient = await createConnectedWalletClient(activeWallet);
      const txHash = await walletClient.writeContract({
        abi: erc20Abi,
        address: effect.token,
        args: [effect.spender, effect.amountUnits],
        functionName: "approve",
      });
      dispatch({ txHash, type: "APPROVAL_SUBMITTED" });
    } catch (error) {
      dispatch({ error: getErrorMessage(error), type: "ERRORED" });
    }
  }

  async function deposit() {
    if (flowState?.status !== "awaiting-deposit" || activeWallet === null) {
      return;
    }

    const effect = getDepositEffect(flowState);
    if (effect?.kind !== "request-deposit") {
      return;
    }

    try {
      const walletClient = await createConnectedWalletClient(activeWallet);
      let txHash: `0x${string}`;

      if (effect.path === "create-and-deposit") {
        txHash = await walletClient.writeContract({
          abi: subaccountCreatorAbi,
          address: effect.addresses.subaccountCreator,
          args: [effect.addresses.baseAssetContract, effect.amountUnits, effect.addresses.manager],
          functionName: "createAndDepositSubAccount",
        });
      } else {
        if (effect.subaccountId === null) {
          dispatch({ error: "Deposit requires a trading subaccount id", type: "ERRORED" });
          return;
        }
        txHash = await walletClient.writeContract({
          abi: wrappedAssetAbi,
          address: effect.addresses.baseAssetContract,
          args: [BigInt(effect.subaccountId), effect.amountUnits],
          functionName: "deposit",
        });
      }

      dispatch({ txHash, type: "DEPOSIT_SUBMITTED" });
    } catch (error) {
      dispatch({ error: getErrorMessage(error), type: "ERRORED" });
    }
  }

  function retry() {
    dispatch({ type: "RETRY" });
  }

  function reset() {
    setFlowState(null);
    setActiveWallet(null);
    setInputError(null);
  }

  return {
    approve,
    deposit,
    flowState,
    inputError,
    reset,
    retry,
    startDeposit,
  };
}
