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
const SPOT_ASSET = "0x37c976bb5d4887a714ef19af6b83e34fe2f37c98";
const AT_LEAST_ONE_CNGN = /at least 1 cNGN/;
const INTEGER_WEI = /^\d+$/;

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

test("a sell is sent as the engine's sell of cNGN, at its price and size", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "11",
    uiPrice: "0.00073",
    uiSize: "5480",
    walletAddress: WALLET,
  });
  // The side on screen is the side on the wire.
  expect(env.payload.side).toBe("sell");
  const action = decode(env.payload.action_json.data);
  expect(action.isBid).toBe(false);
  // 5480 whole cNGN, as typed.
  expect(env.payload.desired_amount).toBe("5480");
  expect(action.desiredAmount).toBe(5480n * 10n ** 18n);
  // The price as typed, as 18-decimal fixed point in the signature and as a decimal in the body.
  expect(action.limitPrice).toBe(730_000_000_000_000n);
  expect(env.payload.limit_price).toBe("0.00073");
  expect(action.asset.toLowerCase()).toBe(SPOT_ASSET);
  expect(action.subId).toBe(0n);
  // worstFee bounds the fee per filled cNGN: SPOT_TAKER_FEE_RATE × uiPrice, in 1e18 units,
  // so charging it on every cNGN totals the tier against the USDC that changes hands.
  expect(action.worstFee).toBe(2_190_000_000_000n);
  // sanity: 5480 cNGN at 0.00073 is about 4 USDC.
  const usdc = (Number(action.desiredAmount) / 1e18) * (Number(action.limitPrice) / 1e18);
  expect(Math.abs(usdc - 4)).toBeLessThan(0.01);
});

test("a buy is sent as the engine's buy, floored to whole cNGN", () => {
  const env = buildSpotOrderEnvelope({
    side: "buy",
    subaccountId: "11",
    uiPrice: "0.000728",
    uiSize: "4120.26",
    walletAddress: WALLET,
  });
  expect(env.payload.side).toBe("buy");
  const action = decode(env.payload.action_json.data);
  expect(action.isBid).toBe(true);
  // The engine rests whole cNGN: floor(4120.26) = 4120
  expect(env.payload.desired_amount).toBe("4120");
});

test("body limit_price matches signed limitPrice / 1e18", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "11",
    uiPrice: "0.000742843228",
    uiSize: "1346",
    walletAddress: WALLET,
  });
  const action = decode(env.payload.action_json.data);
  const [intPart, fracPart = ""] = env.payload.limit_price.split(".");
  const bodyWei = BigInt(intPart) * 10n ** 18n + BigInt((fracPart + "0".repeat(18)).slice(0, 18));
  expect(bodyWei).toBe(action.limitPrice);
});

/**
 * numofx/exchange#52: the body carried `0.000002244148383091` while the market maker sent
 * `2239667734729`. The matcher parses worst_fee as a base-10 integer and skipped its fee-ceiling
 * check on anything else. The body must be the signed per-unit bound itself, in wei.
 */
test("the body's worst_fee is the signed worstFee, as integer wei", () => {
  for (const order of [
    { side: "buy", uiPrice: "0.000742843228", uiSize: "1346" },
    { side: "sell", uiPrice: "0.00073", uiSize: "5480" },
  ]) {
    const env = buildSpotOrderEnvelope({ ...order, subaccountId: "19", walletAddress: WALLET });
    const action = decode(env.payload.action_json.data);

    expect(env.payload.worst_fee).toMatch(INTEGER_WEI);
    expect(env.payload.worst_fee).toBe(action.worstFee.toString());
  }
});

test("rejects orders below 1 whole cNGN", () => {
  expect(() =>
    buildSpotOrderEnvelope({
      side: "sell",
      subaccountId: "11",
      uiPrice: "0.00073",
      uiSize: "0.5",
      walletAddress: WALLET,
    })
  ).toThrow(AT_LEAST_ONE_CNGN);
});

test("EIP-712 domain uses the app chain and matching contract", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    subaccountId: "11",
    uiPrice: "0.00073",
    uiSize: "5480",
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
    uiPrice: "0.0007275",
    uiSize: "1370",
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
      uiPrice: "0.0007275",
      uiSize: "1370",
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
    uiPrice: "0.0007275",
    uiSize: "1370",
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
    uiPrice: "0.0007275",
    uiSize: "1370",
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
      uiPrice: "0.0007275",
      uiSize: "1370",
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
    uiPrice: "0.0007275",
    uiSize: "1370",
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

// The perp takes the same order shape as spot but signs for its own module and asset:
// markets-service rejects an order naming another market's module, and one signed for spot's
// would settle in the wrong cash.
test("a perp order signs for the perp's module and asset, in the same terms as spot", () => {
  const perp = {
    assetAddress: "0x3333333333333333333333333333333333333333",
    orderIdPrefix: "perp",
    tradeModuleAddress: "0x2222222222222222222222222222222222222222",
  };
  const envelope = buildSpotOrderEnvelope({
    market: perp,
    side: "buy",
    subaccountId: "42",
    uiPrice: "0.000714",
    uiSize: "140000",
    walletAddress: "0x3448ac0a3283951a2afd5b3a582329eca43cb47b",
  });
  expect(envelope.actionJson.module).toBe(perp.tradeModuleAddress);
  expect(envelope.typedData.message.module).toBe(perp.tradeModuleAddress);
  expect(envelope.payload.asset_address).toBe(perp.assetAddress);
  expect(envelope.payload.order_id.startsWith("perp-")).toBe(true);
  // A long of 140,000 cNGN at 0.000714 USDC per cNGN is an engine BUY of 140,000 cNGN.
  expect(envelope.payload.side).toBe("buy");
  expect(envelope.payload.desired_amount).toBe("140000");
});

test("spot orders are unchanged when no market override is given", () => {
  const envelope = buildSpotOrderEnvelope({
    side: "buy",
    subaccountId: "42",
    uiPrice: "0.000714",
    uiSize: "140000",
    walletAddress: "0x3448ac0a3283951a2afd5b3a582329eca43cb47b",
  });
  expect(envelope.payload.order_id.startsWith("spot-")).toBe(true);
  expect(envelope.payload.asset_address.toLowerCase()).toBe(SPOT_ASSET);
});

test("engineAmountWhole sizes the order in cNGN contracts directly, for an exact close", () => {
  // A perp position of 13590 contracts is closed by signing exactly that count, whatever the
  // ticket's size field holds, so the account lands on zero rather than a contract short or long.
  const env = buildSpotOrderEnvelope({
    engineAmountWhole: 13590n,
    side: "sell",
    subaccountId: "25",
    uiPrice: "0.0007377",
    uiSize: "13589.4",
    walletAddress: WALLET,
  });
  expect(env.payload.desired_amount).toBe("13590");
  expect(decode(env.payload.action_json.data).desiredAmount).toBe(13590n * 10n ** 18n);
});
