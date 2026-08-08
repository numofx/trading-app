import { expect, test } from "bun:test";
import { TAKER_FEE_RATE } from "./future-order-submission.ts";
import { getOrderMetrics } from "./order-metrics.ts";

const MARGIN_RATE = 0.2;

// The bug: clearing the Amount field left "Margin Required 0.00 USDC" and "Fees 0.00 USDC" next to
// an enabled submit button, which reads as "this trade is free" rather than "no size entered".
test("an empty size quotes nothing rather than zero", () => {
  expect(getOrderMetrics("", MARGIN_RATE)).toEqual({ fees: null, initialMargin: null });
  expect(getOrderMetrics("0", MARGIN_RATE)).toEqual({ fees: null, initialMargin: null });
});

test("a non-numeric size quotes nothing", () => {
  expect(getOrderMetrics("abc", MARGIN_RATE)).toEqual({ fees: null, initialMargin: null });
});

test("a negative size quotes nothing", () => {
  expect(getOrderMetrics("-100", MARGIN_RATE)).toEqual({ fees: null, initialMargin: null });
});

// 1 contract at the 10,000 USDC contract size: the figures from the live ticket.
test("quotes the venue's margin rate and taker tier on a real size", () => {
  const { fees, initialMargin } = getOrderMetrics("10000", MARGIN_RATE);

  expect(initialMargin).toBe(2000);
  expect(fees).toBe(15);
});

test("the fee quote derives from the signed taker tier", () => {
  const { fees } = getOrderMetrics("10000", MARGIN_RATE);

  expect(fees).toBe(10_000 * Number(TAKER_FEE_RATE));
});

// An unknown margin rate must not suppress the fee, which is known independently of the venue read.
test("an unreadable margin rate still quotes fees", () => {
  const { fees, initialMargin } = getOrderMetrics("10000", null);

  expect(initialMargin).toBeNull();
  expect(fees).toBe(15);
});
