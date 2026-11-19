import { expect, test } from "bun:test";
import {
  custodyAmountError,
  custodyRouting,
  parseUsdcAmount,
  withdrawableUsdc,
} from "./custody-routing.ts";

const base = {
  custodyAccountId: null,
  custodyEnabled: true,
  matchingPositionUnits: null,
  matchingSubaccountId: null,
};

test("custody off: the Matching account, Matching transfers", () => {
  expect(
    custodyRouting({
      ...base,
      custodyAccountId: "9",
      custodyEnabled: false,
      matchingSubaccountId: "5",
    })
  ).toEqual({ subaccountId: "5", viaCustody: false });
});

test("custody on, no account anywhere: deposits go to custody, which opens the account", () => {
  expect(custodyRouting(base)).toEqual({ subaccountId: null, viaCustody: true });
});

test("custody on, flat Matching account and no custody account yet: Matching shown, deposits go to custody", () => {
  expect(custodyRouting({ ...base, matchingPositionUnits: 0n, matchingSubaccountId: "5" })).toEqual(
    {
      subaccountId: "5",
      viaCustody: true,
    }
  );
});

test("custody on with an account: the custody account is in front", () => {
  expect(
    custodyRouting({
      ...base,
      custodyAccountId: "9",
      matchingPositionUnits: 0n,
      matchingSubaccountId: "5",
    })
  ).toEqual({ subaccountId: "9", viaCustody: true });
});

test("a Matching position keeps the Matching account in front, either sign, until flat", () => {
  for (const units of [3n, -3n]) {
    expect(
      custodyRouting({
        ...base,
        custodyAccountId: "9",
        matchingPositionUnits: units,
        matchingSubaccountId: "5",
      })
    ).toEqual({ subaccountId: "5", viaCustody: false });
  }
});

test("amounts parse as 6-dp USDC; junk refuses, extra decimals round", () => {
  expect(parseUsdcAmount("")).toBe(0n);
  expect(parseUsdcAmount("20")).toBe(20_000_000n);
  expect(parseUsdcAmount("1,5")).toBe(1_500_000n);
  expect(parseUsdcAmount("abc")).toBeNull();
  expect(parseUsdcAmount("1.1234567")).toBe(1_123_457n);
});

test("withdrawable rounds 18-dp cash down to 6 dp, never negative", () => {
  expect(withdrawableUsdc(null)).toBe(0n);
  expect(withdrawableUsdc(-5n)).toBe(0n);
  expect(withdrawableUsdc(1_999_999_999_999_999_999n)).toBe(1_999_999n);
});

test("amount errors: unparsed, zero, over what is available", () => {
  expect(custodyAmountError("deposit", null, 10n)).toBe("Enter a number.");
  expect(custodyAmountError("deposit", 0n, 10n)).toBe("Enter an amount.");
  expect(custodyAmountError("deposit", 11n, 10n)).toBe("More than the wallet holds.");
  expect(custodyAmountError("withdraw", 11n, 10n)).toBe("More than the account can withdraw.");
  expect(custodyAmountError("withdraw", 10n, 10n)).toBeNull();
  expect(custodyAmountError("deposit", 10n, null)).toBeNull();
});
