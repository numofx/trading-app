import { expect, test } from "bun:test";
import {
  buildFutureHeaderMetrics,
  buildFutureOverviewMetrics,
  buildFuturePositionsView,
  describeFutureRejection,
  estimateFutureLeverage,
  futureMarkSource,
  futureOpenInterestUsd,
  estimateFutureOrder,
  formatCountdown,
  futureOrderUnits,
  futureTradingBlock,
  futureWorstFeeUnits,
  isOutsideFillBand,
  maxFutureNotional,
  parseFutureStack,
  parseFutureState,
} from "./future-market.ts";

/** USDC-cNGN-30NOV26 as `/v1/markets` serves it once the venue sizes it in USDC (2026-10-14). */
const SERVED = {
  amount_scale: "1000000000000000",
  asset_address: "0xdcfa4ee0772647abd24e8592596b5fe4f001bc19",
  expiry_timestamp: 1_796_047_200,
  fill_band_high: "1501.984929417500626984",
  fill_band_low: "1228.896760432500512988",
  margin_manager_address: "0xa19e296021c9df25b90d96c2a0793cc3d0800758",
  quote_asset_address: "0xa74e49b4ed7cb176bc02ef4d8a1a3240c9ad4272",
  sub_id: "1796047200",
  trade_module_address: "0xdea968188598ba0e3f58a56c0fdff338c74f699f",
  future: {
    band_status: "ok",
    band_width: "0.1",
    contract_size_usdc: "1000",
    expiry_timestamp: 1_796_047_200,
    index_price: "1365.440844925000569986",
    last_trade_time: 1_796_043_600,
    listed: true,
    mark_price: "1386.812422861627203037",
    settled: false,
    trading_open: true,
  },
};

const STATE = parseFutureState(SERVED);
/** The same series from a venue that still sizes it in whole contracts: no `amount_scale`. */
const CONTRACT_STATE = parseFutureState({ ...SERVED, amount_scale: undefined });

const LAST_TRADE = /last trade time/;
const SETTLED = /settled/;
const PAUSED = /manager is paused/;
const FILL_BAND = /fill band/;
const BOOK_DERIVED = /book-derived/;
const WRONG_ACCOUNT = /cannot hold the future/;
const ONE = 10n ** 18n;

function account(overrides = {}) {
  return {
    cash: 1000,
    cashUnits: 1000n * ONE,
    cngn: 0,
    cngnUnits: 0n,
    imRate: 0.25,
    initialMarginSurplus: 1000,
    maintenanceMarginSurplus: 1400,
    mmRate: 0.15,
    pendingVmCngn: 0,
    positionUnits: 0n,
    ...overrides,
  };
}

test("the series' state is read as served, cNGN per USDC, with the band and both deadlines", () => {
  expect(STATE).toEqual({
    amountScale: 10n ** 15n,
    bandWidth: 0.1,
    contractSizeUsdc: 1000,
    expiryMs: 1_796_047_200_000,
    fillBand: { high: Number(SERVED.fill_band_high), low: Number(SERVED.fill_band_low) },
    indexPrice: Number(SERVED.future.index_price),
    lastTradeAtMs: 1_796_043_600_000,
    listed: true,
    markPrice: Number(SERVED.future.mark_price),
    settled: false,
    tradingClosedReason: null,
    tradingOpen: true,
    unitUsdc: 1,
  });
  expect(parseFutureState({ ...SERVED, future: undefined })).toBeNull();
  expect(parseFutureState(null)).toBeNull();
  // A band the venue could not read is absent, never a guess.
  expect(parseFutureState({ ...SERVED, fill_band_high: undefined }).fillBand).toBeNull();
});

test("a venue without amount_scale sizes in whole contracts, so the app works either side of its deploy", () => {
  expect(CONTRACT_STATE.amountScale).toBe(ONE);
  expect(CONTRACT_STATE.unitUsdc).toBe(1000);
  expect(parseFutureState({ ...SERVED, amount_scale: "junk" }).unitUsdc).toBe(1000);
});

test("a ticket's USDC size is whole venue units: 1 USDC is the smallest order", () => {
  expect(futureOrderUnits(1, STATE)).toBe(1);
  expect(futureOrderUnits(10, STATE)).toBe(10);
  expect(futureOrderUnits(0.5, STATE)).toBeNull();
  expect(futureOrderUnits(10.5, STATE)).toBeNull();
  expect(futureOrderUnits(0, STATE)).toBeNull();
  // On a venue still sizing in contracts, only whole 1,000s.
  expect(futureOrderUnits(2000, CONTRACT_STATE)).toBe(2);
  expect(futureOrderUnits(10, CONTRACT_STATE)).toBeNull();
});

test("the stack is checksummed and complete, or nothing", () => {
  const stack = parseFutureStack(SERVED);
  expect(stack?.managerAddress).toBe("0xA19E296021c9DF25b90D96C2A0793CC3D0800758");
  expect(stack?.subId).toBe("1796047200");
  expect(parseFutureStack({ ...SERVED, margin_manager_address: undefined })).toBeNull();
  expect(parseFutureStack({ ...SERVED, sub_id: "nope" })).toBeNull();
});

test("the fee ceiling is 30 bps of a contract, above the matcher's 2.5 USDC floor", () => {
  expect(futureWorstFeeUnits(1000)).toBe(3n * ONE);
  expect(futureWorstFeeUnits(1000)).toBeGreaterThan((25n * ONE) / 10n);
});

test("orders are refused after the last trade time, once settled, and while the venue holds the series", () => {
  const before = 1_796_043_599_000;
  expect(futureTradingBlock(STATE, before)).toBeNull();
  expect(futureTradingBlock(STATE, 1_796_043_600_000)).toMatch(LAST_TRADE);
  expect(futureTradingBlock({ ...STATE, settled: true }, before)).toMatch(SETTLED);
  expect(
    futureTradingBlock(
      { ...STATE, tradingClosedReason: "manager is paused", tradingOpen: false },
      before
    )
  ).toMatch(PAUSED);
});

test("a limit outside the band is caught before it is signed", () => {
  expect(isOutsideFillBand(1400, STATE.fillBand)).toBe(false);
  expect(isOutsideFillBand(1200, STATE.fillBand)).toBe(true);
  expect(isOutsideFillBand(1600, STATE.fillBand)).toBe(true);
});

test("an opening order needs initial margin on what it adds; a reduction needs none", () => {
  const small = estimateFutureOrder({
    account: account({ initialMarginSurplus: 10 }),
    notional: 10,
    side: "long",
    state: STATE,
    takerFeeBps: 25,
  });
  // 10 USDC long: 2.50 USDC of initial margin and a 0.025 USDC fee, inside 10 USDC free.
  expect(small.initialMargin).toBe(2.5);
  expect(small.fee).toBe(0.025);
  expect(small.shortfall).toBe(0);

  const opening = estimateFutureOrder({
    account: account(),
    notional: 2000,
    side: "long",
    state: STATE,
    takerFeeBps: 25,
  });
  expect(opening.initialMargin).toBe(500);
  expect(opening.fee).toBe(5);
  expect(opening.notional).toBe(2000);
  expect(opening.shortfall).toBe(0);

  const reducing = estimateFutureOrder({
    account: account({ initialMarginSurplus: 0, positionUnits: 3n * ONE }),
    notional: 2000,
    side: "short",
    state: STATE,
    takerFeeBps: 25,
  });
  expect(reducing.after).toBe(1000);
  expect(reducing.initialMargin).toBe(0);

  // A flip adds only the contracts beyond the old position.
  const flip = estimateFutureOrder({
    account: account({ positionUnits: 1n * ONE }),
    notional: 3000,
    side: "short",
    state: STATE,
    takerFeeBps: 25,
  });
  expect(flip.after).toBe(-2000);
  expect(flip.initialMargin).toBe(250);
});

test("MAX is what the surplus opens at the engine's rate and fee, plus the position it can close", () => {
  // 10 USDC free ÷ (25% IM + 0.25% fee) = 39.6, so 39 USDC.
  expect(
    maxFutureNotional({
      account: account({ initialMarginSurplus: 10 }),
      side: "long",
      state: STATE,
      takerFeeBps: 25,
    })
  ).toBe(39);
  // 1,000 USDC free opens 3,960 USDC; on a venue in whole contracts that is 3,000.
  expect(
    maxFutureNotional({ account: account(), side: "long", state: STATE, takerFeeBps: 25 })
  ).toBe(3960);
  expect(
    maxFutureNotional({ account: account(), side: "long", state: CONTRACT_STATE, takerFeeBps: 25 })
  ).toBe(3000);
  expect(
    maxFutureNotional({
      account: account({ initialMarginSurplus: 0, positionUnits: 2n * ONE }),
      side: "short",
      state: STATE,
      takerFeeBps: 25,
    })
  ).toBe(2000);
  expect(maxFutureNotional({ account: null, side: "long", state: STATE, takerFeeBps: 25 })).toBe(0);
});

test("a position row shows its size in USDC with contracts beneath, and the pending VM in cNGN with its USD value", () => {
  const view = buildFuturePositionsView(
    account({ pendingVmCngn: 13_868.12, positionUnits: -2n * ONE }),
    STATE,
    "USDC-cNGN-30NOV26"
  );
  expect(view.rows).toHaveLength(1);
  const [row] = view.rows;
  expect(row.cells[1]).toBe("2,000 USDC");
  expect(row.details[1]).toBe("2 contracts");
  expect(row.cells[2]).toBe("$2,000.00");
  expect(view.columns[4]).toBe("Pending VM");
  expect(row.cells[4]).toBe("+13,868.12 cNGN");
  expect(row.details[4]).toBe("(≈ +$10.00)");
  expect(row.badges[0][0].label).toBe("Short");
  expect(buildFuturePositionsView(account(), STATE, "x").rows).toHaveLength(0);
});

test("the countdown reads in its two coarsest units", () => {
  const day = 86_400_000;
  expect(formatCountdown(48 * day + 17 * 3_600_000 + 5, 0)).toBe("48d 17h");
  expect(formatCountdown(5 * 3_600_000 + 12 * 60_000, 0)).toBe("5h 12m");
  expect(formatCountdown(30_000, 0)).toBe("<1m");
  expect(formatCountdown(0, 1)).toBe("—");
});

test("the header shows mark, index, basis, APR, open interest and time to expiry, in that order", () => {
  const nowMs = 1_796_043_600_000 - 3_600_000;
  const metrics = buildFutureHeaderMetrics({
    markSource: "book",
    nowMs,
    openInterestUsd: 2,
    state: STATE,
  });
  expect(metrics.map((m) => m.label)).toEqual([
    "Mark",
    "Index",
    "Basis",
    "APR",
    "Open Interest",
    "Expires In",
  ]);
  const byLabel = Object.fromEntries(metrics.map((m) => [m.label, m]));
  expect(byLabel.Mark.value).toBe("1,386.81");
  expect(byLabel.Mark.tooltip).toMatch(BOOK_DERIVED);
  expect(byLabel.Index.value).toBe("1,365.44");
  // Forward points and the premium: 1,386.81 − 1,365.44 = +21.37, 1,386.81 / 1,365.44 − 1 = +1.57%.
  expect(byLabel.Basis.value).toBe("+21.37 (+1.57%)");
  expect(byLabel.Basis.tone).toBe("up");
  // Two hours to expiry spreads the premium over 2/24 of a day.
  const premium = STATE.markPrice / STATE.indexPrice - 1;
  expect(byLabel.APR.value).toBe(`+${(premium * 365 * 12 * 100).toFixed(2)}%`);
  expect(byLabel["Open Interest"].value).toBe("$2.00");
  expect(byLabel["Expires In"].value).toBe("2h 0m");
});

test("a negative basis is red, and a missing or zero index leaves basis and APR blank", () => {
  const nowMs = 1_796_043_600_000 - 3_600_000;
  const below = { ...STATE, markPrice: 1350, indexPrice: 1365.44 };
  const negative = Object.fromEntries(
    buildFutureHeaderMetrics({ markSource: null, nowMs, openInterestUsd: null, state: below }).map(
      (m) => [m.label, m]
    )
  );
  expect(negative.Basis.value).toBe("-15.44 (-1.13%)");
  expect(negative.Basis.tone).toBe("down");
  expect(negative.APR.value.startsWith("-")).toBe(true);
  expect(negative["Open Interest"].value).toBe("—");
  for (const indexPrice of [null, 0]) {
    const byLabel = Object.fromEntries(
      buildFutureHeaderMetrics({
        markSource: null,
        nowMs,
        openInterestUsd: null,
        state: { ...STATE, indexPrice },
      }).map((m) => [m.label, m.value])
    );
    expect(byLabel.Basis).toBe("—");
    expect(byLabel.APR).toBe("—");
  }
});

test("an expired series has no APR and reads Expired, then Settled", () => {
  const after = STATE.expiryMs + 60_000;
  const expired = Object.fromEntries(
    buildFutureHeaderMetrics({
      markSource: null,
      nowMs: after,
      openInterestUsd: null,
      state: STATE,
    }).map((m) => [m.label, m.value])
  );
  expect(expired.APR).toBe("—");
  expect(expired["Expires In"]).toBe("Expired");
  const settled = buildFutureHeaderMetrics({
    markSource: null,
    nowMs: after,
    openInterestUsd: null,
    state: { ...STATE, settled: true },
  }).find((m) => m.label === "Expires In");
  expect(settled?.value).toBe("Settled");
});

test("open interest is half the tracked |positions|, at the contract's notional", () => {
  // 0.002 contract long against 0.002 short: totalPosition 0.004 contract, 2 USDC open.
  expect(futureOpenInterestUsd(4n * 10n ** 15n, 1000)).toBe(2);
  expect(futureMarkSource({ asks: 3000, bids: 3000 })).toBe("book");
  expect(futureMarkSource({ asks: 3000, bids: 1999 })).toBe("carry");
});

test("the venue's refusals read in the trader's terms", () => {
  expect(describeFutureRejection("fill_band: limit price 1600 outside the band", "x")).toMatch(
    FILL_BAND
  );
  expect(
    describeFutureRejection("account 12 is under manager 0x1, not the MarginEngine", "x")
  ).toMatch(WRONG_ACCOUNT);
  expect(describeFutureRejection(undefined, "fallback")).toBe("fallback");
});

/*
 * Leverage is the position after the order over the margin the engine credits: the surplus plus
 * what the open position already holds. At the most the ticket offers, it reaches 1 / the initial
 * rate (fee aside), the engine's ceiling.
 */
test("the account's leverage after an order, against the engine's ceiling", () => {
  const flat = account({ imRate: 0.25, initialMarginSurplus: 10, positionUnits: 0n });
  expect(estimateFutureLeverage({ account: flat, afterNotional: 20, state: STATE })).toEqual({
    leverage: 2,
    maxLeverage: 4,
  });
  // 0.002 contract long is 2 USDC holding 0.5 USDC of initial margin: 6.47 + 0.5 credited.
  const long = account({
    imRate: 0.25,
    initialMarginSurplus: 6.47,
    positionUnits: 2n * 10n ** 15n,
  });
  const { leverage } = estimateFutureLeverage({ account: long, afterNotional: 2, state: STATE });
  expect(leverage).toBeCloseTo(2 / 6.97, 9);
  expect(estimateFutureLeverage({ account: null, afterNotional: 2, state: STATE })).toEqual({
    leverage: null,
    maxLeverage: null,
  });
});

/*
 * The selector's Futures tab and a switch's seeded header both build from a selector row through
 * the bar's own builder, so a series reads the same in all three places.
 */
test("a selector row yields the stats bar's figures", () => {
  const nowMs = 1_796_043_600_000 - 3_600_000;
  const row = {
    expiryMs: STATE.expiryMs,
    indexPrice: STATE.indexPrice,
    lastTradeAtMs: STATE.lastTradeAtMs,
    markPrice: STATE.markPrice,
    markSource: "book",
    openInterestUsd: 2,
    settled: false,
  };
  const fromRow = buildFutureOverviewMetrics(row, nowMs);
  const fromBar = buildFutureHeaderMetrics({
    markSource: "book",
    nowMs,
    openInterestUsd: 2,
    state: STATE,
  });
  expect(fromRow).toEqual(fromBar);
  // Nothing served: every figure a dash, the labels and their tooltips still there for the headers.
  const empty = buildFutureOverviewMetrics(
    {
      expiryMs: null,
      indexPrice: null,
      lastTradeAtMs: null,
      markPrice: null,
      markSource: null,
      openInterestUsd: null,
      settled: null,
    },
    nowMs
  );
  expect(empty.map((m) => m.value)).toEqual(["—", "—", "—", "—", "—", "—"]);
  expect(empty.find((m) => m.label === "Basis")?.tooltip).toBe(
    "Mark − Index. Positive when the future trades above spot."
  );
});
