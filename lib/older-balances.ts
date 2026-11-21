import { withdrawableUsdc } from "@/lib/custody-routing";

/** Below a cent (6 dp USDC) a balance is dust: not shown, not moved. */
export const DUST_USDC = 10_000n;

/** What of the surplus above initial margin a move takes when a position elsewhere still needs some: 90%. */
const SURPLUS_SHARE = 0.9;

/**
 * How much USDC (6 dp) can leave a Matching account for custody. All of its cash when its margin surplus covers
 * the cash (no position anywhere in the engine needs it); otherwise 90% of the surplus, so the positions it still
 * holds (another series' contracts) stay above initial margin as the price moves. Zero below a cent.
 */
export function matchingMovableUsdc(account: {
  cashUnits: bigint;
  /** Above initial margin, USDC, across every position the account holds. */
  initialMarginSurplus: number;
}): bigint {
  const cash = withdrawableUsdc(account.cashUnits);
  const surplus = account.initialMarginSurplus;
  const cashUsdc = Number(cash) / 1e6;
  let movable = cash;
  if (!(Number.isFinite(surplus) && surplus >= cashUsdc)) {
    const share = Number.isFinite(surplus) && surplus > 0 ? surplus * SURPLUS_SHARE : 0;
    const capped = BigInt(Math.floor(share * 1e6));
    movable = capped < cash ? capped : cash;
  }
  return movable < DUST_USDC ? 0n : movable;
}

/** The older balances worth a line under the ticket: anything a cent or more. */
export function olderBalancesTotal(parts: bigint[]): bigint {
  return parts.filter((usdc) => usdc >= DUST_USDC).reduce((sum, usdc) => sum + usdc, 0n);
}
