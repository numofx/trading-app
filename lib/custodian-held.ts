import { base } from "viem/chains";
import { withdrawableUsdc } from "@/lib/custody-routing";
import { DUST_USDC } from "@/lib/older-balances";

/** The block BookCustodian was deployed at on Base; nothing exits before it. Null elsewhere: no scan. */
const CUSTODIAN_DEPLOY_BLOCK: Record<number, bigint> = { [base.id]: 59_581_388n };

/** What every RPC the app reads through accepts for one eth_getLogs (publicnode's cap); Alchemy takes more. */
export const EXIT_LOG_CHUNK_BLOCKS = 50_000n;

export function custodianDeployBlock(chainId: number): bigint | null {
  return CUSTODIAN_DEPLOY_BLOCK[chainId] ?? null;
}

/** Inclusive [from, to] windows of at most `size` blocks covering from..to, oldest first. */
export function blockWindows(from: bigint, to: bigint, size: bigint): [bigint, bigint][] {
  const windows: [bigint, bigint][] = [];
  for (let start = from; start <= to; start += size) {
    const end = start + size - 1n;
    windows.push([start, end < to ? end : to]);
  }
  return windows;
}

export type HeldAccountCandidate = {
  accountId: bigint;
  /** The account's cash (18 dp). */
  cashUnits: bigint;
  manager: string;
  owner: string;
};

/**
 * The accounts that left custody to this wallet and are still its own, under the series' manager, with a cent or more of cash:
 * once exited, an account is the wallet's like any other, and the terminal (which reads only Matching and custody
 * accounts) would otherwise not show it. Withdrawals from it are the wallet's own transactions.
 */
export function walletHeldAccounts(
  candidates: HeldAccountCandidate[],
  wallet: string,
  manager: string
): { accountId: string; cashUnits: bigint }[] {
  const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
  const seen = new Set<bigint>();
  return candidates
    .filter((c) => {
      if (seen.has(c.accountId)) {
        return false;
      }
      seen.add(c.accountId);
      return (
        same(c.owner, wallet) &&
        same(c.manager, manager) &&
        withdrawableUsdc(c.cashUnits) >= DUST_USDC
      );
    })
    .map((c) => ({ accountId: c.accountId.toString(), cashUnits: c.cashUnits }));
}
