import { expect, test } from "bun:test";
import { buildSpotOrderEnvelope } from "./spot-order-submission.ts";

const liveSpotMarket = {
  assetAddress: "0xe4b6e05b9910ab08a947a20faecc4524bf8a7f7e",
  contractLabel: null,
  contractMultiplier: "1",
  contractType: "spot",
  expiryDays: null,
  expiryLabel: null,
  expiryTimestamp: null,
  flagSrc: "/flags/ng.svg",
  id: "cngn-usdc-spot",
  marketSymbol: "USDCcNGN-SPOT",
  minSize: "0.000001",
  pair: "USDCcNGN",
  region: "Africa",
  settlementType: "spot",
  sortOrder: 0,
  strikeLabel: null,
  subId: "0",
  tickSize: "0.000000000000000001",
  type: "spot",
};

test("normalizes leading-decimal spot inputs", () => {
  const envelope = buildSpotOrderEnvelope({
    limitPrice: ".5",
    market: liveSpotMarket,
    side: "buy",
    size: ".01",
    subaccountId: "10",
    walletAddress: "0x0e7cc357a7f546a07aeb3dbe56a8ab893d4c9c9e",
  });

  expect(envelope.payload.ui_intent.price).toBe("0.5");
  expect(envelope.payload.ui_intent.size).toBe("0.01");
});
