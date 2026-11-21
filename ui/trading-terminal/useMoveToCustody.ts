"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { useState } from "react";
import { formatUnits } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import { USDC_DECIMALS, withdrawableUsdc } from "@/lib/custody-routing";
import { matchingMovableUsdc, olderBalancesTotal } from "@/lib/older-balances";
import { getUsdcTokenAddress } from "@/lib/subaccount-deposit-config";
import type { useCustodianTrading } from "@/ui/trading-terminal/useCustodianTrading";
import { signAndSubmitWithdrawal } from "@/ui/trading-terminal/useSubaccountWithdraw";
import type { useWalletHeldAccounts } from "@/ui/trading-terminal/useWalletHeldAccounts";

type Custody = ReturnType<typeof useCustodianTrading>;
type Held = ReturnType<typeof useWalletHeldAccounts>;

/** A Matching account left behind custody: its id, cash and margin surplus, as the futures read has them. */
export type MatchingLeftover = {
  cashUnits: bigint;
  initialMarginSurplus: number;
  subaccountId: string;
};

/** Withdraws a Matching account's movable USDC to the wallet, signed and gasless; resolves once it has landed. */
async function withdrawFromMatching(
  wallet: ConnectedWallet,
  leftover: MatchingLeftover,
  usdc: bigint,
  cashAsset: `0x${string}`
) {
  const outcome = await signAndSubmitWithdrawal({
    amountUnits: usdc,
    subaccountId: leftover.subaccountId,
    asset: {
      escrow: cashAsset,
      id: "usdc",
      label: "USDC",
      symbol: "USDC",
      token: getUsdcTokenAddress(),
    },
    onSigned: () => undefined,
    wallet,
  });
  if (outcome.kind === "rejected" || outcome.kind === "unknown" || outcome.kind === "reverted") {
    throw new Error(`Matching #${leftover.subaccountId}: ${outcome.reason}`);
  }
  if (outcome.kind === "pending") {
    const receipt = await createBasePublicClient().waitForTransactionReceipt({
      hash: outcome.txHash,
    });
    if (receipt.status !== "success") {
      throw new Error(`Matching #${leftover.subaccountId}: the withdrawal reverted, nothing moved`);
    }
  }
}

/** Takes every older balance out to the wallet, in turn; reports each as it lands, resolves to the total. */
async function withdrawOlder({
  cashAsset,
  fromMatching,
  held,
  matching,
  onMoved,
  setStep,
  wallet,
}: {
  cashAsset: `0x${string}`;
  fromMatching: bigint;
  held: Held;
  matching: MatchingLeftover | null;
  /** Called as each withdrawal lands, so a later failure still knows what reached the wallet. */
  onMoved: (usdc: bigint) => void;
  setStep: (step: string) => void;
  wallet: ConnectedWallet;
}): Promise<bigint> {
  let total = 0n;
  if (matching !== null && fromMatching > 0n) {
    setStep(`Withdrawing from Matching #${matching.subaccountId}: sign in your wallet`);
    await withdrawFromMatching(wallet, matching, fromMatching, cashAsset);
    onMoved(fromMatching);
    total += fromMatching;
  }
  for (const account of held.accounts) {
    const usdc = withdrawableUsdc(account.cashUnits);
    if (usdc === 0n) {
      continue;
    }
    setStep(`Withdrawing from #${account.accountId}: confirm in your wallet (gas)`);
    if ((await held.withdrawAll(account)) === null) {
      throw new Error(`#${account.accountId}: the withdrawal did not go through`);
    }
    onMoved(usdc);
    total += usdc;
  }
  return total;
}

/**
 * The one line under the ticket for USDC outside the custody account: a Matching account left behind and accounts
 * moved to the wallet. "Move it here" takes each out to the wallet (a gasless signature for Matching, the wallet's
 * own transaction for an account it holds) and deposits the sum into custody with a permit, so the terminal keeps
 * one USDC balance. A Matching account still holding a position elsewhere moves only what that position spares.
 */
export function useMoveToCustody({
  cashAsset,
  custody,
  held,
  matching,
  onMoved,
  wallet,
}: {
  cashAsset: `0x${string}` | null;
  custody: Custody;
  held: Held;
  /** Null when there is no Matching balance behind custody. */
  matching: MatchingLeftover | null;
  onMoved: (blockNumber: bigint | null) => void;
  wallet: ConnectedWallet | null;
}) {
  const [step, setStep] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const fromMatching = matching === null ? 0n : matchingMovableUsdc(matching);
  const heldMovable = held.accounts.map((account) => withdrawableUsdc(account.cashUnits));
  const movable = olderBalancesTotal([fromMatching, ...heldMovable]);
  // Shown as held, not as movable: a position elsewhere may keep some of it back.
  const shown = olderBalancesTotal([
    matching === null ? 0n : withdrawableUsdc(matching.cashUnits),
    ...heldMovable,
  ]);
  const keptBack = shown > movable;

  async function move() {
    if (wallet === null || cashAsset === null || movable === 0n || step !== null) {
      return;
    }
    setError(null);
    setDone(null);
    let moved = 0n;
    try {
      await withdrawOlder({
        cashAsset,
        fromMatching,
        held,
        matching,
        onMoved: (usdc) => {
          moved += usdc;
        },
        setStep,
        wallet,
      });
      setStep("Depositing into your onchain account: sign in your wallet");
      const sent = await custody.setUp(moved);
      if (sent === null) {
        // Out of the older accounts but not yet in custody: it is in the wallet, and Deposit finishes it.
        throw new Error(
          `${formatUnits(moved, USDC_DECIMALS)} USDC is in your wallet; the deposit did not go through, use Deposit to finish`
        );
      }
      setDone(`Moved ${formatUnits(moved, USDC_DECIMALS)} USDC into your onchain account.`);
      onMoved(sent.blockNumber);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message.split("\n")[0] : "The move failed.");
      if (moved > 0n) {
        onMoved(null);
      }
    } finally {
      setStep(null);
      void held.reload();
    }
  }

  return { done, error, keptBack, move, movable, shown, step };
}
