import { expect, test } from "bun:test";
import { decodeAbiParameters } from "viem";
import { buildSpotOrderEnvelope, SPOT_TAKER_FEE_RATE } from "./spot-order-submission.ts";

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
    uiPrice: "1370",
    uiSize: "4",
    subaccountId: "11",
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
  const bodyWei = BigInt(env.payload.limit_price.replace(".", "").padEnd(env.payload.limit_price.split(".")[1]?.length ? 0 : 0, "0"));
  expect(action.asset.toLowerCase()).toBe(SPOT_ASSET);
  expect(action.subId).toBe(0n);
  // worstFee bounds the fee per filled cNGN: SPOT_TAKER_FEE_RATE / uiPrice, in 1e18 units,
  // so charging it on every cNGN totals the tier against the USDC notional.
  const feeWei = BigInt(Math.round(Number(SPOT_TAKER_FEE_RATE) * 1e18));
  expect(action.worstFee).toBe((feeWei + 1370n / 2n) / 1370n);
  // sanity: 5480 cNGN / (1/1370) ≈ 4 USDC round trip
  const usdc = Number(action.desiredAmount) / 1e18 * (Number(action.limitPrice) / 1e18);
  expect(Math.abs(usdc - 4)).toBeLessThan(0.01);
});

test("UI buy inverts to engine sell", () => {
  const env = buildSpotOrderEnvelope({
    side: "buy",
    uiPrice: "1373.42",
    uiSize: "3",
    subaccountId: "11",
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
    uiPrice: "1370",
    uiSize: "4",
    subaccountId: "11",
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
      uiPrice: "0.5",
      uiSize: "1",
      subaccountId: "11",
      walletAddress: WALLET,
    }),
  ).toThrow(/at least 1 cNGN/);
});

test("EIP-712 domain uses the app chain and matching contract", () => {
  const env = buildSpotOrderEnvelope({
    side: "sell",
    uiPrice: "1370",
    uiSize: "4",
    subaccountId: "11",
    walletAddress: WALLET,
  });
  expect(env.typedData.domain.name).toBe("Matching");
  expect(env.typedData.domain.chainId).toBe(84532); // no env in test → sepolia default
  expect(env.typedData.message.subaccountId).toBe(11n);
});
