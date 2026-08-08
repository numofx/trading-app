import { expect, test } from "bun:test";
import {
  applyBookDelta,
  applyBookSnapshot,
  buildBookSide,
  presentStreamTrade,
} from "./market-stream.ts";

const SPOT = { type: "spot" };
const FUTURE = { type: "future" };

/**
 * Captured from a live `book` snapshot for USDCcNGN-SPOT. The engine rests inverted — it trades
 * WRAPPED_CNGN against internal USDC cash — so every order's engine `side` is the opposite of the
 * `ui_intent.side` the server computes.
 */
const SPOT_SNAPSHOT = {
  bids: [
    {
      order_id: "b1",
      side: "buy",
      limit_price: "0.000726602454709323",
      desired_amount: "1651",
      filled_amount: "0",
      spot_contract: { ui_intent: { side: "sell", price: "1376.268403", size: "1.199621" } },
    },
    {
      order_id: "b2",
      side: "buy",
      limit_price: "0.0007255152168827",
      desired_amount: "1984",
      filled_amount: "0",
      spot_contract: { ui_intent: { side: "sell", price: "1378.330842", size: "1.439422" } },
    },
  ],
  asks: [
    {
      order_id: "a1",
      side: "sell",
      limit_price: "0.000728057184244482",
      desired_amount: "1648",
      filled_amount: "0",
      spot_contract: { ui_intent: { side: "buy", price: "1373.518484", size: "1.199838" } },
    },
    {
      order_id: "a2",
      side: "sell",
      limit_price: "0.000729152059815877",
      desired_amount: "1974",
      filled_amount: "0",
      spot_contract: { ui_intent: { side: "buy", price: "1371.456045", size: "1.439346" } },
    },
  ],
};

// The bug: the stream stored the engine side next to the UI-translated price, so UI-sell orders
// were filed into the bid ladder. Best bid came out above best ask, useMarketOrderBook flagged the
// book crossed, and the spot panel fell back to the page-load snapshot — every session, silently.
test("a spot snapshot builds an uncrossed book", () => {
  const state = applyBookSnapshot(SPOT_SNAPSHOT, SPOT);

  const bids = buildBookSide(state, "bid");
  const asks = buildBookSide(state, "ask");

  expect(bids[0].price).toBe(1373.52);
  expect(asks[0].price).toBe(1376.27);
  expect(asks[0].price).toBeGreaterThan(bids[0].price);
});

test("a futures snapshot files orders on the engine side unchanged", () => {
  const state = applyBookSnapshot(
    {
      bids: [
        { order_id: "f1", side: "buy", limit_price: "1376", desired_amount: "5", filled_amount: "0" },
      ],
      asks: [
        { order_id: "f2", side: "sell", limit_price: "1380", desired_amount: "7", filled_amount: "0" },
      ],
    },
    FUTURE
  );

  expect(buildBookSide(state, "bid")[0].price).toBe(1376);
  expect(buildBookSide(state, "ask")[0].price).toBe(1380);
});

test("a spot order with no ui_intent is still inverted onto the UI side", () => {
  const state = applyBookSnapshot(
    {
      bids: [
        {
          order_id: "b1",
          side: "buy",
          limit_price: "0.000726602454709323",
          desired_amount: "1651",
          filled_amount: "0",
        },
      ],
    },
    SPOT
  );

  // An engine BUY of cNGN is a UI SELL of USDC, so it belongs in the ask ladder at 1/price.
  expect(buildBookSide(state, "bid")).toHaveLength(0);
  expect(buildBookSide(state, "ask")[0].price).toBe(1376.27);
});

// `book` update frames carry no `spot_contract`, so the delta path cannot read a server-computed
// side and has to invert arithmetically.
test("a spot delta files the order on the UI side", () => {
  const state = new Map();

  applyBookDelta(
    state,
    {
      order_id: "d1",
      side: "buy",
      limit_price: "0.000726602454709323",
      order_open: "1651",
      size_delta: "0",
    },
    SPOT
  );

  expect(buildBookSide(state, "bid")).toHaveLength(0);
  expect(buildBookSide(state, "ask")[0].price).toBe(1376.27);
});

test("a futures delta keeps the engine side", () => {
  const state = new Map();

  applyBookDelta(
    state,
    { order_id: "d2", side: "buy", limit_price: "1376", order_open: "5", size_delta: "0" },
    FUTURE
  );

  expect(buildBookSide(state, "bid")[0].price).toBe(1376);
  expect(buildBookSide(state, "ask")).toHaveLength(0);
});

test("a spot trade reports the UI side, not the engine aggressor", () => {
  const trade = presentStreamTrade(
    { trade_id: 1, price: "0.000727673387861142", size: "1380", aggressor_side: "sell" },
    SPOT
  );

  expect(trade.side).toBe("buy");
  expect(trade.price).toBeCloseTo(1374.242_918, 5);
});

test("a futures trade reports the aggressor side unchanged", () => {
  const trade = presentStreamTrade(
    { trade_id: 2, price: "1376", size: "5", aggressor_side: "sell" },
    FUTURE
  );

  expect(trade.side).toBe("sell");
  expect(trade.size).toBe(5);
});

// Spot sizes are fractional USDC notional; the futures contract rounding turned this real 0.073
// USDC print into "0 USDC".
test("a fractional spot trade size survives presentation", () => {
  const trade = presentStreamTrade(
    { trade_id: 3, price: "0.000728804362533444", size: "100", aggressor_side: "buy" },
    SPOT
  );

  expect(trade.size).toBe(0.073);
  expect(trade.side).toBe("sell");
});
