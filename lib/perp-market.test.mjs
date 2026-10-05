import { expect, test } from "bun:test";
import {
  buildPerpCngnExposure,
  buildPerpMarginView,
  describePerpMarginSources,
  describeOrderRejection,
  estimateLiquidationPrice,
  getLeverageCeiling,
  getPerpCollateralWithdrawableAsset,
  getPerpWithdrawableAsset,
  parsePerpStack,
  parsePerpState,
  parsePositionsResponse,
  TRADING_PAUSED_MESSAGE,
} from "./perp-market.ts";

const served = {
  funding_interval_seconds: 3600,
  index_price_ui: "1388.888889",
  initial_margin_rate: "0.33333",
  maintenance_margin_rate: "0.2",
  margin_manager_address: "0x5555555555555555555555555555555555555555",
  mark_price_ui: "1388.888889",
  max_leverage: "3",
  open_interest_usd: "7200",
  quote_asset_address: "0x4444444444444444444444444444444444444444",
  trade_module_address: "0x2222222222222222222222222222222222222222",
  trading_enabled: true,
  ui_long_funding_rate_1h: "-0.0000125",
};

test("parses the perp's chain state as the venue serves it", () => {
  const state = parsePerpState(served);
  expect(state?.markPrice).toBeCloseTo(1388.888_889, 6);
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

// Matches markets-service's liquidationPrice for the same position (perp_state_test.go):
// a $7,200 UI long at 1388.89 cNGN/USDC with $1,540 above maintenance is liquidated at ~1178.78.
test("a venue long is liquidated when USD weakens, below the entry", () => {
  const entry = 1 / 0.000_72;
  // Margin C such that the MM surplus at entry is 1540: C - 0.2 * 7200 = 1540.
  const liq = estimateLiquidationPrice({
    entryPrice: entry,
    maintenanceMarginRate: 0.2,
    margin: 1540 + 0.2 * 7200,
    side: "long",
    sizeUsd: 7200,
  });
  expect(liq).toBeCloseTo(1178.781_925, 4);
});

test("a venue short is liquidated when USD strengthens, above the entry", () => {
  const liq = estimateLiquidationPrice({
    entryPrice: 1400,
    maintenanceMarginRate: 0.2,
    margin: 2400,
    side: "short",
    sizeUsd: 7200,
  });
  expect(liq).not.toBeNull();
  expect(liq).toBeGreaterThan(1400);
});

test("no liquidation price when no positive price reaches it", () => {
  expect(
    estimateLiquidationPrice({
      entryPrice: 1400,
      maintenanceMarginRate: 0.2,
      margin: 100_000,
      side: "short",
      sizeUsd: 100,
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
        initial_margin_surplus: "2600",
        liquidation_price_ui: "1178.781925",
        maintenance_margin_surplus: "3560",
        mark_price_ui: "1388.888889",
        ui_side: "long",
        ui_size: "7200",
        unrealized_pnl: "-40",
      },
      { ui_side: "sideways", ui_size: "1" },
    ],
  });
  expect(positions).toHaveLength(1);
  expect(positions[0]?.uiSide).toBe("long");
  expect(account?.initialMarginSurplus).toBe(2600);
  expect(parsePositionsResponse({}).account).toBeNull();
});

test("the positions view shows the venue's side and no invented entry price", async () => {
  const { buildPerpPositionsView } = await import("./perp-market.ts");
  const view = buildPerpPositionsView(
    [
      {
        initialMarginSurplus: 1,
        liquidationPrice: 1178.78,
        maintenanceMarginSurplus: 1,
        markPrice: 1388.89,
        uiSide: "long",
        uiSize: 7200,
        unrealizedPnl: -40,
      },
    ],
    "USDC-cNGN-PERP"
  );
  expect(view.columns).not.toContain("Entry price");
  expect(view.rows[0]?.cells).toEqual([
    "USDC-cNGN-PERP",
    "Long",
    "7,200.00 USDC",
    "₦1,388.89",
    "₦1,178.78",
    "-40.00 USDC",
  ]);
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
        engine_position: "-13590",
        initial_margin_surplus: "16.6",
        liquidation_price_ui: "544.5",
        maintenance_margin_surplus: "17.9",
        mark_price_ui: "1358.99",
        ui_side: "long",
        ui_size: "10",
        unrealized_pnl: "0.00003",
      },
    ],
  });
  expect(positions).toHaveLength(1);
  // A venue long is short the on-chain cNGN perp: the magnitude is what a close must trade.
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
        mark_price_ui: "1358.99",
        ui_side: "long",
        ui_size: "10",
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

test("cNGN exposure: what the cNGN offsets, what is exposed to the naira, and the funding on the offset", () => {
  const state = parsePerpState(served);
  const account = {
    cash: 0,
    cashUnits: 0n,
    initialMarginSurplus: 700,
    maintenanceMarginSurplus: 700,
    collateral: [
      {
        balance: 2_000_000,
        balanceUnits: 2_000_000n * 10n ** 18n,
        escrow: "0x6666666666666666666666666666666666666666",
        marginValueUsd: 720,
        symbol: "cNGN",
        valueUsd: 1440,
      },
    ],
  };
  const position = (uiSide, uiSize) => ({
    engineSize: 694_444n,
    initialMarginSurplus: 1,
    liquidationPrice: null,
    maintenanceMarginSurplus: 1,
    markPrice: 1388.89,
    uiSide,
    uiSize,
    unrealizedPnl: 0,
  });
  // Long USD under the collateral's value: all of it is offset, the rest of the cNGN stays long naira.
  const partial = buildPerpCngnExposure(account, [position("long", 500)], state);
  expect(partial?.collateralCngn).toBe(2_000_000);
  expect(partial?.collateralUsd).toBe(1440);
  expect(partial?.longUsd).toBe(500);
  expect(partial?.offsetUsd).toBe(500);
  expect(partial?.nairaExposureUsd).toBe(940);
  // The venue's long receives when the rate is negative: -0.0000125/h on the $500 offset is -$0.15/day.
  expect(partial?.fundingPerDayUsd).toBeCloseTo(-0.15, 6);
  expect(partial?.fundingPerMonthUsd).toBeCloseTo(-4.5, 6);
  // Long USD past the collateral: the offset caps at the collateral and the account is net short the naira.
  const over = buildPerpCngnExposure(account, [position("long", 2000)], state);
  expect(over?.offsetUsd).toBe(1440);
  expect(over?.nairaExposureUsd).toBe(-560);
  // Long naira on cNGN doubles up: nothing is offset and the exposure is collateral plus position.
  const doubled = buildPerpCngnExposure(account, [position("short", 300)], state);
  expect(doubled?.offsetUsd).toBe(0);
  expect(doubled?.longNairaUsd).toBe(300);
  expect(doubled?.nairaExposureUsd).toBe(1740);
  expect(doubled?.fundingPerDayUsd).toBeCloseTo(0, 9);
  expect(buildPerpCngnExposure({ ...account, collateral: [] }, [position("long", 500)], state)).toBeNull();
  expect(buildPerpCngnExposure(null, [], state)).toBeNull();
});
