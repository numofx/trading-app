import { expect, test } from "bun:test";
import {
  describeWithdrawFailure,
  toTokenUnits,
  validateWithdrawAmount,
} from "./subaccount-withdraw.ts";

/** 1,300 cNGN as the ledger stores it: 18 decimals, whatever the token's own scale is. */
const LEDGER_1300 = 1_300n * 10n ** 18n;

test("accepts an amount the account covers, in token units", () => {
  const result = validateWithdrawAmount({
    amountInput: "1300",
    currency: "cNGN",
    balance: { decimals: 18, units: LEDGER_1300 },
    tokenDecimals: 6,
  });

  // 6-decimal token units, not the ledger's 18 — this is what the escrow call takes.
  expect(result).toEqual({ amountUnits: 1_300_000_000n, kind: "ok" });
});

/**
 * The scales differ by twelve orders of magnitude, so a naive comparison of the raw numbers would
 * pass anything under 1e12 token units. Withdrawing 2,000 against a 1,300 balance must fail.
 */
test("rejects more than the account holds, comparing across the decimal gap", () => {
  const result = validateWithdrawAmount({
    amountInput: "2000",
    currency: "cNGN",
    balance: { decimals: 18, units: LEDGER_1300 },
    tokenDecimals: 6,
  });

  expect(result.kind).toBe("invalid");
  expect(result.reason).toContain("more cNGN than the account holds");
});

test("the exact balance is withdrawable", () => {
  const result = validateWithdrawAmount({
    amountInput: "3.942881",
    currency: "USDC",
    balance: { decimals: 18, units: 3_942_881_792_831_387_705n },
    tokenDecimals: 6,
  });

  expect(result).toEqual({ amountUnits: 3_942_881n, kind: "ok" });
});

test("rejects zero, junk and an unreadable balance", () => {
  const zero = validateWithdrawAmount({
    amountInput: "0",
    currency: "USDC",
    balance: { decimals: 18, units: LEDGER_1300 },
    tokenDecimals: 6,
  });
  expect(zero.reason).toContain("greater than zero");

  const junk = validateWithdrawAmount({
    amountInput: "1.2.3",
    currency: "USDC",
    balance: { decimals: 18, units: LEDGER_1300 },
    tokenDecimals: 6,
  });
  expect(junk.reason).toContain("valid USDC amount");

  const unknown = validateWithdrawAmount({
    amountInput: "1",
    currency: "USDC",
    balance: null,
    tokenDecimals: 6,
  });
  expect(unknown.reason).toContain("could not be read");
});

test("commas and surrounding space are tolerated", () => {
  const result = validateWithdrawAmount({
    amountInput: " 1,300 ",
    currency: "cNGN",
    balance: { decimals: 18, units: LEDGER_1300 },
    tokenDecimals: 6,
  });

  expect(result).toEqual({ amountUnits: 1_300_000_000n, kind: "ok" });
});

/**
 * The failure both mainnet escrows produce today. It is not a user error, and no transaction was
 * broadcast — the simulation catches it before the wallet prompt — so the copy has to say so.
 */
test("an escrow that cannot pay out is explained, not echoed", () => {
  const copy = describeWithdrawFailure(
    'execution reverted: ERC20: transfer amount exceeds balance"',
    "cNGN"
  );

  expect(copy).toContain("cNGN escrow is short of tokens");
  expect(copy).toContain("Nothing was sent");
});

test("a wallet rejection reads as one, and anything else is passed through", () => {
  expect(describeWithdrawFailure("User rejected the request.", "USDC")).toContain("You rejected");
  expect(describeWithdrawFailure("nonce too low", "USDC")).toBe("nonce too low");
});

/**
 * The ledger keeps 18 decimals and the mainnet tokens keep 6, so the account's own balance is not
 * a legal withdrawal amount as written. Max fills in this number: rounding it up by one millionth
 * would ask the escrow for more than the account has and revert.
 */
test("a balance restated in token units rounds down", () => {
  const ledger = { decimals: 18, units: 3_942_881_792_831_387_705n };

  expect(toTokenUnits(ledger, 6)).toBe(3_942_881n);
  expect(toTokenUnits({ decimals: 6, units: 1_500_000n }, 6)).toBe(1_500_000n);
  expect(toTokenUnits({ decimals: 6, units: 2n }, 18)).toBe(2_000_000_000_000n);
});

test("the whole balance, as Max fills it, is accepted", () => {
  const result = validateWithdrawAmount({
    amountInput: "3.942881",
    balance: { decimals: 18, units: 3_942_881_792_831_387_705n },
    currency: "USDC",
    tokenDecimals: 6,
  });

  expect(result).toEqual({ amountUnits: 3_942_881n, kind: "ok" });
});

test("one unit above the truncated balance is rejected", () => {
  const result = validateWithdrawAmount({
    amountInput: "3.942882",
    balance: { decimals: 18, units: 3_942_881_792_831_387_705n },
    currency: "USDC",
    tokenDecimals: 6,
  });

  expect(result.kind).toBe("invalid");
});

/**
 * Max fills the account balance at whatever precision the caller holds it. If the field still
 * carries the ledger's eighteen digits, the extra ones are dropped — not rounded up into an amount
 * the escrow would reject.
 */
test("precision the token cannot represent is truncated, not rounded up", () => {
  const result = validateWithdrawAmount({
    amountInput: "3.942881792831387705",
    balance: { decimals: 18, units: 3_942_881_792_831_387_705n },
    currency: "USDC",
    tokenDecimals: 6,
  });

  expect(result).toEqual({ amountUnits: 3_942_881n, kind: "ok" });
});
