import { expect, test } from "bun:test";
import { buildOptionPayoff, formatPayoffUsd, optionPnlAt } from "./option-payoff.ts";

const CALL = { optionType: "call", strike: 0.000_72 };
const PUT = { optionType: "put", strike: 0.000_72 };
// 100,000 cNGN at 0.00003 premium, 15 bps fee: 3 + 0.0045.
const COST = 3.0045;
const SIZE = 100_000;

test("a call loses its cost up to the strike, then gains without a ceiling", () => {
  const payoff = buildOptionPayoff({ cost: COST, forward: 0.0007, row: CALL, size: SIZE });
  expect(payoff.maxLoss).toBe(COST);
  expect(payoff.maxProfit).toBeNull();
  expect(payoff.breakeven).toBeCloseTo(0.000_750_045, 9);
  expect(optionPnlAt(CALL, 0.0006, SIZE, COST)).toBe(-COST);
  expect(optionPnlAt(CALL, payoff.breakeven, SIZE, COST)).toBeCloseTo(0, 9);
  expect(optionPnlAt(CALL, 0.0008, SIZE, COST)).toBeCloseTo(8 - COST, 9);
  const [low, kink, high] = payoff.points;
  expect(low.pnl).toBe(-COST);
  expect(kink).toEqual({ pnl: -COST, settlement: 0.000_72 });
  expect(high.pnl).toBeGreaterThan(0);
});

test("a put gains as the price falls, at most its strike less its cost", () => {
  const payoff = buildOptionPayoff({ cost: COST, forward: 0.0007, row: PUT, size: SIZE });
  expect(payoff.maxProfit).toBeCloseTo(72 - COST, 9);
  expect(payoff.breakeven).toBeCloseTo(0.000_689_955, 9);
  expect(optionPnlAt(PUT, 0, SIZE, COST)).toBeCloseTo(payoff.maxProfit, 9);
  expect(optionPnlAt(PUT, payoff.breakeven, SIZE, COST)).toBeCloseTo(0, 9);
  expect(optionPnlAt(PUT, 0.0008, SIZE, COST)).toBe(-COST);
  expect(payoff.points[0].pnl).toBeGreaterThan(0);
  expect(payoff.points[2].pnl).toBe(-COST);
});

test("the range holds the strike, the breakeven and the forward, ascending", () => {
  const payoff = buildOptionPayoff({ cost: COST, forward: 0.0009, row: CALL, size: SIZE });
  const [low, , high] = payoff.points;
  expect(low.settlement).toBeLessThan(0.000_72);
  expect(high.settlement).toBeGreaterThan(0.0009);
});

test("nothing is drawn without a size and a cost", () => {
  expect(buildOptionPayoff({ cost: null, forward: null, row: CALL, size: SIZE })).toBeNull();
  expect(buildOptionPayoff({ cost: COST, forward: null, row: CALL, size: null })).toBeNull();
  expect(buildOptionPayoff({ cost: 0, forward: null, row: CALL, size: SIZE })).toBeNull();
});

test("amounts keep a small option's precision", () => {
  expect(formatPayoffUsd(12.4)).toBe("$12.40");
  expect(formatPayoffUsd(-0.034_12)).toBe("-$0.034");
  expect(formatPayoffUsd(0)).toBe("$0");
});
