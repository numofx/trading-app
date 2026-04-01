import { expect, test } from "bun:test";
import { buildFutureOrderEnvelope } from "./future-order-submission.ts";

const liveFutureMarket = {
  assetAddress: "0x752803d72c1835cdcd300c7fde6c7d7d2f12e679",
  contractLabel: "APR 2026",
  contractMultiplier: "10000",
  contractType: "deliverable_fx_future",
  expiryDays: 30,
  expiryLabel: "Apr 2026",
  expiryTimestamp: 1_777_507_200,
  flagSrc: "/flags/ng.svg",
  id: "usdc-cngn-apr-2026",
  marketSymbol: "USDCcNGN-APR30-2026",
  minSize: "0.001",
  pair: "USDCcNGN",
  region: "Africa",
  settlementType: "physical_delivery",
  sortOrder: 1_777_507_200,
  strikeLabel: null,
  subId: "1777507200",
  tickSize: "1",
  type: "future",
};

test("normalizes leading-decimal futures inputs", () => {
  const envelope = buildFutureOrderEnvelope({
    limitPrice: ".5",
    market: liveFutureMarket,
    side: "buy",
    size: ".01",
    subaccountId: "10",
    walletAddress: "0x0e7cc357a7f546a07aeb3dbe56a8ab893d4c9c9e",
  });

  expect(envelope.payload.ui_intent.price).toBe("0.5");
  expect(envelope.payload.ui_intent.size).toBe("0.01");
  expect(envelope.payload.side).toBe("buy");
  expect(envelope.payload.limit_price).toBe("0.5");
  expect(envelope.payload.desired_amount).toBe("0.000001");
});
