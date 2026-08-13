import { expect, test } from "bun:test";
import {
  buildSpotMarket,
  collectOpenOrders,
  getAnchorPrice,
  getBestPrices,
  getCrossingPrice,
  getMaxOrderSize,
} from "./spot-market.ts";

/**
 * The engine rests spot inverted (USDC per cNGN, cNGN amounts) and carries the trader-facing
 * values in `spot_contract.ui_intent`, so an engine BID is a UI ask and vice versa.
 */
const SPOT_BOOK = {
  market_presentation: { order_entry_spec: "usdc_cngn_spot_v1" },
  asks: [
    {
      desired_amount: "1651",
      limit_price: "0.000726602454709323",
      order_id: "a1",
      spot_contract: { ui_intent: { price: "1376.27", side: "sell", size: "1.2" } },
    },
  ],
  bids: [
    {
      desired_amount: "1000",
      limit_price: "0.000728104362533444",
      order_id: "b1",
      spot_contract: { ui_intent: { price: "1373.52", side: "buy", size: "0.4" } },
    },
  ],
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
        aggressor_side: "buy",
        created_at: "2026-08-12T10:12:00Z",
        price: "0.000728",
        size: "100",
        spot_contract: { ui_intent: { price: "1374.24", side: "sell", size: "0.073" } },
      },
    ],
  });

  expect(market.mark).toBe(1374.24);
  expect(market.trades[0].size).toBe(0.073);
});

// --- price sources shared by the ladder, the ticket and order submission ---

test("the anchor is the mid, so a prefill cannot cross either side", () => {
  const anchor = getAnchorPrice(1371.36, 1368.62, 1374.24);

  expect(anchor).toBeCloseTo(1369.99, 2);
  // Strictly inside the spread: a buy at this price rests below the ask, a sell above the bid.
  expect(anchor).toBeLessThan(1371.36);
  expect(anchor).toBeGreaterThan(1368.62);
});

// The production defect: a fill from four days earlier sat ₦2.88 above the best ask, and the
// ticket seeded its limit price with it — a "Limit" buy that crossed the moment it was submitted.
test("a stale last trade never outranks a live book", () => {
  expect(getAnchorPrice(1371.36, 1368.62, 1374.24)).not.toBe(1374.24);
  // One-sided book: the resting side still beats the stale trade.
  expect(getAnchorPrice(1371.36, null, 1374.24)).toBe(1371.36);
  expect(getAnchorPrice(null, 1368.62, 1374.24)).toBe(1368.62);
  // Only with no book at all does the last trade stand in.
  expect(getAnchorPrice(null, null, 1374.24)).toBe(1374.24);
  expect(getAnchorPrice(null, null, null)).toBeNull();
});

test("a market order crosses the opposing touch", () => {
  expect(getCrossingPrice("buy", 1371.36, 1368.62)).toBe(1371.36);
  expect(getCrossingPrice("sell", 1371.36, 1368.62)).toBe(1368.62);
});

// Null is what makes the ticket say "No opposing spot liquidity to cross" instead of submitting
// a market order with an empty price.
test("an empty opposing side yields no crossing price", () => {
  expect(getCrossingPrice("buy", null, 1368.62)).toBeNull();
  expect(getCrossingPrice("sell", 1371.36, null)).toBeNull();
});

test("best prices are read off the top of each ladder", () => {
  const { bestAsk, bestBid } = getBestPrices(
    [
      { price: 1371.36, size: 1.2, total: 1.2 },
      { price: 1373.41, size: 1.439, total: 2.639 },
    ],
    [
      { price: 1368.62, size: 1.2, total: 1.2 },
      { price: 1366.56, size: 1.439, total: 2.639 },
    ]
  );

  expect(bestAsk).toBe(1371.36);
  expect(bestBid).toBe(1368.62);
  expect(getBestPrices([], [])).toEqual({ bestAsk: null, bestBid: null });
});

// The ticket's size slider is a share of what the trading account can fund, so this is the ceiling
// it slides against. A wrong answer here oversizes an order the account cannot pay for.
test("a sell is capped by the USDC balance it spends", () => {
  expect(
    getMaxOrderSize({ availableCngn: 1_000_000, availableUsdc: 12.5, isBuy: false, price: 1370 })
  ).toBe(12.5);
});

test("a buy is capped by the cNGN balance converted at the order price", () => {
  expect(
    getMaxOrderSize({ availableCngn: 137_000, availableUsdc: 0, isBuy: true, price: 1370 })
  ).toBe(100);
});

test("no ceiling without a balance or a usable price", () => {
  expect(
    getMaxOrderSize({ availableCngn: null, availableUsdc: null, isBuy: true, price: 1370 })
  ).toBeNull();
  expect(
    getMaxOrderSize({ availableCngn: 137_000, availableUsdc: null, isBuy: true, price: null })
  ).toBeNull();
  // A zero or negative price would divide into an infinite ceiling.
  expect(
    getMaxOrderSize({ availableCngn: 137_000, availableUsdc: null, isBuy: true, price: 0 })
  ).toBeNull();
  expect(
    getMaxOrderSize({ availableCngn: null, availableUsdc: null, isBuy: false, price: 1370 })
  ).toBeNull();
});

// --- open orders, the rows behind the Open Orders tab and its cancel control ---

const OWNER = "0x3448ac0A3283951A2AFD5B3A582329ECA43CB47B";

test("resting orders keep the identity a cancel needs", () => {
  const orders = collectOpenOrders({
    bids: [],
    asks: [
      {
        desired_amount: "1374",
        filled_amount: "0",
        limit_price: "0.000727",
        nonce: "1755080858277",
        order_id: "spot-1",
        owner_address: OWNER,
        spot_contract: { ui_intent: { price: "1374.60", side: "buy", size: "1" } },
      },
    ],
  });

  expect(orders).toHaveLength(1);
  // markets-service cancels by (owner_address, nonce), so both must survive the mapping.
  expect(orders[0].ownerAddress).toBe(OWNER);
  expect(orders[0].nonce).toBe("1755080858277");
  expect(orders[0].side).toBe("buy");
  expect(orders[0].price).toBe(1374.6);
});

// A row with no owner or nonce cannot be cancelled, and the only reason to list it is to act on it.
test("orders that cannot be cancelled are not listed", () => {
  const orders = collectOpenOrders({
    asks: [{ desired_amount: "1374", filled_amount: "0", limit_price: "0.000727", order_id: "x" }],
    bids: [
      {
        desired_amount: "1",
        filled_amount: "0",
        limit_price: "0.000727",
        order_id: "y",
        owner_address: OWNER,
      },
    ],
  });

  expect(orders).toEqual([]);
});

test("a market with no book has no open orders", () => {
  expect(buildSpotMarket(null).openOrders).toEqual([]);
});
