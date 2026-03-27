import { expect, test } from "bun:test";
import { selectLiveUSDCCNGNSpotMarket } from "./spot-market-discovery.ts";

test("selects the documented spot market shape when symbol fields are omitted", () => {
  const market = selectLiveUSDCCNGNSpotMarket([
    {
      asset_address: "0x752803d72c1835cdcd300C7fDE6c7D7d2F12E679",
      contract_type: "spot",
      market: "USDC/cNGN",
      settlement_type: "spot",
      sub_id: "0",
    },
  ]);

  expect(market?.asset_address).toBe("0x752803d72c1835cdcd300C7fDE6c7D7d2F12E679");
  expect(market?.sub_id).toBe("0");
});

test("prefers the exact USDC/cNGN match when multiple spot markets are present", () => {
  const market = selectLiveUSDCCNGNSpotMarket([
    {
      asset_address: "0x1111111111111111111111111111111111111111",
      contract_type: "spot",
      settlement_type: "spot",
      sub_id: "0",
    },
    {
      asset_address: "0x752803d72c1835cdcd300C7fDE6c7D7d2F12E679",
      base_asset_symbol: "USDC",
      contract_type: "spot",
      quote_asset_symbol: "cNGN",
      settlement_type: "spot",
      sub_id: "0",
    },
  ]);

  expect(market?.asset_address).toBe("0x752803d72c1835cdcd300C7fDE6c7D7d2F12E679");
});

test("does not guess when several unmatched spot markets are present", () => {
  const market = selectLiveUSDCCNGNSpotMarket([
    {
      asset_address: "0x1111111111111111111111111111111111111111",
      contract_type: "spot",
      settlement_type: "spot",
      sub_id: "0",
    },
    {
      asset_address: "0x2222222222222222222222222222222222222222",
      contract_type: "spot",
      settlement_type: "spot",
      sub_id: "1",
    },
  ]);

  expect(market).toBeNull();
});
