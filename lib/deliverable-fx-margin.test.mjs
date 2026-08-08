import { expect, test } from "bun:test";
import { resolveInitialMarginRate } from "./deliverable-fx-margin.ts";

const DAY = 86_400;

/**
 * The live USDCcNGN-SEP16-2026 schedule, read from the Base mainnet DeliverableFXManager
 * (0xcE01f3D74400caE39bd7608cd2d286C2e3874d49) and the future asset's `getSeries`:
 * normalIM 20%, rampIM 100%, rampDuration 3 days, lastTradeTime 2026-09-16T14:00:00Z.
 */
const SCHEDULE = {
  lastTradeTimeSeconds: 1_789_567_200,
  normalIM: 0.2,
  rampDurationSeconds: 3 * DAY,
  rampIM: 1,
};

const RAMP_START = SCHEDULE.lastTradeTimeSeconds - SCHEDULE.rampDurationSeconds;

// The bug this replaces: the ticket hardcoded 5%, understating the venue's real requirement by 4x.
// A trader sizing off "Margin Required" was told a 100 USDC position needed 5 USDC of collateral
// when the manager actually demands 20.
test("sits at the normal requirement well before expiry", () => {
  expect(resolveInitialMarginRate(SCHEDULE, RAMP_START - 30 * DAY)).toBe(0.2);
});

test("has not started ramping at the ramp boundary", () => {
  expect(resolveInitialMarginRate(SCHEDULE, RAMP_START)).toBe(0.2);
});

test("ramps linearly toward the delivery requirement", () => {
  // A quarter and a half of the way through the 3-day window.
  expect(resolveInitialMarginRate(SCHEDULE, RAMP_START + 18 * 3600)).toBeCloseTo(0.4, 10);
  expect(resolveInitialMarginRate(SCHEDULE, RAMP_START + 36 * 3600)).toBeCloseTo(0.6, 10);
});

test("reaches full collateralisation at the last trade time and stays there", () => {
  expect(resolveInitialMarginRate(SCHEDULE, SCHEDULE.lastTradeTimeSeconds)).toBe(1);
  expect(resolveInitialMarginRate(SCHEDULE, SCHEDULE.lastTradeTimeSeconds + DAY)).toBe(1);
});

test("a zero ramp duration pins the requirement at normal until expiry", () => {
  const schedule = { ...SCHEDULE, rampDurationSeconds: 0 };

  expect(resolveInitialMarginRate(schedule, RAMP_START + 36 * 3600)).toBe(0.2);
  // The contract still jumps to the ramp ratio once the series stops trading.
  expect(resolveInitialMarginRate(schedule, SCHEDULE.lastTradeTimeSeconds)).toBe(1);
});

test("a ramp ratio at or below normal never lowers the requirement", () => {
  const schedule = { ...SCHEDULE, rampIM: 0.1 };

  expect(resolveInitialMarginRate(schedule, RAMP_START + 36 * 3600)).toBe(0.2);
});
