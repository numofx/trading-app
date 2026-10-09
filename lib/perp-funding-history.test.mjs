import { expect, test } from "bun:test";
import {
  buildFundingHistoryView,
  buildFundingPayments,
  estimateFundingAccrual,
} from "./perp-funding-history.ts";

const update = (aggregate, rate, at) => ({
  aggregatedFundingRate: aggregate,
  eventName: "AggregatedFundingUpdated",
  fundingRate: rate,
  lastFundingPaidAt: at,
});
const applied = (accountId, funding, aggregate) => ({
  accountId,
  aggregatedFundingRate: aggregate,
  eventName: "FundingAppliedOnAccount",
  funding,
});

// Base blocks 52392568 → 52393195 (2026-10-09): account 25 held a 193,285 cNGN long from 19:34Z
// and was booked +0.000848 USDC at 19:55:37Z; account 24, the maker's short, paid the same.
const RATE = -17_123_287_671_233n;
const LOGS = [
  applied(25n, 0n, 763_119_350_904n),
  applied(24n, 0n, 763_119_350_904n),
  update(758_731_262_707n, RATE, 1_791_575_737n),
  applied(25n, 848_151_627_157_145n, 758_731_262_707n),
  applied(24n, -848_151_627_157_145n, 758_731_262_707n),
  // The second touch in the same transaction books nothing more.
  applied(25n, 0n, 758_731_262_707n),
];

test("a booking reads its size back from the aggregate it covered, at the block's time and rate", () => {
  expect(buildFundingPayments(LOGS, 25n)).toEqual([
    {
      payment: 0.000_848_151_627_157_145,
      rate: -0.000_017_123_287_671_233,
      size: 193_285,
      timestamp: 1_791_575_737,
    },
  ]);
  const [short] = buildFundingPayments(LOGS, 24n);
  expect(short.size).toBe(-193_285);
  expect(short.payment).toBeCloseTo(-0.000_848_151_6, 9);
});

test("zero bookings and other accounts are not rows", () => {
  expect(buildFundingPayments(LOGS, 99n)).toEqual([]);
  expect(buildFundingPayments(LOGS.slice(0, 3), 25n)).toEqual([]);
});

test("an open long accrues at the live rate since the last update", () => {
  // One hour at -0.0017%/h on 193,285 cNGN at 0.0007357: longs receive.
  const accrual = estimateFundingAccrual({
    aggregatedFunding: 0n,
    fundingRate: RATE,
    indexPrice: 735_700_000_000_000n,
    lastAggregatedFunding: 0n,
    lastFundingPaidAt: 1_000n,
    nowSeconds: 4_600n,
    size: 193_285n,
  });
  expect(accrual.payment).toBeCloseTo(193_285 * 0.000_735_7 * 0.000_017_123_287_671_233, 9);
  expect(
    estimateFundingAccrual({
      aggregatedFunding: 0n,
      fundingRate: RATE,
      indexPrice: 1n,
      lastAggregatedFunding: 0n,
      lastFundingPaidAt: 0n,
      nowSeconds: 1n,
      size: 0n,
    })
  ).toBeNull();
});

test("the tab lists the accrual first, then bookings, with side badges and signed payments", () => {
  const view = buildFundingHistoryView(
    buildFundingPayments(LOGS, 25n),
    { payment: 0.0024, rate: -0.000_017_12, size: 193_285 },
    "cNGN-PERP",
    "UTC"
  );
  expect(view.columns).toEqual(["Time", "Market", "Position", "Funding Rate", "Payment"]);
  expect(view.rows[0].cells).toEqual([
    "Accruing",
    "cNGN-PERP",
    "193,285 cNGN",
    "-0.0017%",
    "$0.0024",
  ]);
  expect(view.rows[0].details).toEqual({ 4: "est." });
  expect(view.rows[1].cells).toEqual([
    "10/09/26 07:55 PM",
    "cNGN-PERP",
    "193,285 cNGN",
    "-0.0017%",
    "$0.000848",
  ]);
  expect(view.rows[1].badges).toEqual({ 1: [{ label: "Long", tone: "positive" }] });
  expect(view.rows[1].tones).toEqual({ 1: "positive", 4: "positive" });
});
