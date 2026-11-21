import { expect, test } from "bun:test";
import { DUST_USDC, matchingMovableUsdc, olderBalancesTotal } from "./older-balances.ts";

const usdc18 = (usdc) => BigInt(Math.round(usdc * 1e6)) * 10n ** 12n;

test("with no position anywhere, all of the cash moves", () => {
  expect(matchingMovableUsdc({ cashUnits: usdc18(24.97), initialMarginSurplus: 24.97 })).toBe(
    24_970_000n
  );
  // a surplus above the cash (pending gains) still moves only the cash
  expect(matchingMovableUsdc({ cashUnits: usdc18(5), initialMarginSurplus: 6 })).toBe(5_000_000n);
});

test("a position elsewhere keeps 1.5x its initial margin, and a second move offers nothing", () => {
  // #62 before the move: 24.97 USDC cash, 21.79 over initial margin, so the EURC position needs 3.18
  const first = matchingMovableUsdc({ cashUnits: usdc18(24.97), initialMarginSurplus: 21.79 });
  expect(first).toBe(20_200_000n);
  // after it: 4.77 cash, 1.59 over initial margin (half the 3.18 requirement), nothing more to move
  const left = 24.97 - Number(first) / 1e6;
  expect(matchingMovableUsdc({ cashUnits: usdc18(left), initialMarginSurplus: left - 3.18 })).toBe(
    0n
  );
  // #62 as the 90% rule left it: 3.12 cash, 0.002 over initial margin
  expect(matchingMovableUsdc({ cashUnits: usdc18(3.123), initialMarginSurplus: 0.0022 })).toBe(0n);
});

test("nothing moves when the surplus is gone, unreadable, or under a cent", () => {
  expect(matchingMovableUsdc({ cashUnits: usdc18(10), initialMarginSurplus: 0 })).toBe(0n);
  expect(matchingMovableUsdc({ cashUnits: usdc18(10), initialMarginSurplus: -3 })).toBe(0n);
  expect(matchingMovableUsdc({ cashUnits: usdc18(10), initialMarginSurplus: Number.NaN })).toBe(0n);
  expect(matchingMovableUsdc({ cashUnits: usdc18(10), initialMarginSurplus: 0.005 })).toBe(0n);
  // #63's dust: 2.37e9 wei of cash
  expect(matchingMovableUsdc({ cashUnits: 2_370_000_000n, initialMarginSurplus: 1 })).toBe(0n);
});

test("the older-balances line counts only a cent or more", () => {
  expect(olderBalancesTotal([24_970_000n, DUST_USDC - 1n])).toBe(24_970_000n);
  expect(olderBalancesTotal([DUST_USDC, 0n])).toBe(DUST_USDC);
  expect(olderBalancesTotal([])).toBe(0n);
});
