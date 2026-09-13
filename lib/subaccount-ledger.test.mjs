import { expect, test } from "bun:test";
import { getAccountLegs, getLedgerLegs } from "./subaccount-ledger.ts";

const WRAPPED_USDC = "0x364058aFF6f36E01505fB2Cc870f8B6BD4835e84";
const WRAPPED_CNGN = "0x9D806fD040a719D27a8E5E77dc5aE0ED1e089493";

/**
 * Account #19's real ledger on 2026-09-13: `getAccountBalances(19)` returned `[]`, and an order
 * spending 1,336 cNGN was signed from it because the ticket read that as "unknown".
 */
test("an account with no ledger rows holds zero of both legs, not an unknown amount", () => {
  expect(getLedgerLegs({ cngnAsset: WRAPPED_CNGN, quoteAsset: WRAPPED_USDC, rows: [] })).toEqual({
    cashUnits: 0n,
    cngnUnits: 0n,
  });
});

test("each leg is read from its own asset's row, regardless of address casing", () => {
  const rows = [
    { asset: WRAPPED_USDC.toLowerCase(), balance: 3_000_000_000_000_000_000n },
    { asset: WRAPPED_CNGN, balance: 5_000_000_000_000_000_000_000n },
  ];

  expect(getLedgerLegs({ cngnAsset: WRAPPED_CNGN, quoteAsset: WRAPPED_USDC, rows })).toEqual({
    cashUnits: 3_000_000_000_000_000_000n,
    cngnUnits: 5_000_000_000_000_000_000_000n,
  });
});

/** A row for some other asset says nothing about the legs an order spends. */
test("a leg with no row is zero even when the account holds something else", () => {
  const rows = [{ asset: WRAPPED_CNGN, balance: 1n }];

  expect(getLedgerLegs({ cngnAsset: WRAPPED_CNGN, quoteAsset: WRAPPED_USDC, rows }).cashUnits).toBe(
    0n
  );
});

/** Sepolia pins no quote asset, so its USDC leg genuinely cannot be read. */
test("an unpinned quote asset stays unknown", () => {
  const rows = [{ asset: WRAPPED_CNGN, balance: 1n }];

  expect(getLedgerLegs({ cngnAsset: WRAPPED_CNGN, quoteAsset: null, rows })).toEqual({
    cashUnits: null,
    cngnUnits: 1n,
  });
});

/**
 * The other way #19's order got through: at submit the wallet had no account yet, so there was no
 * ledger to read at all. A finished lookup that found nothing is a known empty account.
 */
test("a wallet whose lookup found no account holds zero", () => {
  expect(
    getAccountLegs({ balance: null, isAccountResolved: true, subaccountId: null })
  ).toEqual({ cashUnits: 0n, cngnUnits: 0n });
});

/** Guessing zero here would send a funded trader to the deposit dialog on every page load. */
test("an unfinished or failed lookup stays unknown", () => {
  expect(
    getAccountLegs({ balance: null, isAccountResolved: false, subaccountId: null })
  ).toEqual({ cashUnits: null, cngnUnits: null });
});

test("an account whose ledger has not been read yet stays unknown", () => {
  expect(getAccountLegs({ balance: null, isAccountResolved: true, subaccountId: "19" })).toEqual({
    cashUnits: null,
    cngnUnits: null,
  });
});

test("an account's ledger read passes through", () => {
  const balance = { cashUnits: 2n, cngnUnits: 7n };

  expect(getAccountLegs({ balance, isAccountResolved: true, subaccountId: "19" })).toEqual(balance);
});
