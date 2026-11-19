"use client";

import type { ConnectedWallet } from "@privy-io/react-auth";
import { useCallback, useEffect, useState } from "react";
import { createWalletClient, custom, parseAbi, parseAbiItem } from "viem";
import { createBasePublicClient, getAppChain } from "@/lib/base-public-client";
import { getCustodianAddress, isCustodianEnabled } from "@/lib/custodian";
import {
  blockWindows,
  custodianDeployBlock,
  EXIT_LOG_CHUNK_BLOCKS,
  walletHeldAccounts,
} from "@/lib/custodian-held";
import { withdrawableUsdc } from "@/lib/custody-routing";
import { getSubaccountsAddress } from "@/lib/subaccount-deposit-config";

const exitedEvent = parseAbiItem("event Exited(uint256 indexed accountId, address indexed wallet)");

const subAccountsAbi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function manager(uint256 accountId) view returns (address)",
  "function getBalance(uint256 accountId, address asset, uint256 subId) view returns (int256)",
]);

const cashAssetAbi = parseAbi([
  "function withdraw(uint256 accountId, uint256 stableAmount, address recipient)",
]);

export type WalletHeldAccount = { accountId: string; cashUnits: bigint };

export async function readWalletHeldAccounts(
  wallet: `0x${string}`,
  manager: `0x${string}`,
  cash: `0x${string}`
): Promise<WalletHeldAccount[]> {
  const custodian = getCustodianAddress();
  const from = custodianDeployBlock(getAppChain().id);
  if (custodian === null || from === null) {
    return [];
  }
  const client = createBasePublicClient();
  const head = await client.getBlockNumber({ cacheTime: 0 });
  const ids: bigint[] = [];
  for (const [fromBlock, toBlock] of blockWindows(from, head, EXIT_LOG_CHUNK_BLOCKS)) {
    const logs = await client.getLogs({
      address: custodian,
      args: { wallet },
      event: exitedEvent,
      fromBlock,
      toBlock,
    });
    for (const log of logs) {
      if (log.args.accountId !== undefined) {
        ids.push(log.args.accountId);
      }
    }
  }
  const subAccounts = getSubaccountsAddress();
  const candidates = await Promise.all(
    [...new Set(ids)].map(async (accountId) => {
      const [owner, accountManager, balance] = await Promise.all([
        client.readContract({
          abi: subAccountsAbi,
          address: subAccounts,
          args: [accountId],
          functionName: "ownerOf",
        }),
        client.readContract({
          abi: subAccountsAbi,
          address: subAccounts,
          args: [accountId],
          functionName: "manager",
        }),
        client.readContract({
          abi: subAccountsAbi,
          address: subAccounts,
          args: [accountId, cash, 0n],
          functionName: "getBalance",
        }),
      ]);
      return { accountId, cashUnits: balance, manager: accountManager, owner };
    })
  );
  return walletHeldAccounts(candidates, wallet, manager);
}

/**
 * Accounts that left custody to this wallet ("Move the account to my wallet") and still hold USDC under the
 * series' engine. The terminal reads only Matching and custody accounts, so without this an exited balance is
 * invisible. Withdrawing is the wallet's own transaction (it pays the gas): the account is no longer custodied.
 */
export function useWalletHeldAccounts(
  wallet: ConnectedWallet | null,
  stack: { cashAddress: `0x${string}`; managerAddress: `0x${string}` } | null
) {
  const enabled = isCustodianEnabled();
  const address = (wallet?.address ?? null) as `0x${string}` | null;
  const manager = stack?.managerAddress ?? null;
  const cash = stack?.cashAddress ?? null;
  const [accounts, setAccounts] = useState<WalletHeldAccount[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!enabled || address === null || manager === null || cash === null) {
      setAccounts([]);
      return;
    }
    try {
      setAccounts(await readWalletHeldAccounts(address, manager, cash));
    } catch {
      // Keep what is on screen; the next load (on a wallet change or after a withdrawal) tries again.
    }
  }, [address, cash, enabled, manager]);

  useEffect(() => {
    void load();
  }, [load]);

  async function withdrawAll(account: WalletHeldAccount) {
    if (wallet === null || cash === null) {
      return;
    }
    const amount = withdrawableUsdc(account.cashUnits);
    if (amount === 0n) {
      return;
    }
    setBusy(account.accountId);
    setLastError(null);
    try {
      const chain = getAppChain();
      await wallet.switchChain(chain.id);
      const walletClient = createWalletClient({
        chain,
        transport: custom(await wallet.getEthereumProvider()),
      });
      const publicClient = createBasePublicClient();
      const recipient = wallet.address as `0x${string}`;
      const { request } = await publicClient.simulateContract({
        abi: cashAssetAbi,
        account: recipient,
        address: cash,
        args: [BigInt(account.accountId), amount, recipient],
        functionName: "withdraw",
      });
      const hash = await walletClient.writeContract(request);
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") {
        throw new Error("The withdrawal transaction reverted.");
      }
      await load();
    } catch (error) {
      setLastError(
        error instanceof Error ? error.message.split("\n")[0] : "The withdrawal failed."
      );
    } finally {
      setBusy(null);
    }
  }

  return { accounts, busy, lastError, withdrawAll };
}
