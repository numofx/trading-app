import { expect, test } from "bun:test";
import { decodeAbiParameters } from "viem";
import {
  buildSpotOrderEnvelope,
  getNonceSignedAtMs,
  SPOT_ORDER_LIFETIME_LABEL,
  SPOT_ORDER_LIFETIME_SECONDS,
  SPOT_TAKER_FEE_RATE,
} from "./spot-order-submission.ts";

const WALLET = "0x3448ac0A3283951A2AFD5B3A582329ECA43CB47B";
const SPOT_ASSET = "0x9d806fd040a719d27a8e5e77dc5ae0ed1e089493";

const TUPLE = [
  {
    type: "tuple",
    components: [
      { name: "asset", type: "address" },
      { name: "subId", type: "uint256" },
      { name: "limitPrice", type: "int256" },
      { name: "desiredAmount", type: "int256" },
      { name: "worstFee", type: "uint256" },
      { name: "recipientId", type: "uint256" },
      { name: "isBid", type: "bool" },
    ],
  },
];

function decode(data) {
  return decodeAbiParameters(TUPLE, data)[0];
}

test("pins the spot taker tier at 5 bps", () => {
  // Anchors the rate itself; the UI fee quote and the signed worstFee both derive from it.
  expect(SPOT_TAKER_FEE_RATE).toBe("0.0005");
});

test("UI sell inverts to engine buy (deliver USDC, acquire cNGN)", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "11",
    uiPrice: "1370",
    uiSize: "4",
    walletAddress: WALLET,
  });
  // engine side is the inverse of the UI side
  expect(env.payload.side).toBe("buy");
  const action = decode(env.payload.action_json.data);
  expect(action.isBid).toBe(true);
  // engineAmount = floor(4 * 1370) = 5480 whole cNGN
  expect(env.payload.desired_amount).toBe("5480");
  expect(action.desiredAmount).toBe(5480n * 10n ** 18n);
  // enginePrice = 1/1370, signed as 1e18 fixed point (half-up)
  const expectedPriceWei = (10n ** 36n + 685n) / 1370n; // round(1e18/1370 * 1e18)/... check magnitude below
  expect(action.limitPrice > 0n).toBe(true);
  // body limit_price must equal signed limitPrice / 1e18
  const bodyWei = BigInt(
    env.payload.limit_price
      .replace(".", "")
      .padEnd(env.payload.limit_price.split(".")[1]?.length ? 0 : 0, "0")
  );
  expect(action.asset.toLowerCase()).toBe(SPOT_ASSET);
  expect(action.subId).toBe(0n);
  // worstFee bounds the fee per filled cNGN: SPOT_TAKER_FEE_RATE / uiPrice, in 1e18 units,
  // so charging it on every cNGN totals the tier against the USDC notional.
  const feeWei = BigInt(Math.round(Number(SPOT_TAKER_FEE_RATE) * 1e18));
  expect(action.worstFee).toBe((feeWei + 1370n / 2n) / 1370n);
  // sanity: 5480 cNGN / (1/1370) ≈ 4 USDC round trip
  const usdc = (Number(action.desiredAmount) / 1e18) * (Number(action.limitPrice) / 1e18);
  expect(Math.abs(usdc - 4)).toBeLessThan(0.01);
});

test("UI buy inverts to engine sell", () => {
  const env = buildSpotOrderEnvelope({
    side: "buy",
    subaccountId: "11",
    uiPrice: "1373.42",
    uiSize: "3",
    walletAddress: WALLET,
  });
  expect(env.payload.side).toBe("sell");
  const action = decode(env.payload.action_json.data);
  expect(action.isBid).toBe(false);
  // floor(3 * 1373.42) = floor(4120.26) = 4120
  expect(env.payload.desired_amount).toBe("4120");
});

test("body limit_price matches signed limitPrice / 1e18", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "11",
    uiPrice: "1370",
    uiSize: "4",
    walletAddress: WALLET,
  });
  const action = decode(env.payload.action_json.data);
  const [intPart, fracPart = ""] = env.payload.limit_price.split(".");
  const bodyWei = BigInt(intPart) * 10n ** 18n + BigInt((fracPart + "0".repeat(18)).slice(0, 18));
  expect(bodyWei).toBe(action.limitPrice);
});

test("rejects orders below 1 whole cNGN", () => {
  expect(() =>
    buildSpotOrderEnvelope({
      side: "sell",
      subaccountId: "11",
      uiPrice: "0.5",
      uiSize: "1",
      walletAddress: WALLET,
    })
  ).toThrow(/at least 1 cNGN/);
});

test("EIP-712 domain uses the app chain and matching contract", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "11",
    uiPrice: "1370",
    uiSize: "4",
    walletAddress: WALLET,
  });
  expect(env.typedData.domain.name).toBe("Matching");
  expect(env.typedData.domain.chainId).toBe(84_532); // no env in test → sepolia default
  expect(env.typedData.message.subaccountId).toBe(11n);
});

/*
 * The ticket tells the trader when the order expires, so the label and the signed expiry must
 * agree. They drifting apart is invisible until an order the UI called good for five minutes
 * disappears at some other time — which is exactly how this surfaced: an order rested as the best
 * bid and vanished five minutes later with nothing on screen having mentioned a lifetime.
 */
test("the signed expiry matches the lifetime the ticket advertises", () => {
  const before = Math.floor(Date.now() / 1000);
  const env = buildSpotOrderEnvelope({
    side: "buy",
    subaccountId: "11",
    uiPrice: "1374.60",
    uiSize: "1",
    walletAddress: WALLET,
  });
  const after = Math.floor(Date.now() / 1000);

  expect(env.payload.expiry).toBeGreaterThanOrEqual(before + SPOT_ORDER_LIFETIME_SECONDS);
  expect(env.payload.expiry).toBeLessThanOrEqual(after + SPOT_ORDER_LIFETIME_SECONDS);
  // The signed action carries the same deadline the body does.
  expect(Number(env.typedData.message.expiry)).toBe(env.payload.expiry);
});

test("the advertised lifetime is stated in minutes", () => {
  expect(SPOT_ORDER_LIFETIME_SECONDS).toBe(300);
  expect(SPOT_ORDER_LIFETIME_LABEL).toBe("5 minutes");
});

/*
 * `(owner_address, nonce)` is what `POST /v1/orders/cancel` takes, so a nonce is an order's
 * identity and not merely replay protection. `BigInt(Date.now())` gave every order signed in the
 * same millisecond the same identity — invisible to a human clicking the ticket, routine for a
 * quoting loop replacing both sides across several levels, and it makes the colliding orders
 * impossible to cancel independently rather than just prone to rejection.
 *
 * The millisecond-bucket assertion is what keeps this honest: without it the test would pass
 * against the old scheme on any machine slow enough to spend a millisecond per envelope.
 */
test("orders signed in the same millisecond get distinct nonces", () => {
  const nonces = [];
  for (let index = 0; index < 200; index += 1) {
    const env = buildSpotOrderEnvelope({
      side: "buy",
      subaccountId: "11",
      uiPrice: "1374.60",
      uiSize: "1",
      walletAddress: WALLET,
    });
    nonces.push(BigInt(env.payload.nonce));
  }

  // The clock lives in the high bits, so this is the value the old scheme would have produced.
  const millisecondBuckets = new Set(nonces.map((nonce) => getNonceSignedAtMs(nonce)));
  expect(millisecondBuckets.size).toBeLessThan(nonces.length);
  expect(new Set(nonces).size).toBe(nonces.length);
});

/*
 * The nonce is a public identity that crosses markets-service JSON, the WS feed and telemetry, and
 * markets-service emits integers unquoted (`last_trade_timestamp`, `PresentedOrder.expiry`). Past
 * 2^53 an unquoted hop rounds the low bits off, so the order submits under one identity and rests
 * under another — and `(owner_address, nonce)` is the cancel key, so it could never be cancelled.
 * This parses the nonce as a bare JSON number, which is the hop that would do it.
 */
test("the nonce survives a JSON-number hop unrounded", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "11",
    uiPrice: "1374.60",
    uiSize: "1",
    walletAddress: WALLET,
  });

  const throughJsonNumber = JSON.parse(`{"nonce":${env.payload.nonce}}`).nonce;
  expect(String(throughJsonNumber)).toBe(env.payload.nonce);
  expect(Number.isSafeInteger(throughJsonNumber)).toBe(true);
});

test("the signed nonce, the body and the action all carry one identity", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "11",
    uiPrice: "1374.60",
    uiSize: "1",
    walletAddress: WALLET,
  });

  // The cancel key has to match what was signed and what the book will publish.
  expect(env.typedData.message.nonce).toBe(BigInt(env.payload.nonce));
  expect(env.payload.action_json.nonce).toBe(env.payload.nonce);
});

/*
 * Uniqueness comes from a counter, not from entropy, so this is a hard guarantee rather than a
 * probability — worth pinning, because the room under 2^53 is only 4096 nonces per millisecond.
 */
test("nonces are strictly increasing", () => {
  const nonces = [];
  for (let index = 0; index < 50; index += 1) {
    const env = buildSpotOrderEnvelope({
      side: "buy",
      subaccountId: "11",
      uiPrice: "1374.60",
      uiSize: "1",
      walletAddress: WALLET,
    });
    nonces.push(BigInt(env.payload.nonce));
  }

  for (let index = 1; index < nonces.length; index += 1) {
    expect(nonces[index] > nonces[index - 1]).toBe(true);
  }
});

/*
 * The old scheme let you read an order's signing time straight off its nonce, on the book and in
 * the `server_order_cancel_received` telemetry. Keeping the clock in the high bits preserves that.
 */
test("the nonce still carries the signing time", () => {
  const before = Date.now();
  const env = buildSpotOrderEnvelope({
    side: "buy",
    subaccountId: "11",
    uiPrice: "1374.60",
    uiSize: "1",
    walletAddress: WALLET,
  });
  const after = Date.now();

  const signedAtMs = getNonceSignedAtMs(env.payload.nonce);
  expect(signedAtMs).toBeGreaterThanOrEqual(before);
  expect(signedAtMs).toBeLessThanOrEqual(after);
});
