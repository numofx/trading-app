import { withdrawableUsdc } from "@/lib/custody-routing";

/** Below a cent (6 dp USDC) a balance is dust: not shown, not moved. */
export const DUST_USDC = 10_000n;

/**
 * What a position elsewhere keeps above its initial margin once a move is done: half the requirement again, so it
 * rides out a price move and the account is not left at the edge of initial margin.
 */
const KEEP_OVER_REQUIREMENT = 0.5;

/**
 * How much USDC (6 dp) can leave a Matching account for custody. All of its cash when its margin surplus covers
 * the cash (no position anywhere in the engine needs it). Otherwise what leaves the positions it still holds
 * (another series' contracts) 1.5x their initial margin: the requirement is the cash the surplus does not cover.
 * Once moved, the same account offers nothing more, rather than a shrinking share of what is left each time.
 * Zero below a cent.
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
    const requirement = Number.isFinite(surplus) ? cashUsdc - surplus : cashUsdc;
    const spare = Number.isFinite(surplus) ? surplus - requirement * KEEP_OVER_REQUIREMENT : 0;
    const capped = spare > 0 ? BigInt(Math.floor(spare * 1e6)) : 0n;
    movable = capped < cash ? capped : cash;
  }
  return movable < DUST_USDC ? 0n : movable;
}

/** The older balances worth a line under the ticket: anything a cent or more. */
export function olderBalancesTotal(parts: bigint[]): bigint {
  return parts.filter((usdc) => usdc >= DUST_USDC).reduce((sum, usdc) => sum + usdc, 0n);
}
