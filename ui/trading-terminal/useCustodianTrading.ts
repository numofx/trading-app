"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, parseAbi } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import type { BookTakeOutcome } from "@/lib/book-take-submission";
import type { CustodianOutcome, StoredTradingKey } from "@/lib/custodian";
import {
  buildCustodianExit,
  buildCustodianTake,
  buildCustodianWithdraw,
  buildSetTradingKey,
  buildUsdcPermitDeposit,
  fetchCustodianAccounts,
  isCustodianEnabled,
  loadTradingKey,
  newTradingKey,
  postCustodian,
  saveTradingKey,
} from "@/lib/custodian";
import type { FutureMarket } from "@/lib/future-market.types";
import { getUsdcTokenAddress, getWrappedUsdcAssetAddress } from "@/lib/subaccount-deposit-config";

const PERMIT_NONCES_ABI = parseAbi(["function nonces(address owner) view returns (uint256)"]);

/**
 * Trading from onchain custody (BookCustodian), behind NEXT_PUBLIC_CUSTODIAN_ENABLED. The wallet's newest custodian
 * account, and this browser's trading key for it. `ready` means a take can be signed by the key with no wallet
 * prompt; otherwise the terminal keeps trading through Matching as before.
 */
export function useCustodianTrading(wallet: ConnectedWallet | null) {
  const enabled = isCustodianEnabled();
  const address = wallet?.address ?? null;
  const [accountId, setAccountId] = useState<string | null>(null);
  const [key, setKey] = useState<StoredTradingKey | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || address === null) {
      setAccountId(null);
      setKey(null);
      return;
    }
    const accounts = await fetchCustodianAccounts(address).catch(() => []);
    setAccountId(accounts[0] ?? null);
    setKey(loadTradingKey(address));
  }, [address, enabled]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function walletClientFor(w: ConnectedWallet) {
    const chain = getAppChain();
    await w.switchChain(chain.id);
    return createWalletClient({ chain, transport: custom(await w.getEthereumProvider()) });
  }

  async function step<T>(label: string, run: () => Promise<T>): Promise<T | null> {
    setBusy(label);
    setLastError(null);
    try {
      return await run();
    } catch (error) {
      setLastError(error instanceof Error ? error.message : `${label} failed`);
      return null;
    } finally {
      setBusy(null);
    }
  }

  function settled(outcome: CustodianOutcome, what: string): CustodianOutcome & { kind: "done" } {
    if (outcome.kind === "done") {
      return outcome;
    }
    throw new Error(
      outcome.kind === "rejected" || outcome.kind === "unknown"
        ? outcome.reason
        : `${what} was submitted but not confirmed (${outcome.txHash}); check the account before trying again`
    );
  }

  /**
   * Opens a custodian account if the wallet has none, deposits `usdc` (6 dp) with a USDC permit, and sets a fresh
   * trading key: three wallet signatures at most, no gas. Safe to run again: each step is skipped when done.
   */
  async function setUp(usdc: bigint) {
    if (wallet === null) {
      return;
    }
    await step("Setting up onchain custody", async () => {
      let id = accountId;
      if (id === null) {
        const opened = settled(
          await postCustodian({ call: "open_account", wallet: wallet.address }),
          "Opening the account"
        );
        id = opened.accountId ?? null;
        if (id === null) {
          throw new Error("The account was opened but its id was not returned; reload to find it");
        }
        setAccountId(id);
      }
      const client = await walletClientFor(wallet);
      if (usdc > 0n) {
        const usdcToken = getUsdcTokenAddress();
        const permitNonce = await createBasePublicClient().readContract({
          abi: PERMIT_NONCES_ABI,
          address: usdcToken,
          args: [wallet.address as `0x${string}`],
          functionName: "nonces",
        });
        const deposit = buildUsdcPermitDeposit({
          accountId: id,
          amount: usdc,
          cashAsset: getWrappedUsdcAssetAddress(),
          permitNonce,
          usdc: usdcToken,
          wallet: wallet.address,
        });
        const signature = await client.signTypedData({
          account: wallet.address as `0x${string}`,
          ...deposit.typedData,
        });
        settled(await postCustodian(deposit.body(signature)), "The deposit");
      }
      if (loadTradingKey(wallet.address) === null) {
        const fresh = newTradingKey();
        const set = buildSetTradingKey({ key: fresh.address, wallet: wallet.address });
        const signature = await client.signTypedData({
          account: wallet.address as `0x${string}`,
          ...set.typedData,
        });
        settled(await postCustodian(set.body(signature)), "Setting the trading key");
        const stored = { ...fresh, validUntil: Number(set.message.validUntil) };
        saveTradingKey(wallet.address, stored);
        setKey(stored);
      }
    });
  }

  /** A take signed by the trading key: no wallet prompt. Answers in the book-take shape the terminal reports. */
  async function take(args: {
    book: string;
    market: FutureMarket;
    marketId: number;
    price: string;
    reduceOnly: boolean;
    side: "buy" | "sell";
    units: number;
  }): Promise<BookTakeOutcome> {
    if (accountId === null || key === null) {
      return { kind: "rejected", reason: "Set up onchain custody first" };
    }
    const order = buildCustodianTake({
      accountId,
      amountScale: args.market.state.amountScale,
      book: args.book,
      contractSize: BigInt(Math.round(args.market.state.contractSize)),
      isBuy: args.side === "buy",
      limitPrice: args.price,
      marketId: args.marketId,
      reduceOnly: args.reduceOnly,
      takerFeeBps: args.market.takerFeeBps ?? 0,
      units: args.units,
    });
    const signature = await privateKeyToAccount(key.privateKey).signTypedData(order.typedData);
    const outcome = await postCustodian(order.body(signature));
    switch (outcome.kind) {
      case "done":
        return { blockNumber: outcome.blockNumber, kind: "filled", txHash: outcome.txHash };
      case "pending":
        return { kind: "pending", txHash: outcome.txHash };
      case "reverted":
        return {
          kind: "reverted",
          reason: "The take reverted on chain. Nothing was traded.",
          txHash: outcome.txHash,
        };
      default:
        return outcome;
    }
  }

  /** USDC (6 dp) back to the wallet, signed by the wallet. */
  function withdraw(usdc: bigint) {
    if (wallet === null || accountId === null) {
      return Promise.resolve(null);
    }
    return step("Withdrawing", async () => {
      const w = buildCustodianWithdraw({
        accountId,
        amount: usdc,
        asset: getWrappedUsdcAssetAddress(),
      });
      const client = await walletClientFor(wallet);
      const signature = await client.signTypedData({
        account: wallet.address as `0x${string}`,
        ...w.typedData,
      });
      return settled(await postCustodian(w.body(signature)), "The withdrawal");
    });
  }

  /** The account, with everything in it, to the wallet. Signed by the wallet; also callable from the wallet itself. */
  function exit() {
    if (wallet === null || accountId === null) {
      return Promise.resolve(null);
    }
    return step("Moving the account to your wallet", async () => {
      const e = buildCustodianExit({ accountId });
      const client = await walletClientFor(wallet);
      const signature = await client.signTypedData({
        account: wallet.address as `0x${string}`,
        ...e.typedData,
      });
      const done = settled(await postCustodian(e.body(signature)), "The exit");
      setAccountId(null);
      return done;
    });
  }

  return {
    accountId,
    busy,
    enabled,
    exit,
    lastError,
    ready: enabled && accountId !== null && key !== null,
    refresh,
    setUp,
    take,
    withdraw,
  };
}
