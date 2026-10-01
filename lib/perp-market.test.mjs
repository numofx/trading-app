import { expect, test } from "bun:test";
import {
  describeOrderRejection,
  estimateLiquidationPrice,
  getPerpWithdrawableAsset,
  getLeverageCeiling,
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
  expect(account?.cash).toBeCloseTo(19.900044, 6);
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
    srmAddress: "0xDE0423D0a1E15536265C9513d2e0c10DAb5835D4",
    tradeModuleAddress: "0xDea968188598BA0E3F58A56C0fdfF338C74F699f",
  });
  expect(asset.escrow).toBe("0xA74E49b4Ed7cb176bc02ef4D8a1A3240C9aD4272");
  expect(asset.symbol).toBe("USDC");
  expect(asset.token.toLowerCase()).toBe("0x833589fcd6edb6e08f4c7c32d4f71b54bda02913");
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
