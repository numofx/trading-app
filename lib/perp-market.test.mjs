import { expect, test } from "bun:test";
import {
  estimateLiquidationPrice,
  getLeverageCeiling,
  parsePerpStack,
  parsePerpState,
  parsePositionsResponse,
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
  expect(parsePerpStack("0x3333333333333333333333333333333333333333", { ...served, margin_manager_address: "nope" })).toBeNull();
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
    estimateLiquidationPrice({ entryPrice: 1400, maintenanceMarginRate: 0.2, margin: 100_000, side: "short", sizeUsd: 100 })
  ).toBeNull();
});

test("parses positions and the account's margin, dropping unreadable rows", () => {
  const { account, positions } = parsePositionsResponse({
    accounts: [{ cash: "5000", initial_margin_surplus: "2600", maintenance_margin_surplus: "3560" }],
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
  expect(view.rows[0]?.cells).toEqual(["USDC-cNGN-PERP", "Long", "7,200.00 USDC", "₦1,388.89", "₦1,178.78", "-40.00 USDC"]);
});
