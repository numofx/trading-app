import { expect, test } from "bun:test";
import { black76Price, impliedVol } from "./black76.ts";

const SECONDS_28D = 28 * 86_400;
const put = { forward: 0.000_72, isCall: false, seconds: SECONDS_28D, strike: 0.000_72 };

test("an at-the-money option is worth about 0.4 x forward x vol x sqrt(t)", () => {
  const approximate = 0.4 * 0.000_72 * 0.4 * Math.sqrt(28 / 365);
  expect(black76Price(put, 0.4) / approximate).toBeCloseTo(1, 2);
});

test("call minus put is forward minus strike: no discounting", () => {
  const strike = 0.000_67;
  const call = black76Price({ ...put, isCall: true, strike }, 0.45);
  const otm = black76Price({ ...put, strike }, 0.45);
  expect(call - otm).toBeCloseTo(0.000_72 - strike, 7);
});

test("implied vol inverts the price, across strikes and sides", () => {
  for (const strike of [0.000_62, 0.000_72, 0.000_82]) {
    for (const isCall of [true, false]) {
      const option = { ...put, isCall, strike };
      expect(impliedVol(option, black76Price(option, 0.37))).toBeCloseTo(0.37, 3);
    }
  }
});

test("a premium no vol can produce has no implied vol", () => {
  const deepCall = { ...put, isCall: true, strike: 0.000_62 };
  expect(impliedVol(deepCall, 0.000_05)).toBeNull(); // under its 0.0001 intrinsic value
  expect(impliedVol(put, 0.01)).toBeNull(); // far above what the put can pay
  expect(impliedVol(put, null)).toBeNull();
  expect(impliedVol(put, 0)).toBeNull();
  expect(impliedVol({ ...put, seconds: 0 }, 0.000_03)).toBeNull();
});
