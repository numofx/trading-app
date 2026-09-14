"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import posthog from "posthog-js";
import { useState } from "react";
import { createWalletClient, custom, erc20Abi, getAddress } from "viem";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import { getMatchingAddress, getSubaccountsAddress } from "@/lib/subaccount-deposit-config";
import type { ScaledBalance } from "@/lib/subaccount-withdraw";
import { describeWithdrawFailure, validateWithdrawAmount } from "@/lib/subaccount-withdraw";
import type { WithdrawableAsset } from "@/lib/withdrawable-assets";
import { buildWithdrawalEnvelope, interpretWithdrawalResponse } from "@/lib/withdrawal-submission";
import type { WithdrawalSubmitOutcome } from "@/lib/withdrawal-submission.types";

/**
 * Pays an account's balance of one asset back out to an address. The escrow is the same contract a
 * deposit pays into, so what went in through the Deposit tab comes out through this. Only callable
 * by the account's holder, which is why an account Matching holds withdraws by signature instead.
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
  /** Reading decimals and who holds the account, and checking the amount, before anything reaches the wallet. */
  | { status: "checking" }
  /**
   * Waiting on the wallet. `signature` is a gasless signed withdrawal, for an account Matching holds;
   * `transaction` is an escrow call the wallet pays gas for, for an account the wallet holds itself.
   */
  | { method: "signature" | "transaction"; status: "signing" }
  /** The signed withdrawal is with the venue, which verifies it, simulates it and submits it. */
  | { status: "submitting" }
  | { status: "confirming"; txHash: `0x${string}` }
  | { status: "success"; txHash: `0x${string}` }
  /** Stopped with nothing sent: the amount, the account, a reverting simulation, or the venue refusing it. */
  | { status: "blocked"; reason: string }
  | { status: "failed"; error: string };

type PublicClient = ReturnType<typeof createBasePublicClient>;

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

/** The token's decimals and whoever holds the account's NFT: the wallet itself, Matching, or someone else. */
async function readWithdrawContext(asset: WithdrawableAsset, accountId: bigint) {
  const publicClient = createBasePublicClient();
  const [tokenDecimals, holder] = await Promise.all([
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
  return { holder: getAddress(holder), publicClient, tokenDecimals };
}

/**
 * Signs a withdrawal for an account Matching holds and hands it to the venue.
 *
 * The wallet signs a WithdrawalModule action, which costs no gas. markets-service checks the signature and that
 * Matching records this wallet as the account's owner; the venue's executor then simulates it and submits it.
 * A withdrawal that would revert comes back refused, with nothing sent.
 */
async function signAndSubmitWithdrawal({
  amountUnits,
  asset,
  onSigned,
  subaccountId,
  wallet,
}: {
  amountUnits: bigint;
  asset: WithdrawableAsset;
  onSigned: () => void;
  subaccountId: string;
  wallet: ConnectedWallet;
}): Promise<WithdrawalSubmitOutcome> {
  const envelope = buildWithdrawalEnvelope({
    amountUnits,
    assetAddress: asset.escrow,
    subaccountId,
    walletAddress: wallet.address,
  });
  const walletClient = await createConnectedWalletClient(wallet);
  const signature = await walletClient.signTypedData(envelope.typedData);
  onSigned();

  const response = await fetch("/api/withdrawals", {
    body: JSON.stringify({ ...envelope.payload, signature }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const body: unknown = await response.json().catch(() => null);
  return interpretWithdrawalResponse(response.status, body, asset.symbol);
}

/**
 * The withdrawal flow, by who holds the account.
 *
 * Matching holds every account the app creates, so those withdraw by signature: the venue submits them, and
 * simulates first, so a withdrawal that would revert is refused before anything is sent. An account the wallet
 * holds itself calls the escrow directly, simulated here first for the same reason — an escrow can be short of
 * the tokens its ledger claims, and without a dry run the trader signs, pays gas, and watches it revert.
 */
export function useSubaccountWithdraw({
  onWithdrawn,
}: {
  /** Receives the withdrawal receipt's block, so balances can be re-read at or past it. */
  onWithdrawn?: (blockNumber: bigint) => void;
}) {
  const [flowState, setFlowState] = useState<WithdrawFlowState | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);

  function reset() {
    setFlowState(null);
    setInputError(null);
  }

  function clearInputError() {
    setInputError(null);
  }

  function confirmWithdrawal({
    assetId,
    blockNumber,
    path,
    subaccountId,
    txHash,
  }: {
    assetId: string;
    blockNumber: bigint;
    path: "direct" | "matching";
    subaccountId: string;
    txHash: `0x${string}`;
  }) {
    posthog.capture("withdraw_confirmed", {
      subaccount_id: subaccountId,
      withdraw_asset: assetId,
      withdraw_path: path,
    });
    setFlowState({ status: "success", txHash });
    onWithdrawn?.(blockNumber);
  }

  async function finishSignedWithdrawal({
    assetId,
    outcome,
    publicClient,
    subaccountId,
  }: {
    assetId: string;
    outcome: WithdrawalSubmitOutcome;
    publicClient: PublicClient;
    subaccountId: string;
  }) {
    if (outcome.kind === "rejected") {
      setFlowState({ reason: outcome.reason, status: "blocked" });
      return;
    }
    if (outcome.kind === "unknown" || outcome.kind === "reverted") {
      posthog.capture("withdraw_failed", {
        error_message: outcome.reason,
        withdraw_asset: assetId,
        withdraw_path: "matching",
      });
      setFlowState({ error: outcome.reason, status: "failed" });
      return;
    }

    let blockNumber = outcome.kind === "settled" ? outcome.blockNumber : null;
    if (blockNumber === null) {
      // Broadcast but not confirmed when the venue answered: watch it land rather than call it failed.
      setFlowState({ status: "confirming", txHash: outcome.txHash });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: outcome.txHash });
      if (receipt.status !== "success") {
        setFlowState({
          error: "The withdrawal transaction reverted. Nothing was withdrawn.",
          status: "failed",
        });
        return;
      }
      blockNumber = receipt.blockNumber;
    }
    confirmWithdrawal({
      assetId,
      blockNumber,
      path: "matching",
      subaccountId,
      txHash: outcome.txHash,
    });
  }

  async function withdrawDirectly({
    accountId,
    amountUnits,
    asset,
    owner,
    publicClient,
    recipient,
    subaccountId,
    wallet,
  }: {
    accountId: bigint;
    amountUnits: bigint;
    asset: WithdrawableAsset;
    owner: `0x${string}`;
    publicClient: PublicClient;
    recipient: string;
    subaccountId: string;
    wallet: ConnectedWallet;
  }) {
    const call = {
      abi: withdrawAbi,
      account: owner,
      address: asset.escrow,
      args: [accountId, amountUnits, getAddress(recipient)],
      functionName: "withdraw",
    } as const;

    try {
      await publicClient.simulateContract(call);
    } catch (error) {
      setFlowState({
        reason: describeWithdrawFailure(getErrorMessage(error), asset.symbol),
        status: "blocked",
      });
      return;
    }

    setFlowState({ method: "transaction", status: "signing" });
    const walletClient = await createConnectedWalletClient(wallet);
    const txHash = await walletClient.writeContract(call);

    setFlowState({ status: "confirming", txHash });
    const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash });

    if (receipt.status !== "success") {
      setFlowState({ error: "The withdrawal transaction reverted.", status: "failed" });
      return;
    }
    confirmWithdrawal({
      assetId: asset.id,
      blockNumber: receipt.blockNumber,
      path: "direct",
      subaccountId,
      txHash,
    });
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
    /** Where the tokens land — the connected wallet. A signed withdrawal always pays the owner. */
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
      const owner = getAddress(wallet.address);
      const accountId = BigInt(subaccountId);
      const { holder, publicClient, tokenDecimals } = await readWithdrawContext(asset, accountId);
      const heldByMatching = holder === getMatchingAddress();

      if (!(heldByMatching || holder === owner)) {
        setFlowState({
          reason: `Trading account #${subaccountId} is held by ${holder}, which is neither this wallet nor the venue, so it cannot be withdrawn from here.`,
          status: "blocked",
        });
        return;
      }

      const amount = validateWithdrawAmount({ amountInput, balance, currency, tokenDecimals });
      if (amount.kind === "invalid") {
        setInputError(amount.reason);
        setFlowState(null);
        return;
      }

      if (heldByMatching) {
        setFlowState({ method: "signature", status: "signing" });
        const outcome = await signAndSubmitWithdrawal({
          amountUnits: amount.amountUnits,
          asset,
          onSigned: () => setFlowState({ status: "submitting" }),
          subaccountId,
          wallet,
        });
        await finishSignedWithdrawal({ assetId: asset.id, outcome, publicClient, subaccountId });
        return;
      }

      await withdrawDirectly({
        accountId,
        amountUnits: amount.amountUnits,
        asset,
        owner,
        publicClient,
        recipient,
        subaccountId,
        wallet,
      });
    } catch (error) {
      const message = describeWithdrawFailure(getErrorMessage(error), currency);
      posthog.capture("withdraw_failed", { error_message: message, withdraw_asset: asset.id });
      setFlowState({ error: message, status: "failed" });
    }
  }

  return { clearInputError, flowState, inputError, reset, startWithdraw };
}
