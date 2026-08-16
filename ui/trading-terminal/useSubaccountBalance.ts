"use client";

import { useEffect, useState } from "react";
import { formatUnits, isAddressEqual } from "viem";
import { createBasePublicClient } from "@/lib/base-public-client";
import {
  getCashAssetAddress,
  getCngnAssetAddress,
  getSubaccountsAddress,
} from "@/lib/subaccount-deposit-config";

/**
 * The SubAccounts ledger normalizes every asset's per-account balance to 18 decimals,
 * so both the USDC cash leg and the cNGN leg format against 1e18 (not the token's own
 * decimals). Verified on-chain: a 5 USDC deposit shows as 5e18 cash.
 */
const SUBACCOUNT_LEDGER_DECIMALS = 18;

const getAccountBalancesAbi = [
  {
    inputs: [{ name: "accountId", type: "uint256" }],
    name: "getAccountBalances",
    stateMutability: "view",
    type: "function",
    outputs: [
      {
        name: "",
        type: "tuple[]",
        components: [
          { name: "asset", type: "address" },
          { name: "subId", type: "uint256" },
          { name: "balance", type: "int256" },
        ],
      },
    ],
  },
] as const;

export type SubaccountAssetBalance = {
  asset: `0x${string}`;
  subId: bigint;
  balance: bigint;
};

export type SubaccountBalance = {
  /** Every asset the subaccount holds, as returned by the ledger. */
  rows: SubaccountAssetBalance[];
  /** Balance of the CashAsset (USDC cash) in 1e18 units, or null if the cash asset is unknown for this chain. */
  cashUnits: bigint | null;
  /** Balance of the cNGN-side asset in 1e18 units, or null if the cNGN asset is unknown for this chain. */
  cngnUnits: bigint | null;
};

/**
 * Reads a subaccount's on-ledger balances from the SubAccounts contract. Unlike the
 * wallet ERC-20 balance ({@link useUsdcBalance}), this reflects deposited and traded
 * funds — deposits leave the wallet and are credited here, so this is what the
 * "Balance summary" should show.
 */
export function useSubaccountBalance(subaccountId: string | null) {
  const [balance, setBalance] = useState<SubaccountBalance | null>(null);
  const [refreshCount, setRefreshCount] = useState(0);

  useEffect(() => {
    let cancelled = false;

    if (subaccountId === null) {
      setBalance(null);
      return () => {
        cancelled = true;
      };
    }

    async function readBalance(accountId: string) {
      const publicClient = createBasePublicClient();
      const rows = await publicClient.readContract({
        abi: getAccountBalancesAbi,
        address: getSubaccountsAddress(),
        args: [BigInt(accountId)],
        functionName: "getAccountBalances",
      });

      const cashAsset = getCashAssetAddress();
      const cngnAsset = getCngnAssetAddress();
      let cashUnits: bigint | null = null;
      let cngnUnits: bigint | null = null;

      const mapped = rows.map((row) => {
        if (cashAsset !== null && isAddressEqual(row.asset, cashAsset)) {
          cashUnits = row.balance;
        }
        if (isAddressEqual(row.asset, cngnAsset)) {
          cngnUnits = row.balance;
        }
        return { asset: row.asset, balance: row.balance, subId: row.subId };
      });

      if (!cancelled) {
        setBalance({ cashUnits, cngnUnits, rows: mapped });
      }
    }

    readBalance(subaccountId).catch(() => {
      if (!cancelled) {
        setBalance(null);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [subaccountId, refreshCount]);

  function refresh() {
    setRefreshCount((current) => current + 1);
  }

  return { balance, refresh };
}

function formatLedgerUnits(units: bigint | null, symbol: string) {
  if (units === null) {
    return null;
  }

  const value = Number(formatUnits(units, SUBACCOUNT_LEDGER_DECIMALS));
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${symbol}`;
}

/**
 * The subaccount balance as a plain token amount, or null when unknown.
 *
 * The order ticket sizes a percentage of what the account can actually spend, so it needs the
 * number rather than the display label.
 */
export function toLedgerAmount(units: bigint | null) {
  return units === null ? null : Number(formatUnits(units, SUBACCOUNT_LEDGER_DECIMALS));
}

/** Format the subaccount's USDC cash balance, e.g. "1.03 USDC", or null when unknown. */
export function formatSubaccountUsdcLabel(units: bigint | null) {
  return formatLedgerUnits(units, "USDC");
}

/** Format the subaccount's cNGN balance, e.g. "5,440 cNGN", or null when unknown. */
export function formatSubaccountCngnLabel(units: bigint | null) {
  return formatLedgerUnits(units, "cNGN");
}
