import { expect, test } from "bun:test";
import { buildFutureOrderEnvelope, TAKER_FEE_RATE } from "./future-order-submission.ts";

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

  // markets-service rejects the whole order when a non-spot instrument carries either field:
  // "order_entry_spec and ui_intent are only supported for the spot usdc/cngn contract".
  // Sending them made every futures submission fail, so their absence is the contract here.
  expect(envelope.payload.ui_intent).toBeUndefined();
  expect(envelope.payload.order_entry_spec).toBeUndefined();
  expect(envelope.payload.side).toBe("buy");
  expect(envelope.payload.limit_price).toBe("0.5");
  expect(envelope.payload.desired_amount).toBe("0.000001");
});

test("pins the futures taker tier at 15 bps", () => {
  // Anchors the rate itself. The UI fee quote and the signed worstFee both derive from this
  // constant, so changing it moves real money — update this line deliberately, not to go green.
  expect(TAKER_FEE_RATE).toBe("0.0015");
});

test("signs the taker fee tier as worstFee scaled to one engine contract", () => {
  const envelope = buildFutureOrderEnvelope({
    limitPrice: "1545",
    market: liveFutureMarket,
    side: "sell",
    size: "10000",
    subaccountId: "10",
    walletAddress: "0x0e7cc357a7f546a07aeb3dbe56a8ab893d4c9c9e",
  });

  // 15 bps taker tier on a 10,000 USDC contract = 15 USDC per contract.
  expect(envelope.payload.worst_fee).toBe("15");
});

test("worstFee tolerates zero-fee fills from the current backend", () => {
  const envelope = buildFutureOrderEnvelope({
    limitPrice: "1545",
    market: { ...liveFutureMarket, contractMultiplier: "1" },
    side: "buy",
    size: "1",
    subaccountId: "10",
    walletAddress: "0x0e7cc357a7f546a07aeb3dbe56a8ab893d4c9c9e",
  });

  // A 1 USDC contract makes worstFee-per-contract equal to the tier itself.
  expect(Number(envelope.payload.worst_fee)).toBeGreaterThan(0);
  expect(envelope.payload.worst_fee).toBe(TAKER_FEE_RATE);
});
