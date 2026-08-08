import { expect, test } from "bun:test";
import { formatSignedContracts } from "./market-formatting.ts";

// The bug: the order ticket reported "position after: short" for every sell, derived from the
// order's side alone. Closing a long of .001 by selling .001 leaves the account flat, but the
// message said short — which invites a trader to "correct" it and open a position they never
// wanted. Position now comes from the ledger, so the formatter must not blur flat with anything.
test("zero is flat, not a signed zero", () => {
  expect(formatSignedContracts(0)).toBe("Flat");
});

test("a long is signed positive", () => {
  expect(formatSignedContracts(0.001)).toBe("+0.001 contracts");
  expect(formatSignedContracts(2)).toBe("+2.000 contracts");
});

test("a short is signed negative", () => {
  expect(formatSignedContracts(-0.001)).toBe("-0.001 contracts");
  expect(formatSignedContracts(-2)).toBe("-2.000 contracts");
});

// A residual position must never round away to anything that reads as flat — neither the word
// "Flat" nor a "0.000" that looks like it.
test("a sub-step residual position stays visible", () => {
  const label = formatSignedContracts(0.0004);

  expect(label).toBe("+0.000400 contracts");
  expect(label).not.toBe("Flat");
  expect(label).not.toContain("+0.000 ");
});
