import { expect, test } from "bun:test";
import {
  buildFutureHeaderMetrics,
  buildFutureOverviewMetrics,
  buildFuturePositionsView,
  describeFutureRejection,
  estimateFutureFill,
  estimateFutureLeverage,
  estimateFutureOrder,
  formatFutureUsdc,
  formatFutureVm,
  futureFillVmCngn,
  futureCloseOrder,
  futureMarketableUnits,
  futureMarkSource,
  futureOpenInterestUsd,
  futureOrderUnits,
  futureReduceOnlyTerms,
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

test("the header shows mark, index, basis, APR and open interest, in that order", () => {
  const nowMs = 1_796_043_600_000 - 3_600_000;
  const metrics = buildFutureHeaderMetrics({
    markSource: "book",
    nowMs,
    openInterestUsd: 2,
    state: STATE,
  });
  expect(metrics.map((m) => m.label)).toEqual(["Mark", "Index", "Basis", "APR", "Open Interest"]);
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
});

test("a negative basis is red, and a missing or zero index leaves basis and APR blank", () => {
  const nowMs = 1_796_043_600_000 - 3_600_000;
  const below = { ...STATE, indexPrice: 1365.44, markPrice: 1350 };
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

test("an expired series has no APR", () => {
  const expired = Object.fromEntries(
    buildFutureHeaderMetrics({
      markSource: null,
      nowMs: STATE.expiryMs + 60_000,
      openInterestUsd: null,
      state: STATE,
    }).map((m) => [m.label, m.value])
  );
  expect(expired.APR).toBe("—");
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
  expect(empty.map((m) => m.value)).toEqual(["—", "—", "—", "—", "—"]);
  expect(empty.find((m) => m.label === "Basis")?.tooltip).toBe(
    "Mark − Index. Positive when the future trades above spot."
  );
});

/*
 * A market order's expected price and slippage come from walking the book in USDC of notional:
 * 1 USDC at the best ask fills at it (0 slippage); 1,500 USDC takes all 1,000 at the touch and 500
 * at the next level.
 */
test("a market order's fill is walked through the book in USDC", () => {
  const asks = [
    { price: 1384.19, size: 1000, total: 1000 },
    { price: 1385.57, size: 1000, total: 2000 },
  ];
  const bids = [{ price: 1378.6, size: 1000, total: 1000 }];
  const small = estimateFutureFill({ asks, bids, notional: 1, side: "long", state: STATE });
  expect(small).toEqual({ averagePrice: 1384.19, slippage: 0 });
  const walked = estimateFutureFill({ asks, bids, notional: 1500, side: "long", state: STATE });
  const average = (1000 * 1384.19 + 500 * 1385.57) / 1500;
  expect(walked.averagePrice).toBeCloseTo(average, 9);
  expect(walked.slippage).toBeCloseTo((average - 1384.19) / 1384.19, 12);
  // More than the side holds: no estimate rather than a partial one.
  expect(
    estimateFutureFill({ asks, bids, notional: 1500, side: "short", state: STATE }).slippage
  ).toBeNull();
  expect(estimateFutureFill({ asks, bids, notional: null, side: "long", state: STATE })).toEqual({
    averagePrice: null,
    slippage: null,
  });
});

test("a fee under a cent shows four places, never 0.00", () => {
  expect(formatFutureUsdc(0.0025)).toBe("0.0025 USDC");
  expect(formatFutureUsdc(2.5)).toBe("2.50 USDC");
  expect(formatFutureUsdc(0)).toBe("0.00 USDC");
  expect(formatFutureUsdc(null)).toBe("—");
});

test("no open interest reads $0; an unread one a dash", () => {
  const nowMs = 1_796_043_600_000 - 3_600_000;
  const oi = (openInterestUsd) =>
    buildFutureHeaderMetrics({ markSource: null, nowMs, openInterestUsd, state: STATE }).find(
      (m) => m.label === "Open Interest"
    )?.value;
  expect(oi(0)).toBe("$0");
  expect(oi(null)).toBe("—");
  expect(oi(2)).toBe("$2.00");
});

/*
 * Reduce Only is in force only with a position; an order on the position's own side is refused
 * before it is sent; the fill the ticket shows is capped at the position; MAX offers the position.
 */
test("Reduce Only: only against a position, never on its own side, capped at it", () => {
  const terms = (overrides) =>
    futureReduceOnlyTerms({
      notional: 5,
      position: 2,
      reduceOnly: true,
      side: "short",
      unitUsdc: 1,
      ...overrides,
    });
  expect(terms({})).toEqual({ error: null, filled: 2, maxNotional: 2, reducing: true });
  expect(terms({ side: "long" }).error).toBe("Reduce Only: Short to reduce your long position.");
  expect(terms({ position: -3, side: "short" }).error).toBe(
    "Reduce Only: Long to reduce your short position."
  );
  expect(terms({ notional: 1 }).filled).toBe(1);
  // Flat: the box does nothing, and the order is as typed.
  expect(terms({ position: 0 })).toEqual({
    error: null,
    filled: 5,
    maxNotional: null,
    reducing: false,
  });
  // Unticked: as typed, whatever the position.
  expect(terms({ reduceOnly: false, side: "long" })).toEqual({
    error: null,
    filled: 5,
    maxNotional: null,
    reducing: false,
  });
});

// Account #35's sell of 1,553 USDC on 2026-10-15: filled at 1,376.4826 on average against a mark of
// 1,381.4172, and charged 7,663.46 cNGN on chain (6,747.50 cNGN and 0.6731 USDC at the index).
test("a fill's VM is the gap to the mark times the notional, paid by the side that fills worse", () => {
  const fill = { markPrice: 1381.4172, notional: 1553, price: 1376.4826 };
  expect(futureFillVmCngn({ ...fill, side: "short" })).toBeCloseTo(-7663.43, 1);
  expect(futureFillVmCngn({ ...fill, side: "long" })).toBeCloseTo(7663.43, 1);
  // The 14 USDC buy above the mark that followed it: 25.96 cNGN paid.
  expect(
    futureFillVmCngn({ markPrice: 1381.4172, notional: 14, price: 1383.2713, side: "long" })
  ).toBeCloseTo(-25.96, 2);
  expect(futureFillVmCngn({ markPrice: null, notional: 14, price: 1383, side: "long" })).toBeNull();
  expect(futureFillVmCngn({ markPrice: 1381, notional: 0, price: 1383, side: "long" })).toBeNull();
});

test("a fill's VM reads as signed cNGN with its dollar value at the mark", () => {
  expect(formatFutureVm(-25.9577, 1381.4172)).toBe("-25.96 cNGN (≈ -$0.02)");
  expect(formatFutureVm(265.5961, null)).toBe("+265.60 cNGN");
  expect(formatFutureVm(null, 1381)).toBe("—");
});

/** The maker's ladder as it rested on 2026-10-28: 3,007 USDC a side, 0.05% apart. */
const LADDER = [116, 139, 167, 200, 240, 288, 346, 415, 498, 598];
const LADDER_ASKS = LADDER.map((size, i) => ({ price: 1396.68 + i * 0.7, size }));
const LADDER_BIDS = LADDER.map((size, i) => ({ price: 1392.48 - i * 0.7, size }));

test("a market order fills only what rests inside its slippage and the fill band", () => {
  const units = (overrides) =>
    futureMarketableUnits({
      asks: LADDER_ASKS,
      band: STATE.fillBand,
      bids: LADDER_BIDS,
      maxSlippage: 0.005,
      side: "long",
      ...overrides,
    });
  // 0.5% past 1,396.68 is 1,403.66: every rung.
  expect(units({})).toBe(3007);
  // 0.11% past is 1,398.22: the first three.
  expect(units({ maxSlippage: 0.0011 })).toBe(422);
  expect(units({ maxSlippage: 0.0011, side: "short" })).toBe(422);
  // The band holds the limit inside it, whatever the slippage.
  expect(units({ band: { high: 1397.5, low: 1200 } })).toBe(255);
  expect(units({ asks: [] })).toBe(0);
});

test("Close: the opposite side, sized to the position or what the book fills, whichever is less", () => {
  const close = (overrides) =>
    futureCloseOrder({
      account: account({ positionUnits: -11_348n * 10n ** 15n }),
      asks: LADDER_ASKS,
      bids: LADDER_BIDS,
      maxSlippage: 0.005,
      state: STATE,
      ...overrides,
    });
  // An 11,348 USDC short against 3,007 of asks closes in part.
  expect(close({})).toEqual({ held: 11_348, side: "long", units: 3007 });
  expect(close({ account: account({ positionUnits: 500n * 10n ** 15n }) })).toEqual({
    held: 500,
    side: "short",
    units: 500,
  });
  expect(close({ account: account() })).toEqual({ error: "No position to close." });
  expect(close({ account: null })).toEqual({ error: "No position to close." });
  expect(close({ asks: [] })).toEqual({
    error: "No asks to close against. Use a reduce-only limit order.",
  });
});
