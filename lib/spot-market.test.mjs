import { expect, test } from "bun:test";
import { buildSpotMarket } from "./spot-market.ts";

/**
 * The engine rests spot inverted (USDC per cNGN, cNGN amounts) and carries the trader-facing
 * values in `spot_contract.ui_intent`, so an engine BID is a UI ask and vice versa.
 */
const SPOT_BOOK = {
  asks: [
    {
      order_id: "a1",
      limit_price: "0.000726602454709323",
      desired_amount: "1651",
      spot_contract: { ui_intent: { side: "sell", price: "1376.27", size: "1.2" } },
    },
  ],
  bids: [
    {
      order_id: "b1",
      limit_price: "0.000728104362533444",
      desired_amount: "1000",
      spot_contract: { ui_intent: { side: "buy", price: "1373.52", size: "0.4" } },
    },
  ],
  market_presentation: { order_entry_spec: "usdc_cngn_spot_v1" },
};

test("a venue that served nothing renders empty, never sample depth", () => {
  const market = buildSpotMarket(null);

  expect(market.orderBookAsks).toEqual([]);
  expect(market.orderBookBids).toEqual([]);
  expect(market.trades).toEqual([]);
  expect(market.candles).toEqual([]);
  // Null, not a placeholder price: the panels show "—" rather than a number nothing can fill at.
  expect(market.mark).toBeNull();
});

test("an empty book with no trades still yields no mark", () => {
  const market = buildSpotMarket({ book: { asks: [], bids: [] }, trades: [] });

  expect(market.mark).toBeNull();
  expect(market.orderBookAsks).toEqual([]);
  expect(market.orderBookBids).toEqual([]);
});

test("engine sides are flipped into UI orientation", () => {
  const market = buildSpotMarket({ book: SPOT_BOOK, trades: [] });

  // The engine's bids rest as the UI's asks.
  expect(market.orderBookAsks[0].price).toBe(1373.52);
  expect(market.orderBookBids[0].price).toBe(1376.27);
  expect(market.orderEntrySpec).toBe("usdc_cngn_spot_v1");
});

// A 0.4 USDC order is real resting depth; whole-unit rounding displayed it as "0".
test("sub-unit spot depth survives the ladder", () => {
  const market = buildSpotMarket({ book: SPOT_BOOK, trades: [] });

  expect(market.orderBookAsks[0].size).toBe(0.4);
  expect(market.orderBookAsks[0].total).toBe(0.4);
});

test("mark is the mid of the two UI sides", () => {
  const market = buildSpotMarket({ book: SPOT_BOOK, trades: [] });

  expect(market.mark).toBeCloseTo((1373.52 + 1376.27) / 2, 5);
});

test("with only trades, the last trade is the mark", () => {
  const market = buildSpotMarket({
    book: { asks: [], bids: [] },
    trades: [
      {
        price: "0.000728",
        size: "100",
        aggressor_side: "buy",
        created_at: "2026-08-12T10:12:00Z",
        spot_contract: { ui_intent: { side: "sell", price: "1374.24", size: "0.073" } },
      },
    ],
  });

  expect(market.mark).toBe(1374.24);
  expect(market.trades[0].size).toBe(0.073);
});
