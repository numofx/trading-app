import { expect, test } from "bun:test";
import { decodeAbiParameters } from "viem";
import {
  estimateOptionOrder,
  optionBreakeven,
  optionLimitError,
  optionMarketLimit,
  optionOrderUnits,
  optionPriceString,
  optionTradingBlock,
  optionWorstFeeUnits,
} from "./option-order.ts";
import { buildSpotOrderEnvelope } from "./spot-order-submission.ts";

const ROW = {
  ask: 0.000_034,
  bid: 0.000_029,
  lastTradeAtMs: 2000,
  optionType: "put",
  strike: 0.000_72,
  strikeLabel: "0.00072",
  tradingOpen: true,
};
const ESTIMATE = {
  cash: 100,
  position: 0,
  price: 0.000_034,
  restingSells: 0,
  side: "buy",
  size: 100_000,
  surplus: 100,
  takerFeeBps: 15,
  unitBase: 1000,
};

test("a market order's limit keeps a premium's precision, through the touch by the slippage", () => {
  expect(optionMarketLimit(ROW, "buy", 0.02)).toBeCloseTo(0.000_034_68, 12);
  expect(optionMarketLimit(ROW, "sell", 0.02)).toBeCloseTo(0.000_028_42, 12);
  expect(optionMarketLimit({ ask: null, bid: null }, "buy", 0.02)).toBeNull();
  expect(optionPriceString(0.000_034_68)).toBe("0.000034680000");
});

test("the fee ceiling is 20 bps of the most the order can fill at, per base unit", () => {
  // 15 bps + 5 on a 0.00003468 limit: 6.936e-8 USDC per cNGN, 18 decimals.
  const buy = optionWorstFeeUnits({
    bestBid: 0.000_029,
    limit: 0.000_034_68,
    side: "buy",
    takerFeeBps: 15,
  });
  expect(Number(buy)).toBeCloseTo(6.936e10, -3);
  // A sell with a low limit crosses the higher bid: the fee is charged on that.
  const sell = optionWorstFeeUnits({
    bestBid: 0.000_029,
    limit: 0.000_001,
    side: "sell",
    takerFeeBps: 15,
  });
  const charged = 0.000_029 * 0.0015 * 1e18;
  expect(Number(sell)).toBeGreaterThan(charged);
});

test("sizes are whole venue units", () => {
  expect(optionOrderUnits(100_000, 1000)).toBe(100);
  expect(optionOrderUnits(1500, 1000)).toBeNull();
  expect(optionOrderUnits(0, 1000)).toBeNull();
  expect(optionOrderUnits(1000, null)).toBeNull();
});

test("the envelope signs units x 1e21 of the strike's series, at the ceiling it was given", () => {
  const worstFeeUnits = 69_360_000_000n;
  const envelope = buildSpotOrderEnvelope({
    expiry: 1_796_043_600,
    side: "buy",
    subaccountId: "44",
    uiPrice: optionPriceString(0.000_034_68),
    uiSize: "100",
    walletAddress: "0x971Cd37fa58e4D5f6cd5FB3B7fE7DAAF735F2e9c",
    market: {
      amountScale: 10n ** 21n,
      assetAddress: "0xa6a05dC25127CecbC048C7e6CBE35e1c8e503821",
      orderIdPrefix: "option",
      subId: "309239441359200",
      tradeModuleAddress: "0xdea968188598ba0e3f58a56c0fdff338c74f699f",
      worstFeeUnits,
    },
  });
  const [action] = decodeAbiParameters(
    [
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
    ],
    envelope.actionJson.data
  );
  expect(action.desiredAmount).toBe(100n * 10n ** 21n);
  expect(action.subId).toBe(309_239_441_359_200n);
  expect(action.limitPrice).toBe(34_680_000_000_000n);
  expect(action.worstFee).toBe(worstFeeUnits);
  expect(action.isBid).toBe(true);
  expect(envelope.payload.desired_amount).toBe("100");
  expect(envelope.payload.sub_id).toBe("309239441359200");
  expect(envelope.payload.order_id.startsWith("option-")).toBe(true);
});

test("a buy costs premium plus fee, and is short by what cash or margin lacks", () => {
  const estimate = estimateOptionOrder(ESTIMATE);
  expect(estimate.premium).toBeCloseTo(3.4, 9);
  expect(estimate.fee).toBeCloseTo(0.0051, 9);
  expect(estimate.total).toBeCloseTo(3.4051, 9);
  expect(estimate.shortfall).toBe(0);
  expect(estimate.positionAfter).toBe(100_000);
  expect(estimate.maxSize).toBe(2_936_000);
  const short = estimateOptionOrder({ ...ESTIMATE, cash: 3, surplus: 100 });
  expect(short.shortfall).toBeCloseTo(0.4051, 9);
  expect(estimateOptionOrder({ ...ESTIMATE, cash: 100, surplus: 1 }).shortfall).toBeCloseTo(
    2.4051,
    9
  );
});

test("a sell can only close: never past the position less what already rests to sell it", () => {
  const sell = { ...ESTIMATE, position: 10_000, side: "sell" };
  expect(estimateOptionOrder({ ...sell, size: 10_000 }).oversold).toBe(false);
  expect(estimateOptionOrder({ ...sell, size: 11_000 }).oversold).toBe(true);
  expect(estimateOptionOrder({ ...sell, restingSells: 4000, size: 7000 }).oversold).toBe(true);
  expect(estimateOptionOrder({ ...sell, restingSells: 4000, size: 6000 }).maxSize).toBe(6000);
  expect(estimateOptionOrder({ ...sell, position: 0, size: 1000 }).oversold).toBe(true);
  expect(estimateOptionOrder({ ...sell, position: -5000, size: 1000 }).closable).toBe(0);
  // Proceeds, not a cost: the fee comes off, and it never reads as short of margin.
  const closing = estimateOptionOrder({
    ...sell,
    cash: 0,
    price: 0.000_029,
    size: 10_000,
    surplus: 0,
  });
  expect(closing.total).toBeCloseTo(0.289_565, 9);
  expect(closing.shortfall).toBe(0);
});

test("what is unknown stays unknown", () => {
  const estimate = estimateOptionOrder({ ...ESTIMATE, cash: null, price: null, size: null });
  expect(estimate.maxSize).toBeNull();
  expect(estimate.total).toBeNull();
  expect(estimate.shortfall).toBe(0);
});

test("breakeven, limit bounds and trading blocks", () => {
  expect(optionBreakeven(ROW, 0.000_03)).toBeCloseTo(0.000_69, 10);
  expect(optionBreakeven({ ...ROW, optionType: "call" }, 0.000_03)).toBeCloseTo(0.000_75, 10);
  expect(optionLimitError(ROW, 0.0008)).toMatch("at most its strike");
  expect(optionLimitError(ROW, 0.0007)).toBeNull();
  expect(optionLimitError({ ...ROW, optionType: "call" }, 0.0008)).toBeNull();
  expect(optionTradingBlock(ROW, 1000)).toBeNull();
  expect(optionTradingBlock(ROW, 2000)).toMatch("last trade");
  expect(optionTradingBlock({ ...ROW, tradingOpen: false }, 1000)).toMatch("not matching");
});
