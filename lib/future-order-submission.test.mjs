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

/**
 * Same instrument at a 1:1 contract multiplier, so a leading-decimal size still lands on the
 * venue's 0.001 amount step. At the 10,000 multiplier every sub-1 size divides to less than the
 * step and would be rejected on submission.
 */
const unitMultiplierMarket = { ...liveFutureMarket, contractMultiplier: "1" };

const BELOW_MIN_SIZE_MESSAGE = /at least 0\.001 contracts/;
const OFF_STEP_MESSAGE = /multiple of 0\.001 contracts/;

test("normalizes leading-decimal futures inputs", () => {
  const envelope = buildFutureOrderEnvelope({
    limitPrice: ".5",
    market: unitMultiplierMarket,
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
  expect(envelope.payload.desired_amount).toBe("0.01");
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

// The venue rejects a misaligned desired_amount with
// "desired_amount must align to amount step 0.001" — but only after the trader has signed.
// A real attempt of .0001 contracts (1 USDC notional) failed exactly this way.
test("rejects a size below the venue's amount step before signing", () => {
  expect(() =>
    buildFutureOrderEnvelope({
      limitPrice: "1376",
      market: liveFutureMarket,
      side: "buy",
      // .0001 contracts, expressed as the USDC notional the terminal passes in.
      size: "1",
      subaccountId: "10",
      walletAddress: "0x0e7cc357a7f546a07aeb3dbe56a8ab893d4c9c9e",
    })
  ).toThrow(BELOW_MIN_SIZE_MESSAGE);
});

test("rejects a size that is not a whole multiple of the amount step", () => {
  expect(() =>
    buildFutureOrderEnvelope({
      limitPrice: "1376",
      market: liveFutureMarket,
      side: "buy",
      // 0.0015 contracts: above the minimum, still off-step.
      size: "15",
      subaccountId: "10",
      walletAddress: "0x0e7cc357a7f546a07aeb3dbe56a8ab893d4c9c9e",
    })
  ).toThrow(OFF_STEP_MESSAGE);
});

test("accepts a size on the amount step", () => {
  const envelope = buildFutureOrderEnvelope({
    limitPrice: "1376",
    market: liveFutureMarket,
    side: "buy",
    // 0.001 contracts = 10 USDC notional, the smallest valid order.
    size: "10",
    subaccountId: "10",
    walletAddress: "0x0e7cc357a7f546a07aeb3dbe56a8ab893d4c9c9e",
  });

  expect(envelope.payload.desired_amount).toBe("0.001");
});
