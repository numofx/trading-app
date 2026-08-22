"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import posthog from "posthog-js";
import { useState } from "react";
import { createWalletClient, custom, erc20Abi, getAddress } from "viem";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import { getSubaccountsAddress } from "@/lib/subaccount-deposit-config";
import type { ScaledBalance } from "@/lib/subaccount-withdraw";
import { describeWithdrawFailure, validateWithdrawAmount } from "@/lib/subaccount-withdraw";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";

/**
 * Pays an account's balance of one asset back out to an address. The escrow is the same contract a
 * deposit pays into, so what went in through the Deposit tab comes out through this.
 */
const withdrawAbi = [
  {
    name: "withdraw",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
    inputs: [
      { name: "accountId", type: "uint256" },
      { name: "assetAmount", type: "uint256" },
      { name: "recipient", type: "address" },
    ],
  },
] as const;

const subaccountsOwnerAbi = [
  {
    inputs: [{ name: "tokenId", type: "uint256" }],
    name: "ownerOf",
    outputs: [{ type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type WithdrawFlowState =
  /** Reading decimals, ownership and simulating the call — before anything reaches the wallet. */
  | { status: "checking" }
  /** Waiting for the trader to sign. */
  | { status: "signing" }
  | { status: "confirming"; txHash: `0x${string}` }
  | { status: "success"; txHash: `0x${string}` }
  /** Rejected before signing: the amount, the ownership, or a simulation that reverted. */
  | { status: "blocked"; reason: string }
  | { status: "failed"; error: string };

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Withdrawal failed";
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
 * The withdrawal flow: one transaction, but only after the chain agrees it would succeed.
 *
 * The simulation is the point. Both mainnet escrows can be short of the tokens their ledger claims
 * — the USDC CashAsset is short venue-wide — and without a dry run the trader signs, pays gas, and
 * watches it revert. Simulating first turns that into a sentence on screen with nothing spent.
 */
export function useSubaccountWithdraw({ onWithdrawn }: { onWithdrawn?: () => void }) {
  const [flowState, setFlowState] = useState<WithdrawFlowState | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  function reset() {
    setFlowState(null);
    setInputError(null);
  }

  function clearInputError() {
    setInputError(null);
  }

  async function startWithdraw({
    amountInput,
    asset,
    balance,
    recipient,
    subaccountId,
    wallet,
  }: {
    amountInput: string;
    /** The escrow being drawn on, and the token it pays out. */
    asset: WithdrawableAsset;
    /** The account's balance of this asset, in whatever scale the caller holds it. */
    balance: ScaledBalance | null;
    /** Where the tokens land — the connected wallet. */
    recipient: string;
    subaccountId: string | null;
    wallet: ConnectedWallet;
  }) {
    if (subaccountId === null) {
      setInputError("This wallet has no trading account to withdraw from.");
      return;
    }

    const currency = asset.symbol;
    setInputError(null);
    setFlowState({ status: "checking" });

    try {
      const publicClient = createBasePublicClient();
      const owner = getAddress(wallet.address);
      const accountId = BigInt(subaccountId);

      const [tokenDecimals, accountOwner] = await Promise.all([
        publicClient.readContract({
          abi: erc20Abi,
          address: asset.token,
          functionName: "decimals",
        }),
        publicClient.readContract({
          abi: subaccountsOwnerAbi,
          address: getSubaccountsAddress(),
          args: [accountId],
          functionName: "ownerOf",
        }),
      ]);

      // A subaccount deposited into Matching is owned by Matching, and the escrow will not pay out
      // on this wallet's say-so. Better to name that than to let the simulation fail obscurely.
      if (getAddress(accountOwner) !== owner) {
        setFlowState({
          reason: `Trading account #${subaccountId} is held by another address, so this wallet cannot withdraw from it.`,
          status: "blocked",
        });
        return;
      }

      const amount = validateWithdrawAmount({
        amountInput,
        balance,
        currency,
        tokenDecimals,
      });

      if (amount.kind === "invalid") {
        setInputError(amount.reason);
        setFlowState(null);
        return;
      }

      const call = {
        abi: withdrawAbi,
        account: owner,
        address: asset.escrow,
        args: [accountId, amount.amountUnits, getAddress(recipient)],
        functionName: "withdraw",
      } as const;

      try {
        await publicClient.simulateContract(call);
      } catch (error) {
        setFlowState({
          reason: describeWithdrawFailure(getErrorMessage(error), currency),
          status: "blocked",
        });
        return;
      }

      setFlowState({ status: "signing" });
      const walletClient = await createConnectedWalletClient(wallet);
      const txHash = await walletClient.writeContract(call);

      setFlowState({ status: "confirming", txHash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

      if (receipt.status !== "success") {
        setFlowState({ error: "The withdrawal transaction reverted.", status: "failed" });
        return;
      }

      posthog.capture("withdraw_confirmed", {
        subaccount_id: subaccountId,
        withdraw_asset: asset.id,
      });
      setFlowState({ status: "success", txHash });
      onWithdrawn?.();
    } catch (error) {
      const message = describeWithdrawFailure(getErrorMessage(error), currency);
      posthog.capture("withdraw_failed", { error_message: message, withdraw_asset: asset.id });
      setFlowState({ error: message, status: "failed" });
    }
  }

  return { clearInputError, flowState, inputError, reset, startWithdraw };
}
