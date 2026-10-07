import { expect, test } from "bun:test";
import {
  buildPerpHeaderMetrics,
  buildPerpMarginView,
  buildPerpPositionsView,
  describePerpMarginSources,
  describeOrderRejection,
  estimateLiquidationPrice,
  getLeverageCeiling,
  getPerpCollateralWithdrawableAsset,
  getPerpWithdrawableAsset,
  parsePerpStack,
  parsePerpState,
  parsePositionsResponse,
  PERP_POSITIONS_COLUMNS,
  TRADING_PAUSED_MESSAGE,
  perpOrderUiSide,
  perpSideLabel,
  perpSubmitLabel,
} from "./perp-market.ts";

const served = {
  funding_interval_seconds: 3600,
  index_price_ui: "0.00072",
  initial_margin_rate: "0.33333",
  maintenance_margin_rate: "0.2",
  margin_manager_address: "0x5555555555555555555555555555555555555555",
  mark_price_ui: "0.00072",
  max_leverage: "3",
  open_interest_usd: "7200",
  quote_asset_address: "0x4444444444444444444444444444444444444444",
  trade_module_address: "0x2222222222222222222222222222222222222222",
  trading_enabled: true,
  ui_long_funding_rate_1h: "-0.0000125",
};

test("parses the perp's chain state as the venue serves it", () => {
  const state = parsePerpState(served);
  expect(state?.markPrice).toBe(0.000_72);
  expect(state?.maxLeverage).toBe(3);
  expect(state?.uiLongFundingRate1h).toBe(-0.000_012_5);
});

test("the market is closed unless the venue says it is open", () => {
  expect(parsePerpState(served)?.tradingEnabled).toBe(true);
  expect(parsePerpState({ ...served, trading_enabled: false })?.tradingEnabled).toBe(false);
  // An older markets-service that does not report it cannot vouch for an open market.
  expect(parsePerpState({ ...served, trading_enabled: undefined })?.tradingEnabled).toBe(false);
});

test("refuses partial state rather than rendering a slider against nothing", () => {
  expect(parsePerpState({ ...served, initial_margin_rate: undefined })).toBeNull();
  expect(parsePerpState({ ...served, mark_price_ui: "0" })).toBeNull();
  expect(parsePerpState(undefined)).toBeNull();
});

test("the stack needs every address, and checksums them", () => {
  const stack = parsePerpStack("0x3333333333333333333333333333333333333333", served);
  expect(stack?.tradeModuleAddress).toBe("0x2222222222222222222222222222222222222222");
  expect(parsePerpStack(undefined, served)).toBeNull();
  expect(
    parsePerpStack("0x3333333333333333333333333333333333333333", {
      ...served,
      margin_manager_address: "nope",
    })
  ).toBeNull();
});

test("the leverage ceiling is the SRM's, in whole steps", () => {
  expect(getLeverageCeiling(parsePerpState(served))).toBe(3);
  expect(getLeverageCeiling(parsePerpState({ ...served, max_leverage: "3.0000003" }))).toBe(3);
  expect(getLeverageCeiling(null)).toBe(1);
});

// Maintenance surplus is linear in the USDC-per-cNGN price: C + S(p − p0) − |S|·mm·p, with S the
// signed cNGN position. A 10,000,000 cNGN long at 0.00072 (7,200 USDC) with 1,540 USDC above
// maintenance at entry: C = 1540 + 0.2 × 7200 = 2980, and the surplus reaches zero at
// (7200 − 2980) / (10,000,000 × 0.8) = 0.0005275.
test("a long is liquidated when cNGN weakens, below the entry", () => {
  const liq = estimateLiquidationPrice({
    entryPrice: 0.000_72,
    maintenanceMarginRate: 0.2,
    margin: 1540 + 0.2 * 7200,
    side: "long",
    sizeCngn: 10_000_000,
  });
  expect(liq).toBeCloseTo(0.000_527_5, 12);
  expect(liq).toBeLessThan(0.000_72);
});

test("a short is liquidated when cNGN strengthens, above the entry", () => {
  // (−7200 − 2400) / (−10,000,000 − 2,000,000) = 0.0008.
  const liq = estimateLiquidationPrice({
    entryPrice: 0.000_72,
    maintenanceMarginRate: 0.2,
    margin: 2400,
    side: "short",
    sizeCngn: 10_000_000,
  });
  expect(liq).toBeCloseTo(0.0008, 12);
  expect(liq).toBeGreaterThan(0.000_72);
});

test("at 1x a long never liquidates, and a short liquidates at p0 × 2 / (1 + mm)", () => {
  const notional = 10_000_000 * 0.000_72;
  // A 1x long's equity S·p always exceeds its requirement mm·S·p: no positive price gets there.
  expect(
    estimateLiquidationPrice({
      entryPrice: 0.000_72,
      maintenanceMarginRate: 0.2,
      margin: notional,
      side: "long",
      sizeCngn: 10_000_000,
    })
  ).toBeNull();
  // A 1x short at mm 0.2 is liquidated 67% above entry: 0.00072 × 2 / 1.2.
  expect(
    estimateLiquidationPrice({
      entryPrice: 0.000_72,
      maintenanceMarginRate: 0.2,
      margin: notional,
      side: "short",
      sizeCngn: 10_000_000,
    })
  ).toBeCloseTo((0.000_72 * 2) / 1.2, 12);
});

test("no liquidation price when no positive price reaches it, or the inputs are unusable", () => {
  expect(
    estimateLiquidationPrice({
      entryPrice: 0.000_72,
      maintenanceMarginRate: 0.2,
      margin: 100_000,
      side: "long",
      sizeCngn: 100,
    })
  ).toBeNull();
  expect(
    estimateLiquidationPrice({
      entryPrice: 0.000_72,
      maintenanceMarginRate: 0.2,
      margin: 100,
      side: "long",
      sizeCngn: 0,
    })
  ).toBeNull();
});

test("parses positions and the account's margin, dropping unreadable rows", () => {
  const { account, positions } = parsePositionsResponse({
    accounts: [
      { cash: "5000", initial_margin_surplus: "2600", maintenance_margin_surplus: "3560" },
    ],
    positions: [
      {
        index_price_ui: "0.00072",
        initial_margin_surplus: "2600",
        liquidation_price_ui: "0.0005275",
        maintenance_margin_surplus: "3560",
        mark_price_ui: "0.00072",
        ui_side: "long",
        ui_size: "10000000",
        unrealized_pnl: "-40",
      },
      { ui_side: "sideways", ui_size: "1" },
    ],
  });
  expect(positions).toHaveLength(1);
  expect(positions[0]?.uiSide).toBe("long");
  // Valued at the index when the venue does not value it: 10,000,000 cNGN × 0.00072.
  expect(positions[0]?.notionalUsd).toBeCloseTo(7200, 9);
  expect(account?.initialMarginSurplus).toBe(2600);
  expect(parsePositionsResponse({}).account).toBeNull();
});

test("the venue's own valuation of a position is preferred, and a row without one is dropped", () => {
  const row = {
    initial_margin_surplus: "2600",
    maintenance_margin_surplus: "3560",
    mark_price_ui: "0.00072",
    ui_side: "long",
    ui_size: "10000000",
    unrealized_pnl: "-40",
  };
  const { positions } = parsePositionsResponse({
    positions: [{ ...row, index_price_ui: "0.00072", ui_notional_usdc: "7210.5" }],
  });
  expect(positions[0]?.notionalUsd).toBe(7210.5);
  expect(parsePositionsResponse({ positions: [row] }).positions).toHaveLength(0);
});

test("the positions view shows the venue's side, the cNGN size and its USDC value", () => {
  const view = buildPerpPositionsView(
    [
      {
        engineSize: 1_387_000n,
        initialMarginSurplus: 1,
        liquidationPrice: 0.000_527_5,
        maintenanceMarginSurplus: 1,
        markPrice: 0.000_727_8,
        notionalUsd: 1009.46,
        uiSide: "long",
        uiSize: 1_387_000,
        unrealizedPnl: 1,
      },
      {
        engineSize: 5480n,
        initialMarginSurplus: 1,
        liquidationPrice: null,
        maintenanceMarginSurplus: 1,
        markPrice: 0.000_727_8,
        notionalUsd: 3.99,
        uiSide: "short",
        uiSize: 5480,
        unrealizedPnl: -0.02,
      },
    ],
    "cNGN-PERP"
  );
  expect(view.columns).toBe(PERP_POSITIONS_COLUMNS);
  expect(view.columns).toEqual([
    "Instrument",
    "Side",
    "Size",
    "Value",
    "Mark price",
    "Liq. price",
    "Unrealized PnL",
  ]);
  expect(view.columns).not.toContain("Entry price");
  expect(view.rows[0]?.cells).toEqual([
    "cNGN-PERP",
    "Long",
    "1,387,000 cNGN",
    "1,009.46 USDC",
    "0.0007278",
    "0.0005275",
    "+1.00 USDC",
  ]);
  // The side cell takes the colour of the side, as the button and history rows do.
  expect(view.rows[0]?.tones).toEqual({ 1: "positive" });
  // A short, with no liquidation price the venue could compute.
  expect(view.rows[1]?.cells.slice(1)).toEqual([
    "Short",
    "5,480 cNGN",
    "3.99 USDC",
    "0.0007278",
    "—",
    "-0.02 USDC",
  ]);
  expect(view.rows[1]?.tones).toEqual({ 1: "negative" });
});

test("positions carry the engine's whole-contract size and the account its ledger cash", () => {
  const { account, positions } = parsePositionsResponse({
    accounts: [
      {
        cash: "19.900044338659191148",
        initial_margin_surplus: "19.9",
        maintenance_margin_surplus: "19.9",
      },
    ],
    positions: [
      {
        engine_position: "13590",
        initial_margin_surplus: "16.6",
        liquidation_price_ui: "0.0005445",
        maintenance_margin_surplus: "17.9",
        mark_price_ui: "0.0007359",
        ui_notional_usdc: "10",
        ui_side: "long",
        ui_size: "13590",
        unrealized_pnl: "0.00003",
      },
    ],
  });
  expect(positions).toHaveLength(1);
  // The contract count is what a close must trade, so the account lands on exactly zero.
  expect(positions[0].engineSize).toBe(13590n);
  expect(account?.cashUnits).toBe(19900044338659191148n);
  expect(account?.cash).toBeCloseTo(19.900_044, 6);
});

test("a position the engine reports as zero contracts is dropped", () => {
  const { positions } = parsePositionsResponse({
    positions: [
      {
        engine_position: "0",
        initial_margin_surplus: "1",
        maintenance_margin_surplus: "1",
        mark_price_ui: "0.0007359",
        ui_notional_usdc: "10",
        ui_side: "long",
        ui_size: "13590",
        unrealized_pnl: "0",
      },
    ],
  });
  expect(positions).toHaveLength(0);
});

test("the perp margin withdraws from the CashAsset and pays USDC", () => {
  const asset = getPerpWithdrawableAsset({
    assetAddress: "0xC74EfC8B4808803dBCF439E76Fde076d56625b8E",
    cashAddress: "0xA74E49b4Ed7cb176bc02ef4D8a1A3240C9aD4272",
    collateralAssets: [],
    srmAddress: "0xDE0423D0a1E15536265C9513d2e0c10DAb5835D4",
    tradeModuleAddress: "0xDea968188598BA0E3F58A56C0fdfF338C74F699f",
  });
  expect(asset.escrow).toBe("0xA74E49b4Ed7cb176bc02ef4D8a1A3240C9aD4272");
  expect(asset.symbol).toBe("USDC");
  expect(asset.token.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
});

const servedCollateral = {
  asset_address: "0x6666666666666666666666666666666666666666",
  cap: "25000000",
  deposits_open: true,
  im_scale: "1",
  margin_factor: "0.5",
  symbol: "cNGN",
  total: "2000000",
};

test("the stack carries the collateral assets the venue credits, and none while margin is cash only", () => {
  const cashOnly = parsePerpStack("0x3333333333333333333333333333333333333333", served);
  expect(cashOnly?.collateralAssets).toEqual([]);
  const stack = parsePerpStack("0x3333333333333333333333333333333333333333", {
    ...served,
    collateral_assets: [servedCollateral, { asset_address: "not-an-address", symbol: "cNGN" }],
  });
  expect(stack?.collateralAssets).toHaveLength(1);
  expect(stack?.collateralAssets[0]).toEqual({
    cap: 25_000_000,
    depositsOpen: true,
    escrow: "0x6666666666666666666666666666666666666666",
    imScale: 1,
    marginFactor: 0.5,
    symbol: "cNGN",
    total: 2_000_000,
  });
  // A venue that configured the escrow but has not opened it, or an older one that does not say,
  // reads as closed: the terminal must not offer a deposit that would revert.
  const closed = parsePerpStack("0x3333333333333333333333333333333333333333", {
    ...served,
    collateral_assets: [
      { ...servedCollateral, deposits_open: false },
      { ...servedCollateral, deposits_open: undefined },
    ],
  });
  expect(closed?.collateralAssets.map((asset) => asset.depositsOpen)).toEqual([false, false]);
  const withdrawable = getPerpCollateralWithdrawableAsset(stack.collateralAssets[0]);
  expect(withdrawable?.escrow).toBe("0x6666666666666666666666666666666666666666");
  expect(withdrawable?.symbol).toBe("cNGN");
  expect(withdrawable?.token.toLowerCase()).toBe("0x46c85152bfe9f96829aa94755d9f915f9b10ef5f");
  expect(
    getPerpCollateralWithdrawableAsset({ ...stack.collateralAssets[0], symbol: "XYZ" })
  ).toBeNull();
});

test("the account's collateral is parsed with its ledger units, and the Margin tab shows one row per asset", () => {
  const { account } = parsePositionsResponse({
    positions: [],
    accounts: [
      {
        cash: "100",
        initial_margin_surplus: "820",
        maintenance_margin_surplus: "820",
        collateral: [
          {
            asset_address: "0x6666666666666666666666666666666666666666",
            balance: "2000000.5",
            margin_value_usd: "720",
            symbol: "cNGN",
            value_usd: "1440",
          },
        ],
      },
    ],
  });
  expect(account?.collateral).toHaveLength(1);
  expect(account?.collateral[0].balanceUnits).toBe(2000000500000000000000000n);
  expect(account?.collateral[0].marginValueUsd).toBe(720);
  const view = buildPerpMarginView(account);
  expect(view.columns).toEqual([
    "Asset",
    "Balance",
    "Value",
    "Counts as margin",
    "Initial margin headroom",
    "Maintenance margin headroom",
  ]);
  expect(view.rows).toHaveLength(2);
  expect(view.rows[0].cells.slice(0, 4)).toEqual([
    "USDC",
    "100.00 USDC",
    "100.00 USDC",
    "100.00 USDC (100%)",
  ]);
  expect(view.rows[1].cells.slice(0, 4)).toEqual([
    "cNGN",
    "2,000,000.50 cNGN",
    "1,440.00 USDC",
    "720.00 USDC (50%)",
  ]);
  // Cash-only accounts keep a single row; a venue without collateral serves none.
  expect(buildPerpMarginView({ ...account, collateral: [] }).rows).toHaveLength(1);
  // An asset the venue accepts but the account does not hold is listed at zero, after the held ones.
  const listed = [
    {
      cap: 8_000_000,
      depositsOpen: true,
      escrow: "0x6666666666666666666666666666666666666666",
      imScale: 1,
      marginFactor: 0.5,
      symbol: "cNGN",
      total: 0,
    },
  ];
  expect(buildPerpMarginView(account, listed).rows).toHaveLength(2);
  const empty = buildPerpMarginView({ ...account, collateral: [] }, listed);
  expect(empty.rows).toHaveLength(2);
  expect(empty.rows[1].cells.slice(0, 4)).toEqual(["cNGN", "0.00 cNGN", "0.00 USDC", "0.00 USDC (50%)"]);
  // The ticket's sources line: cash, each collateral asset, and what positions already use.
  expect(describePerpMarginSources(account)).toBe(
    "100.00 USDC cash + 2,000,000.50 cNGN (worth 1,440.00 USDC, counts as 720.00 USDC)"
  );
  expect(describePerpMarginSources({ ...account, initialMarginSurplus: 700 })).toBe(
    "100.00 USDC cash + 2,000,000.50 cNGN (worth 1,440.00 USDC, counts as 720.00 USDC) − 120.00 USDC backing your positions"
  );
  expect(describePerpMarginSources({ ...account, collateral: [], initialMarginSurplus: 100 })).toBe("100.00 USDC cash");
  expect(describePerpMarginSources(null)).toBeNull();
});

test("the guardian's pause is parsed and the venue's refusal reads as 'Trading paused'", () => {
  const state = parsePerpState({ ...served, paused: true, trading_enabled: false });
  expect(state?.paused).toBe(true);
  expect(state?.tradingEnabled).toBe(false);
  expect(parsePerpState(served)?.paused).toBe(false);
  expect(
    describeOrderRejection("trading_paused: the venue has paused USDCcNGN-PERP; ...", "failed")
  ).toBe(TRADING_PAUSED_MESSAGE);
  expect(describeOrderRejection("insufficient margin", "failed")).toBe("insufficient margin");
  expect(describeOrderRejection(null, "failed")).toBe("failed");
});

test("the perp header reads mark, index, the day's move, volume, open interest, hourly funding and its APR", () => {
  const state = parsePerpState(served);
  const metrics = buildPerpHeaderMetrics({
    firstPrice: 0.000_73,
    price: 0.000_731_2,
    state,
    volumeLabel: "10 USDC",
  });
  expect(metrics.map((m) => m.label)).toEqual([
    "Mark",
    "Index",
    "24h Change",
    "24h Volume",
    "Open Interest",
    "1h Funding",
    "APR",
  ]);
  const byLabel = Object.fromEntries(metrics.map((m) => [m.label, m]));
  expect(byLabel.Mark.value).toBe("0.0007200");
  expect(byLabel.Index.value).toBe("0.0007200");
  // Measured from the window's first trade to the live price, as a move and a percentage.
  expect(byLabel["24h Change"].value).toBe("+0.0000012 (+0.16%)");
  expect(byLabel["24h Change"].tone).toBe("up");
  expect(byLabel["24h Volume"].value).toBe("10 USDC");
  expect(byLabel["Open Interest"].value).toBe("7.2K USDC");
  // Longs (long cNGN) receive when the rate is negative, so it reads as a fall. The annualised
  // figure is the hourly rate times the hours in a year, uncompounded: -0.00125% × 8760 is
  // -10.95%, which prints at one decimal as -10.9% (the float sits just under the half).
  expect(byLabel["1h Funding"].value).toBe("-0.0013%");
  expect(byLabel["1h Funding"].tone).toBe("down");
  expect(byLabel["1h Funding"].tooltip).toContain("longs (long cNGN) pay");
  expect(byLabel.APR.value).toBe("-10.9%");
  expect(byLabel.APR.tone).toBe("down");
});

test("the perp header shows dashes, not guesses, before the chain state or the window is known", () => {
  const metrics = buildPerpHeaderMetrics({ firstPrice: null, price: 0.000_731_2, state: null, volumeLabel: "—" });
  const byLabel = Object.fromEntries(metrics.map((m) => [m.label, m]));
  for (const label of ["Mark", "Index", "24h Change", "24h Volume", "Open Interest", "1h Funding", "APR"]) {
    expect(byLabel[label].value).toBe("—");
    expect(byLabel[label].tone).toBeNull();
  }
});

test("the submit button's wording and the side the order is sent with agree", () => {
  // Long selected: the button reads "Long … cNGN", and the order goes out as a buy of cNGN. A flip
  // in either mapping alone would place a live order the wrong way.
  expect(perpSubmitLabel("long", 1000)).toBe("Long 1,000 cNGN");
  expect(perpOrderUiSide("long")).toBe("buy");
  expect(perpSubmitLabel("short", 1234.5)).toBe("Short 1,234.5 cNGN");
  expect(perpOrderUiSide("short")).toBe("sell");
  expect(perpSubmitLabel("long", null)).toBe("Long cNGN");
  // The position row names the side with the same word the button leads with.
  expect(perpSideLabel("long")).toBe("Long");
  expect(perpSideLabel("short")).toBe("Short");
});
