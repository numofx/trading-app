import { expect, test } from "bun:test";
import {
  applyBookDelta,
  applyBookSnapshot,
  buildBookSide,
  presentStreamTrade,
} from "./market-stream.ts";

/**
 * Captured from a live `book` snapshot for USDCcNGN-SPOT. The engine rests cNGN bids and asks at
 * USDC per cNGN, which is exactly the orientation the terminal shows: an engine `side` is the
 * ladder it is filed into, and `spot_contract.ui_intent` repeats the same values.
 */
const SPOT_SNAPSHOT = {
  bids: [
    {
      order_id: "b1",
      side: "buy",
      limit_price: "0.000726602454709323",
      desired_amount: "1651",
      filled_amount: "0",
      spot_contract: { ui_intent: { side: "buy", price: "0.000726602454709323", size: "1651" } },
    },
    {
      order_id: "b2",
      side: "buy",
      limit_price: "0.0007255152168827",
      desired_amount: "1984",
      filled_amount: "0",
      spot_contract: { ui_intent: { side: "buy", price: "0.0007255152168827", size: "1984" } },
    },
  ],
  asks: [
    {
      order_id: "a1",
      side: "sell",
      limit_price: "0.000728057184244482",
      desired_amount: "1648",
      filled_amount: "0",
      spot_contract: { ui_intent: { side: "sell", price: "0.000728057184244482", size: "1648" } },
    },
    {
      order_id: "a2",
      side: "sell",
      limit_price: "0.000729152059815877",
      desired_amount: "1974",
      filled_amount: "0",
      spot_contract: { ui_intent: { side: "sell", price: "0.000729152059815877", size: "1974" } },
    },
  ],
};

// A crossed book is what useMarketOrderBook treats as a dead stream: best bid above best ask makes
// the spot panel fall back to the page-load snapshot, silently, for the whole session.
test("a spot snapshot builds an uncrossed book", () => {
  const state = applyBookSnapshot(SPOT_SNAPSHOT);

  const bids = buildBookSide(state, "bid");
  const asks = buildBookSide(state, "ask");

  expect(bids[0].price).toBe(0.000_726_6);
  expect(asks[0].price).toBe(0.000_728_1);
  expect(asks[0].price).toBeGreaterThan(bids[0].price);
  expect(bids.map((level) => level.size)).toEqual([1651, 1984]);
  expect(asks.map((level) => level.size)).toEqual([1648, 1974]);
});

// A snapshot order's resting size is what it has left, not what it asked for: a 1651 cNGN order
// with 300 filled rests 1351.
test("a snapshot order rests its unfilled remainder", () => {
  const state = applyBookSnapshot({
    bids: [
      {
        order_id: "p1",
        side: "buy",
        limit_price: "0.000726602454709323",
        desired_amount: "1651",
        filled_amount: "300",
      },
    ],
  });

  expect(buildBookSide(state, "bid")[0].size).toBe(1351);
});

// A partly filled order's remainder can be fractional, and 0.4 cNGN is real resting liquidity.
// Whole-unit rounding in the ladder builder rendered it as size 0 next to a live price.
test("sub-unit spot depth survives the stream ladder", () => {
  const state = applyBookSnapshot({
    bids: [
      {
        order_id: "s1",
        side: "buy",
        limit_price: "0.000726602454709323",
        desired_amount: "1651",
        filled_amount: "1650.6",
      },
    ],
  });

  const bids = buildBookSide(state, "bid");
  expect(bids[0].size).toBe(0.4);
  expect(bids[0].total).toBe(0.4);
});

// The ladder shows seven decimals, so two orders that differ only past that collapse into one level.
test("orders at the same displayed price aggregate into one level", () => {
  const state = applyBookSnapshot({
    asks: [
      { order_id: "a1", side: "sell", limit_price: "0.00072661", desired_amount: "1000", filled_amount: "0" },
      { order_id: "a2", side: "sell", limit_price: "0.000726602454709323", desired_amount: "500", filled_amount: "0" },
    ],
  });

  const asks = buildBookSide(state, "ask");
  expect(asks).toHaveLength(1);
  expect(asks[0]).toEqual({ price: 0.000_726_6, size: 1500, total: 1500 });
});

test("a futures snapshot files orders on the engine side unchanged", () => {
  const state = applyBookSnapshot({
    bids: [
      { order_id: "f1", side: "buy", limit_price: "1376", desired_amount: "5", filled_amount: "0" },
    ],
    asks: [
      { order_id: "f2", side: "sell", limit_price: "1380", desired_amount: "7", filled_amount: "0" },
    ],
  });

  expect(buildBookSide(state, "bid")[0].price).toBe(1376);
  expect(buildBookSide(state, "ask")[0].price).toBe(1380);
});

test("a spot order with no ui_intent is filed on its engine side", () => {
  const state = applyBookSnapshot({
    bids: [
      {
        order_id: "b1",
        side: "buy",
        limit_price: "0.000726602454709323",
        desired_amount: "1651",
        filled_amount: "0",
      },
    ],
  });

  // An engine BUY of cNGN is a bid, at the engine's own price.
  expect(buildBookSide(state, "ask")).toHaveLength(0);
  expect(buildBookSide(state, "bid")[0].price).toBe(0.000_726_6);
});

// `book` update frames carry no `spot_contract`; the engine side and price are all the delta needs.
test("a spot delta files the order on its engine side", () => {
  const state = new Map();

  applyBookDelta(state, {
    order_id: "d1",
    side: "buy",
    limit_price: "0.000726602454709323",
    order_open: "1651",
    size_delta: "0",
  });

  expect(buildBookSide(state, "ask")).toHaveLength(0);
  expect(buildBookSide(state, "bid")[0]).toEqual({ price: 0.000_726_6, size: 1651, total: 1651 });
});

test("a delta with nothing open removes the order", () => {
  const state = new Map();

  applyBookDelta(state, {
    order_id: "d1",
    side: "buy",
    limit_price: "0.000726602454709323",
    order_open: "1651",
    size_delta: "0",
  });
  applyBookDelta(state, {
    order_id: "d1",
    side: "buy",
    limit_price: "0.000726602454709323",
    order_open: "0",
    size_delta: "-1651",
  });

  expect(buildBookSide(state, "bid")).toHaveLength(0);
});

test("a futures delta keeps the engine side", () => {
  const state = new Map();

  applyBookDelta(state, {
    order_id: "d2",
    side: "buy",
    limit_price: "1376",
    order_open: "5",
    size_delta: "0",
  });

  expect(buildBookSide(state, "bid")[0].price).toBe(1376);
  expect(buildBookSide(state, "ask")).toHaveLength(0);
});

test("a spot trade reports the engine's aggressor side and price", () => {
  const trade = presentStreamTrade({
    trade_id: 1,
    price: "0.000727673387861142",
    size: "1380",
    aggressor_side: "sell",
  });

  expect(trade.side).toBe("sell");
  expect(trade.price).toBe(0.000_727_673_387_861_142);
  expect(trade.size).toBe(1380);
});

test("a futures trade reports the aggressor side unchanged", () => {
  const trade = presentStreamTrade({
    trade_id: 2,
    price: "1376",
    size: "5",
    aggressor_side: "sell",
  });

  expect(trade.side).toBe("sell");
  expect(trade.size).toBe(5);
});

// A partial fill can leave a fractional cNGN print; whole-unit rounding turned 0.073 cNGN into "0".
test("a fractional spot trade size survives presentation", () => {
  const trade = presentStreamTrade({
    trade_id: 3,
    price: "0.000728804362533444",
    size: "0.073",
    aggressor_side: "buy",
  });

  expect(trade.size).toBe(0.073);
  expect(trade.side).toBe("buy");
});

// Cumulative depth runs from the touch outward on both sides — the same convention the REST book
// mapper uses, so a stream that goes live does not redraw every bar at a different width.
test("stream ask totals accumulate from the touch outward", () => {
  const state = applyBookSnapshot({
    bids: [
      { order_id: "n1", side: "buy", limit_price: "0.0007255", desired_amount: "10", filled_amount: "0" },
    ],
    asks: [
      { order_id: "n2", side: "sell", limit_price: "0.0007281", desired_amount: "10", filled_amount: "0" },
      { order_id: "n3", side: "sell", limit_price: "0.0007292", desired_amount: "4", filled_amount: "0" },
    ],
  });

  const asks = buildBookSide(state, "ask");

  expect(asks.map((level) => level.price)).toEqual([0.000_728_1, 0.000_729_2]);
  expect(asks.map((level) => level.total)).toEqual([10, 14]);
});

test("a trade with no positive price or size is not a print", () => {
  expect(presentStreamTrade({ trade_id: 9, price: "0", size: "10", aggressor_side: "sell" })).toBeNull();
  expect(presentStreamTrade({ trade_id: 9, price: "0.00073", size: "0", aggressor_side: "sell" })).toBeNull();
});

test("a streamed perp trade keeps its fractional cNGN size, like spot and the order book", () => {
  // 409.584 cNGN at 0.000732 USDC per cNGN, as the engine frames it.
  const trade = presentStreamTrade({
    aggressor_side: "sell",
    created_at: "2026-10-06T12:48:53.072189+00:00",
    price: "0.000732",
    size: "409.584",
    trade_id: 384,
    tx_hash: "0x" + "ab".repeat(32),
  });
  expect(trade?.size).toBe(409.584);
  expect(trade?.txHash).toBe("0x" + "ab".repeat(32));
  expect(trade?.price).toBe(0.000_732);
  expect(trade?.id).toBe(384);
  expect(trade?.atMs).toBe(Date.parse("2026-10-06T12:48:53.072189+00:00"));
});
