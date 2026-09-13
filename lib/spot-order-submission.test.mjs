import { expect, test } from "bun:test";
import { decodeAbiParameters } from "viem";
import {
  buildCancelEnvelope,
  buildSpotOrderEnvelope,
  CANCEL_SIGNATURE_LIFETIME_SECONDS,
  getNonceSignedAtMs,
  SPOT_ORDER_LIFETIME_LABEL,
  SPOT_ORDER_LIFETIME_SECONDS,
  SPOT_TAKER_FEE_RATE,
} from "./spot-order-submission.ts";

const WALLET = "0x3448ac0A3283951A2AFD5B3A582329ECA43CB47B";
const SPOT_ASSET = "0x9d806fd040a719d27a8e5e77dc5ae0ed1e089493";
const AT_LEAST_ONE_CNGN = /at least 1 cNGN/;
const PAST_THE_LIMIT = /past the limit/;

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

test("pins the signed worstFee ceiling at 30 bps, above the 25 bps venue schedule", () => {
  /*
   * This is the ceiling the order is signed with, not the charge. The charge comes from
   * /v1/markets and is displayed from there; this number only has to cover it.
   *
   * It must stay strictly above the venue's taker schedule. TradeModule reverts TM_FeeTooHigh
   * when the per-unit fee exceeds worstFee, and an order signed at exactly the schedule reverts
   * the moment the schedule moves up by a single basis point — with orders already resting under
   * the old ceiling, which is the one migration this repo cannot do atomically with the service.
   */
  expect(SPOT_TAKER_FEE_RATE).toBe("0.0030");
  expect(Number(SPOT_TAKER_FEE_RATE) * 10_000).toBeGreaterThan(25);
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
  // enginePrice = 1/1370, signed as 1e18 fixed point; the body and signature agreeing on it is
  // pinned by "body limit_price matches signed limitPrice / 1e18" below.
  expect(action.limitPrice > 0n).toBe(true);
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
  ).toThrow(AT_LEAST_ONE_CNGN);
});

/**
 * Trade #341's order, rebuilt. Signed through an ask of 1339.479393 with 0.5% room, it was sized at
 * that limit and spent 1,346 cNGN for 1.0049 USDC. Sized at the expected fill it spends 1,339.
 */
test("a market buy is sized at its expected fill while its limit keeps the slippage room", () => {
  const order = { side: "buy", subaccountId: "19", uiPrice: "1346.176790", uiSize: "1" };
  const sizedAtLimit = buildSpotOrderEnvelope({ ...order, walletAddress: WALLET });
  const sizedAtFill = buildSpotOrderEnvelope({
    ...order,
    uiSizingPrice: "1339.479393",
    walletAddress: WALLET,
  });

  expect(sizedAtLimit.payload.desired_amount).toBe("1346");
  expect(sizedAtFill.payload.desired_amount).toBe("1339");

  // Only the amount moves: the signed limit and fee bound still carry the full room.
  const atLimit = decode(sizedAtLimit.payload.action_json.data);
  const atFill = decode(sizedAtFill.payload.action_json.data);
  expect(atFill.limitPrice).toBe(atLimit.limitPrice);
  expect(atFill.worstFee).toBe(atLimit.worstFee);
});

/** The mirror image: sized at a limit below the bid, a market sell bought too little cNGN. */
test("a market sell is sized at its expected fill, so it delivers the USDC asked for", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "19",
    uiPrice: "1330.124058",
    uiSize: "2",
    uiSizingPrice: "1336.808099",
    walletAddress: WALLET,
  });

  // floor(2 × 1336.808099) = 2673 cNGN, ≈ 2 USDC at the bid — not floor(2 × 1330.12) = 2660.
  expect(env.payload.desired_amount).toBe("2673");
});

test("a sizing price past the limit is refused, on either side", () => {
  const order = { subaccountId: "19", uiSize: "1", walletAddress: WALLET };

  expect(() =>
    buildSpotOrderEnvelope({ ...order, side: "buy", uiPrice: "1346", uiSizingPrice: "1350" })
  ).toThrow(PAST_THE_LIMIT);
  expect(() =>
    buildSpotOrderEnvelope({ ...order, side: "sell", uiPrice: "1330", uiSizingPrice: "1320" })
  ).toThrow(PAST_THE_LIMIT);
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
  expect(env.typedData.domain.chainId).toBe(8453); // no env in test → Base mainnet default
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

test("a signed order rests for a full day, and the ticket says so", () => {
  // Lengthened from five minutes once cancellation existed: the ticket copy and the signed expiry
  // both derive from this, so a drift would tell the trader one lifetime while signing another.
  expect(SPOT_ORDER_LIFETIME_SECONDS).toBe(86_400);
  expect(SPOT_ORDER_LIFETIME_LABEL).toBe("24 hours");
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
 * Past 2^53 a JSON-number hop rounds the low bits off, so the order submits under one identity and
 * rests under another — and `(owner_address, nonce)` is the cancel key, so it could never be
 * cancelled. This parses the nonce as a bare JSON number, which is the hop that would do it.
 *
 * markets-service does quote `nonce` today (verified against `/v1/book` on 2026-08-17), so this
 * guards a hop nothing currently takes. It stays because the quoting is inconsistent field by
 * field — `expiry` comes back bare at the order level and quoted inside `action_json` in the same
 * response — so nothing makes `nonce` staying quoted a property this repo can rely on.
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

/*
 * A cancel is authorized by a signature over Cancel(owner, signer, nonce, expiry), not by the
 * public (owner, nonce) pair alone. The typed data must match what markets-service rebuilds: the
 * Matching domain, the four fields in order, and an expiry that agrees between the signed message
 * and the body — markets-service reads the body expiry, so a mismatch would verify a different
 * digest than it received.
 */
test("buildCancelEnvelope signs Cancel over the Matching domain", () => {
  const before = Math.floor(Date.now() / 1000);
  const env = buildCancelEnvelope({
    nonce: "7319532056794814",
    ownerAddress: WALLET,
    signerAddress: WALLET,
  });
  const after = Math.floor(Date.now() / 1000);

  // Body carries the identity markets-service cancels on, plus the signature material.
  expect(env.payload.nonce).toBe("7319532056794814");
  expect(env.payload.owner_address).toBe(WALLET);
  expect(env.payload.signer_address).toBe(WALLET);

  // Typed data mirrors the server's Cancel typehash, field-for-field and in order.
  expect(env.typedData.primaryType).toBe("Cancel");
  expect(env.typedData.types.Cancel.map((f) => `${f.type} ${f.name}`)).toEqual([
    "address owner",
    "address signer",
    "uint256 nonce",
    "uint256 expiry",
  ]);
  expect(env.typedData.domain.name).toBe("Matching");
  expect(env.typedData.domain.version).toBe("1.0");
  expect(env.typedData.domain.chainId).toBe(8453); // Base mainnet default in test

  // The signed nonce is the order's, as a bigint.
  expect(env.typedData.message.nonce).toBe(7_319_532_056_794_814n);

  // The signed expiry and the body expiry are the same value — markets-service verifies the body's.
  expect(env.typedData.message.expiry.toString()).toBe(env.payload.expiry);
  const expiry = Number(env.payload.expiry);
  expect(expiry).toBeGreaterThanOrEqual(before + CANCEL_SIGNATURE_LIFETIME_SECONDS);
  expect(expiry).toBeLessThanOrEqual(after + CANCEL_SIGNATURE_LIFETIME_SECONDS);
});

test("the cancel replay window is a short two minutes", () => {
  expect(CANCEL_SIGNATURE_LIFETIME_SECONDS).toBe(120);
});
