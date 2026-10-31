import { expect, test } from "bun:test";
import {
  buildFutureBalancesView,
  buildFutureHeaderMetrics,
  buildFutureOverviewMetrics,
  buildFuturePositionsView,
  describeFutureRejection,
  estimateFutureFill,
  estimateFutureLeverage,
  estimateFutureOrder,
  formatFutureUsdc,
  formatFutureVm,
  futureCloseOrder,
  futureFillVm,
  futureMarketableSize,
  futureMarkSource,
  futureOpenInterestUsd,
  futureOrderUnits,
  futureReduceOnlyTerms,
  futureTradingBlock,
  futureWorstFeeUnits,
  isOutsideFillBand,
  maxFutureSize,
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
    pendingVm: 0,
    positionUnits: 0n,
    ...overrides,
  };
}

test("the series' state is read as served, cNGN per USDC, with the band and both deadlines", () => {
  expect(STATE).toEqual({
    amountScale: 10n ** 15n,
    bandWidth: 0.1,
    baseSymbol: "cNGN",
    contractSize: 1000,
    expiryMs: 1_796_047_200_000,
    fillBand: { high: Number(SERVED.fill_band_high), low: Number(SERVED.fill_band_low) },
    indexPrice: Number(SERVED.future.index_price),
    lastTradeAtMs: 1_796_043_600_000,
    listed: true,
    markPrice: Number(SERVED.future.mark_price),
    priceDecimals: 2,
    priceGroups: [1, 0.1, 0.01],
    priceUnit: "cNGN per USDC",
    settled: false,
    sizeSymbol: "USDC",
    terms: "usdc",
    tradingClosedReason: null,
    tradingOpen: true,
    unitSize: 1,
    vmSymbol: "cNGN",
  });
  expect(parseFutureState({ ...SERVED, future: undefined })).toBeNull();
  expect(parseFutureState(null)).toBeNull();
  // A band the venue could not read is absent, never a guess.
  expect(parseFutureState({ ...SERVED, fill_band_high: undefined }).fillBand).toBeNull();
});

test("a venue without amount_scale sizes in whole contracts, so the app works either side of its deploy", () => {
  expect(CONTRACT_STATE.amountScale).toBe(ONE);
  expect(CONTRACT_STATE.unitSize).toBe(1000);
  expect(parseFutureState({ ...SERVED, amount_scale: "junk" }).unitSize).toBe(1000);
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
  // A v1 contract is 1,000 USDC whatever the price: the ceiling ignores it.
  expect(futureWorstFeeUnits(STATE, 1400)).toBe(3n * ONE);
  expect(futureWorstFeeUnits(STATE, 1)).toBeGreaterThan((25n * ONE) / 10n);
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
    price: null,
    size: 10,
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
    price: null,
    size: 2000,
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
    price: null,
    size: 2000,
    side: "short",
    state: STATE,
    takerFeeBps: 25,
  });
  expect(reducing.after).toBe(1000);
  expect(reducing.initialMargin).toBe(0);

  // A flip adds only the contracts beyond the old position.
  const flip = estimateFutureOrder({
    account: account({ positionUnits: 1n * ONE }),
    price: null,
    size: 3000,
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
    maxFutureSize({
      price: null,
      account: account({ initialMarginSurplus: 10 }),
      side: "long",
      state: STATE,
      takerFeeBps: 25,
    })
  ).toBe(39);
  // 1,000 USDC free opens 3,960 USDC; on a venue in whole contracts that is 3,000.
  expect(
    maxFutureSize({
      price: null, account: account(), side: "long", state: STATE, takerFeeBps: 25 })
  ).toBe(3960);
  expect(
    maxFutureSize({
      price: null, account: account(), side: "long", state: CONTRACT_STATE, takerFeeBps: 25 })
  ).toBe(3000);
  expect(
    maxFutureSize({
      price: null,
      account: account({ initialMarginSurplus: 0, positionUnits: 2n * ONE }),
      side: "short",
      state: STATE,
      takerFeeBps: 25,
    })
  ).toBe(2000);
  expect(maxFutureSize({
      price: null, account: null, side: "long", state: STATE, takerFeeBps: 25 })).toBe(0);
});

test("a position row shows its size in USDC with contracts beneath, and the pending VM in cNGN with its USD value", () => {
  const view = buildFuturePositionsView(
    account({ pendingVm: 13_868.12, positionUnits: -2n * ONE }),
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
  expect(futureOpenInterestUsd(4n * 10n ** 15n, STATE)).toBe(2);
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
  expect(estimateFutureLeverage({ account: flat, afterSize: 20, price: null, state: STATE })).toEqual({
    leverage: 2,
    maxLeverage: 4,
  });
  // 0.002 contract long is 2 USDC holding 0.5 USDC of initial margin: 6.47 + 0.5 credited.
  const long = account({
    imRate: 0.25,
    initialMarginSurplus: 6.47,
    positionUnits: 2n * 10n ** 15n,
  });
  const { leverage } = estimateFutureLeverage({ account: long, afterSize: 2, price: null, state: STATE });
  expect(leverage).toBeCloseTo(2 / 6.97, 9);
  expect(estimateFutureLeverage({ account: null, afterSize: 2, price: null, state: STATE })).toEqual({
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
    futureQuoting: {
      baseSymbol: STATE.baseSymbol,
      priceDecimals: STATE.priceDecimals,
      priceUnit: STATE.priceUnit,
      terms: STATE.terms,
    },
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
      futureQuoting: null,
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
  const small = estimateFutureFill({ asks, bids, side: "long", size: 1 });
  expect(small).toEqual({ averagePrice: 1384.19, slippage: 0 });
  const walked = estimateFutureFill({ asks, bids, side: "long", size: 1500 });
  const average = (1000 * 1384.19 + 500 * 1385.57) / 1500;
  expect(walked.averagePrice).toBeCloseTo(average, 9);
  expect(walked.slippage).toBeCloseTo((average - 1384.19) / 1384.19, 12);
  // More than the side holds: no estimate rather than a partial one.
  expect(
    estimateFutureFill({ asks, bids, side: "short", size: 1500 }).slippage
  ).toBeNull();
  expect(estimateFutureFill({ asks, bids, side: "long", size: null })).toEqual({
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
      position: 2,
      reduceOnly: true,
      side: "short",
      size: 5,
      unitSize: 1,
      ...overrides,
    });
  expect(terms({})).toEqual({ error: null, filled: 2, maxSize: 2, reducing: true });
  expect(terms({ side: "long" }).error).toBe("Reduce Only: Short to reduce your long position.");
  expect(terms({ position: -3, side: "short" }).error).toBe(
    "Reduce Only: Long to reduce your short position."
  );
  expect(terms({ size: 1 }).filled).toBe(1);
  // Flat: the box does nothing, and the order is as typed.
  expect(terms({ position: 0 })).toEqual({
    error: null,
    filled: 5,
    maxSize: null,
    reducing: false,
  });
  // Unticked: as typed, whatever the position.
  expect(terms({ reduceOnly: false, side: "long" })).toEqual({
    error: null,
    filled: 5,
    maxSize: null,
    reducing: false,
  });
});

// Account #35's sell of 1,553 USDC on 2026-10-15: filled at 1,376.4826 on average against a mark of
// 1,381.4172, and charged 7,663.46 cNGN on chain (6,747.50 cNGN and 0.6731 USDC at the index).
test("a fill's VM is the gap to the mark times the notional, paid by the side that fills worse", () => {
  const fill = { markPrice: 1381.4172, price: 1376.4826, size: 1553 };
  expect(futureFillVm({ ...fill, side: "short" })).toBeCloseTo(-7663.43, 1);
  expect(futureFillVm({ ...fill, side: "long" })).toBeCloseTo(7663.43, 1);
  // The 14 USDC buy above the mark that followed it: 25.96 cNGN paid.
  expect(
    futureFillVm({ markPrice: 1381.4172, price: 1383.2713, side: "long", size: 14 })
  ).toBeCloseTo(-25.96, 2);
  expect(futureFillVm({ markPrice: null, price: 1383, side: "long", size: 14 })).toBeNull();
  expect(futureFillVm({ markPrice: 1381, price: 1383, side: "long", size: 0 })).toBeNull();
});

test("a fill's VM reads as signed cNGN with its dollar value at the mark", () => {
  expect(formatFutureVm(-25.9577, 1381.4172, STATE)).toBe("-25.96 cNGN (≈ -$0.02)");
  expect(formatFutureVm(265.5961, null, STATE)).toBe("+265.60 cNGN");
  expect(formatFutureVm(null, 1381, STATE)).toBe("—");
});

/** The maker's ladder as it rested on 2026-10-28: 3,007 USDC a side, 0.05% apart. */
const LADDER = [116, 139, 167, 200, 240, 288, 346, 415, 498, 598];
const LADDER_ASKS = LADDER.map((size, i) => ({ price: 1396.68 + i * 0.7, size }));
const LADDER_BIDS = LADDER.map((size, i) => ({ price: 1392.48 - i * 0.7, size }));

test("a market order fills only what rests inside its slippage and the fill band", () => {
  const units = (overrides) =>
    futureMarketableSize({
      asks: LADDER_ASKS,
      band: STATE.fillBand,
      bids: LADDER_BIDS,
      maxSlippage: 0.005,
      side: "long",
      unitSize: 1,
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

/** cNGN-30NOV26 as `/v1/markets` served it on 2026-10-31: MarginEngine v2, USDC per cNGN, listed closed. */
const CNGN_V2 = {
  amount_scale: "1000000000000000",
  asset_address: "0xcacee66ad41fd1472a47d7d5fe372ffbfac9aa75",
  base_asset_symbol: "cNGN",
  expiry_timestamp: 1_796_047_200,
  fill_band_high: "0.00080086784952421",
  fill_band_low: "0.000655255513247082",
  margin_manager_address: "0x0705219a1594d5fc5dc2573da4082caf3e1b0950",
  quote_asset_address: "0xa74e49b4ed7cb176bc02ef4d8a1a3240c9ad4272",
  sub_id: "1796047200",
  trade_module_address: "0xdea968188598ba0e3f58a56c0fdff338c74f699f",
  future: {
    band_width: "0.1",
    contract_size: "1000000",
    contract_size_asset: "cNGN",
    expiry_timestamp: 1_796_047_200,
    index_price: "0.000728",
    last_trade_time: 1_796_043_600,
    listed: true,
    mark_price: "0.000721062681755052",
    settled: false,
    trading_closed_reason:
      "the TradeModule does not yet treat the asset as a dated future (the enable batch has not landed)",
    trading_open: false,
  },
};

/** EURC-30NOV26, likewise: USDC per EURC, one contract 1,000 EURC. */
const EURC_V2 = {
  ...CNGN_V2,
  asset_address: "0x6ff7084d6f1760a57b9475a41f54b12279cd7744",
  base_asset_symbol: "EURC",
  expiry_timestamp: 1_796_054_400,
  fill_band_high: "1.148828937",
  fill_band_low: "1.081906863",
  sub_id: "1796054400",
  future: {
    ...CNGN_V2.future,
    band_width: "0.03",
    contract_size: "1000",
    contract_size_asset: "EURC",
    expiry_timestamp: 1_796_054_400,
    index_price: "1.1154",
    last_trade_time: 1_796_050_800,
    mark_price: "1.116750502882515402",
  },
};

const CNGN_STATE = parseFutureState(CNGN_V2);
const EURC_STATE = parseFutureState(EURC_V2);

test("a v2 series is read in American terms: sized in its base, USDC per base, VM in USDC", () => {
  expect(CNGN_STATE).toMatchObject({
    baseSymbol: "cNGN",
    contractSize: 1_000_000,
    priceDecimals: 8,
    priceUnit: "USDC per cNGN",
    sizeSymbol: "cNGN",
    terms: "american",
    tradingOpen: false,
    // 0.001 contract: 1,000 cNGN a venue unit.
    unitSize: 1000,
    vmSymbol: "USDC",
  });
  expect(EURC_STATE).toMatchObject({
    contractSize: 1000,
    priceDecimals: 5,
    priceUnit: "USDC per EURC",
    sizeSymbol: "EURC",
    terms: "american",
    unitSize: 1,
  });
  // The v1 series names its contract in USDC and stays in its own terms.
  expect(STATE.terms).toBe("usdc");
  // Closed before its enable, with the venue's reason.
  expect(futureTradingBlock(CNGN_STATE, 1_796_000_000_000)).toMatch("enable batch");
});

test("a v2 size is whole venue units of its base: 1,000 cNGN, 1 EURC", () => {
  expect(futureOrderUnits(250_000, CNGN_STATE)).toBe(250);
  expect(futureOrderUnits(250_500, CNGN_STATE)).toBeNull();
  expect(futureOrderUnits(999, CNGN_STATE)).toBeNull();
  expect(futureOrderUnits(10, EURC_STATE)).toBe(10);
  expect(futureOrderUnits(10.5, EURC_STATE)).toBeNull();
});

/*
 * A v2 contract's dollar value moves with the price, so margin and fees are the size at the price
 * the order trades at: 250,000 cNGN at 0.00072 is 180 USDC, 45 of it initial margin at 25%.
 */
test("a v2 order's notional, margin and fee are its size at its price", () => {
  const cngn = estimateFutureOrder({
    account: account({ initialMarginSurplus: 100 }),
    price: 0.000_72,
    side: "long",
    size: 250_000,
    state: CNGN_STATE,
    takerFeeBps: 25,
  });
  expect(cngn.notional).toBeCloseTo(180, 9);
  expect(cngn.initialMargin).toBeCloseTo(45, 9);
  expect(cngn.fee).toBeCloseTo(0.45, 9);
  expect(cngn.after).toBe(250_000);
  expect(cngn.shortfall).toBe(0);
  const eurc = estimateFutureOrder({
    account: account({ imRate: 0.06, initialMarginSurplus: 0.5 }),
    price: 1.1168,
    side: "short",
    size: 10,
    state: EURC_STATE,
    takerFeeBps: 25,
  });
  expect(eurc.notional).toBeCloseTo(11.168, 9);
  expect(eurc.initialMargin).toBeCloseTo(0.670_08, 9);
  expect(eurc.shortfall).toBeCloseTo(0.670_08 + 0.027_92 - 0.5, 9);
  // Without a price nothing about a v2 order's dollars can be said.
  expect(
    estimateFutureOrder({
      account: account(),
      price: null,
      side: "long",
      size: 10,
      state: EURC_STATE,
      takerFeeBps: 25,
    })
  ).toMatchObject({ fee: null, initialMargin: null, notional: null });
});

test("MAX on a v2 series is the surplus's USDC at the price, in whole units of the base", () => {
  // 100 USDC ÷ (6% + 0.25%) = 1,600 USDC; at 1.1168 that is 1,432.66 EURC, so 1,432.
  expect(
    maxFutureSize({
      account: account({ imRate: 0.06, initialMarginSurplus: 100 }),
      price: 1.1168,
      side: "long",
      state: EURC_STATE,
      takerFeeBps: 25,
    })
  ).toBe(1432);
  // 100 USDC ÷ 25.25% = 396.04 USDC; at 0.00072 that is 550,055 cNGN, so 550,000.
  expect(
    maxFutureSize({
      account: account({ initialMarginSurplus: 100 }),
      price: 0.000_72,
      side: "long",
      state: CNGN_STATE,
      takerFeeBps: 25,
    })
  ).toBe(550_000);
  // No price, nothing to open; a position can still be closed.
  expect(
    maxFutureSize({
      account: account({ positionUnits: ONE / 4n }),
      price: null,
      side: "short",
      state: CNGN_STATE,
      takerFeeBps: 25,
    })
  ).toBe(250_000);
});

test("a v2 fee ceiling is a contract at the band's top, so no fill inside it can exceed it", () => {
  // 1,000 EURC at 1.148828937 × 30 bps = 3.4465 USDC, rounded up to the micro-USDC.
  expect(futureWorstFeeUnits(EURC_STATE, 1.148_828_937)).toBe(3_446_487n * 10n ** 12n);
  // 1,000,000 cNGN at 0.00080086784952421 × 30 bps = 2.4026 USDC.
  expect(futureWorstFeeUnits(CNGN_STATE, 0.000_800_867_849_524_21)).toBe(2_402_604n * 10n ** 12n);
});

test("a v2 position reads in its base, valued at the mark, its pending VM in USDC", () => {
  const view = buildFuturePositionsView(
    account({ imRate: 0.25, pendingVm: 12.345, positionUnits: ONE / 4n }),
    CNGN_STATE,
    "cNGN-30NOV26"
  );
  const [row] = view.rows;
  expect(row.cells[1]).toBe("250,000 cNGN");
  expect(row.details[1]).toBe("0.25 contracts");
  // 250,000 × 0.000721062681755052 = 180.27.
  expect(row.cells[2]).toBe("$180.27");
  expect(row.cells[3]).toBe("0.00072106");
  expect(row.cells[4]).toBe("+$12.35");
  // VM is already dollars: no restatement beneath it.
  expect(row.details[4]).toBeUndefined();
  expect(row.cells[5]).toBe("$45.07");
});

test("a v2 fill's VM is the gap to the mark times the base size, in USDC", () => {
  // 10 EURC long at 1.1200 against a 1.1168 mark pays 0.032 USDC.
  expect(futureFillVm({ markPrice: 1.1168, price: 1.12, side: "long", size: 10 })).toBeCloseTo(
    -0.032,
    12
  );
  expect(formatFutureVm(-0.032, 1.1168, EURC_STATE)).toBe("-$0.03");
});

test("v2 open interest is half the tracked contracts at the mark", () => {
  // 0.5 contract tracked is 0.25 open: 250,000 cNGN at 0.000721062681755052.
  expect(futureOpenInterestUsd(ONE / 2n, CNGN_STATE)).toBeCloseTo(180.265_670_4, 6);
  expect(futureOpenInterestUsd(ONE / 2n, { ...CNGN_STATE, markPrice: null })).toBeNull();
});

test("the v2 header quotes in USDC per base to the series' decimals", () => {
  const byLabel = Object.fromEntries(
    buildFutureHeaderMetrics({
      markSource: "carry",
      nowMs: 1_796_000_000_000,
      openInterestUsd: 0,
      state: EURC_STATE,
    }).map((m) => [m.label, m])
  );
  expect(byLabel.Mark.value).toBe("1.11675");
  expect(byLabel.Mark.tooltip).toMatch("USDC per EURC");
  expect(byLabel.Mark.tooltip).toMatch("EUR–USD");
  expect(byLabel.Index.value).toBe("1.11540");
  expect(byLabel.Index.tooltip).toMatch("EURC reference in USDC per EURC");
  // cNGN trades at a discount to its index: a negative basis.
  const cngn = Object.fromEntries(
    buildFutureHeaderMetrics({
      markSource: null,
      nowMs: 1_796_000_000_000,
      openInterestUsd: null,
      state: CNGN_STATE,
    }).map((m) => [m.label, m])
  );
  expect(cngn.Mark.value).toBe("0.00072106");
  expect(cngn.Basis.tone).toBe("down");
});

test("a v2 market order fills what rests inside its slippage, in whole units of the base", () => {
  // Book sizes in cNGN, as the terminal restates them: 116 and 139 venue units of 1,000 cNGN.
  const asks = [
    { price: 0.000_721_33, size: 116_000 },
    { price: 0.000_721_69, size: 139_000 },
  ];
  const size = futureMarketableSize({
    asks,
    band: CNGN_STATE.fillBand,
    bids: [],
    maxSlippage: 0.005,
    side: "long",
    unitSize: 1000,
  });
  expect(size).toBe(255_000);
  const close = futureCloseOrder({
    account: account({ positionUnits: -(ONE / 10n) }),
    asks,
    bids: [],
    maxSlippage: 0.005,
    state: CNGN_STATE,
  });
  // A 100,000 cNGN short closes as 100 venue units of 1,000 cNGN.
  expect(close).toEqual({ held: 100, side: "long", units: 100 });
});

test("a v2 account lists USDC alone: the series margins in USDC", () => {
  const view = buildFutureBalancesView(account({ cngn: 5, cngnUnits: 5n * ONE }), CNGN_STATE);
  expect(view.rows.map((row) => row.cells[0])).toEqual(["USDC"]);
  expect(buildFutureBalancesView(account(), STATE).rows.map((row) => row.cells[0])).toEqual([
    "USDC",
    "cNGN",
  ]);
});
