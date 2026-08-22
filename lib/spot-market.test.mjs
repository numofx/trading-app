import { expect, test } from "bun:test";
import {
  buildSpotMarket,
  collectOpenOrders,
  getAnchorPrice,
  getBestPrices,
  getCommittedBalances,
  getCrossingPrice,
  getMarketableLimitPrice,
  getMaxOrderSize,
  getNextExpiryMs,
  getOrderCost,
  getWorkingOrders,
  SPOT_MARKET_SLIPPAGE,
  withoutCancelledOrders,
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

// A level's total is what an order sweeping to that price would take, so it runs from the touch
// outward. Asks used to accumulate from the far end, putting the whole side's depth on the best ask.
test("ask totals accumulate from the touch outward", () => {
  const market = buildSpotMarket({
    book: {
      market_presentation: { order_entry_spec: "usdc_cngn_spot_v1" },
      asks: [],
      // Engine bids are the UI asks: 1376.27 is the touch, 1377.02 rests behind it.
      bids: [
        {
          desired_amount: "1651",
          limit_price: "0.000726602454709323",
          order_id: "b1",
          spot_contract: { ui_intent: { price: "1376.27", side: "sell", size: "1.2" } },
        },
        {
          desired_amount: "2000",
          limit_price: "0.000726206",
          order_id: "b2",
          spot_contract: { ui_intent: { price: "1377.02", side: "sell", size: "2" } },
        },
      ],
    },
    trades: [],
  });

  expect(market.orderBookAsks.map((level) => level.price)).toEqual([1376.27, 1377.02]);
  expect(market.orderBookAsks.map((level) => level.total)).toEqual([1.2, 3.2]);
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

// --- what an order costs, and what resting orders already claim ---

test("a buy costs cNGN at its price, a sell costs the USDC it delivers", () => {
  expect(getOrderCost("buy", 1382, 1)).toEqual({ amount: 1382, currency: "cNGN" });
  expect(getOrderCost("sell", 1382, 2)).toEqual({ amount: 2, currency: "USDC" });
});

// An unknown cost must never read as a free order — that is what lets an unaffordable order through.
test("an unusable price or size has no cost", () => {
  expect(getOrderCost("buy", null, 1)).toBeNull();
  expect(getOrderCost("buy", 0, 1)).toBeNull();
  expect(getOrderCost("buy", 1382, 0)).toBeNull();
  expect(getOrderCost("sell", 1382, Number.NaN)).toBeNull();
});

/*
 * The exact shape of the reported failure: an account holding 1,300 cNGN signed a 1,382 cNGN order,
 * which rested unfillable and expired. Counting what is already working is what makes the balance
 * shown mean "spendable".
 */
test("resting orders commit the balance they would spend", () => {
  const resting = [
    {
      filled: 0,
      nonce: "1",
      orderId: "a",
      ownerAddress: "0xAAA",
      price: 1382,
      side: "buy",
      size: 1,
    },
    {
      filled: 0,
      nonce: "2",
      orderId: "b",
      ownerAddress: "0xAAA",
      price: 1380,
      side: "sell",
      size: 2,
    },
    {
      filled: 0,
      nonce: "3",
      orderId: "c",
      ownerAddress: "0xBBB",
      price: 1380,
      side: "buy",
      size: 5,
    },
  ];

  const committed = getCommittedBalances(resting, "0xaaa");
  expect(committed.cngn).toBe(1382);
  expect(committed.usdc).toBe(2);
  // Someone else's resting order commits nothing of this account's.
  expect(getCommittedBalances(resting, null)).toEqual({ cngn: 0, usdc: 0 });
});

test("a partly filled order only commits what is still working", () => {
  const resting = [
    {
      filled: 0.5,
      nonce: "1",
      orderId: "a",
      ownerAddress: "0xAAA",
      price: 1000,
      side: "buy",
      size: 2,
    },
  ];

  expect(getCommittedBalances(resting, "0xAAA").cngn).toBe(1500);
});

/*
 * The exact reported sequence: 1,300 cNGN in the account, a 1 USDC buy at 1,382. The venue accepts
 * it, rests it unfillable, and expires it five minutes later. The shortfall is 82 cNGN, and this is
 * the arithmetic the ticket blocks on.
 */
test("the reported unaffordable order is 82 cNGN short", () => {
  const cost = getOrderCost("buy", 1382, 1);

  expect(cost).toEqual({ amount: 1382, currency: "cNGN" });
  expect(cost.amount - 1300).toBe(82);
});

// --- market orders are signed through the touch, not at it ---

/*
 * The reported failure: a market sell was signed at a bid of 1374.02 that the maker had already
 * left. Priced at the touch, the order was no longer marketable when the engine saw it, so it
 * rested as an ask above the new best bid and expired unfilled.
 */
test("a market order is priced through the opposing touch", () => {
  // Sell: below the bid, so it still crosses if the bid drops.
  expect(getMarketableLimitPrice("sell", 1376.67, 1374.02)).toBe(1367.15);
  // Buy: above the ask, so it still crosses if the ask rises.
  expect(getMarketableLimitPrice("buy", 1376.67, 1374.02)).toBe(1383.55);
});

test("the signed price stays marketable after the quote moves against it", () => {
  const bid = 1374.02;
  const sell = getMarketableLimitPrice("sell", 1376.67, bid);
  // The maker re-quoted 2.16 lower — the move that broke the reported order.
  const movedBid = 1371.86;

  expect(sell).toBeLessThan(movedBid);
});

test("tolerance is configurable and applied to the right side", () => {
  expect(getMarketableLimitPrice("buy", 1000, 900, 0.01)).toBe(1010);
  expect(getMarketableLimitPrice("sell", 1000, 900, 0.01)).toBe(891);
  expect(SPOT_MARKET_SLIPPAGE).toBe(0.005);
});

// Nothing to cross means no price, which is what surfaces "no opposing liquidity" instead of
// signing an order against an empty side.
test("an empty opposing side has no marketable price", () => {
  expect(getMarketableLimitPrice("buy", null, 1374)).toBeNull();
  expect(getMarketableLimitPrice("sell", 1376, null)).toBeNull();
  expect(getMarketableLimitPrice("buy", 0, 1374)).toBeNull();
});

// --- orders age out of a snapshot on their own ---

const RESTING_AT = (expiresAtMs) => ({
  expiresAtMs,
  filled: 0,
  nonce: "1",
  orderId: "spot-1",
  ownerAddress: "0xAAA",
  price: 1374.61,
  side: "buy",
  size: 0.5,
});

/*
 * The reported symptom: `Available` stayed reduced by an order that had already expired. The book
 * arrives as a server-rendered snapshot and orders leave it on a timer with nothing to announce
 * it, so a page that does not re-render keeps subtracting a dead order's cost.
 */
test("an expired order stops being counted", () => {
  const now = 1_770_000_000_000;
  const live = RESTING_AT(now + 60_000);
  const dead = RESTING_AT(now - 1);

  expect(getWorkingOrders([live, dead], now)).toEqual([live]);
  expect(getCommittedBalances(getWorkingOrders([dead], now), "0xAAA").cngn).toBe(0);
  // Still counted while it is genuinely working.
  expect(getCommittedBalances(getWorkingOrders([live], now), "0xAAA").cngn).toBeCloseTo(687.3, 1);
});

// Before an effect supplies the clock, the client must render exactly what the server did.
test("an unknown clock ages nothing out", () => {
  const dead = RESTING_AT(1);
  expect(getWorkingOrders([dead], 0)).toEqual([dead]);
});

test("an order with no expiry is never aged out", () => {
  const forever = RESTING_AT(null);
  expect(getWorkingOrders([forever], Date.parse("2030-01-01"))).toEqual([forever]);
});

// The terminal schedules its catch-up render for this instant.
test("the soonest expiry is what a caller waits for", () => {
  expect(getNextExpiryMs([RESTING_AT(500), RESTING_AT(200), RESTING_AT(null)])).toBe(200);
  expect(getNextExpiryMs([RESTING_AT(null)])).toBeNull();
  expect(getNextExpiryMs([])).toBeNull();
});

// --- the ticket's size slider tops out at what the account can actually sign for ---

/*
 * A market buy is signed through the touch, so the collateral the engine holds is 0.5% more than
 * the touch would suggest. Sizing the slider off the touch put its own top notch 0.5% out of reach:
 * dragging to 100% produced an order the ticket then refused to submit, with no way back down other
 * than typing. The ceiling has to be priced the same way the order is.
 */
test("the affordable ceiling is priced at the signed price, not the touch", () => {
  const bestAsk = 1400;
  const availableCngn = 1400;
  const signedPrice = getMarketableLimitPrice("buy", bestAsk, null);

  const atTheTouch = getMaxOrderSize({
    availableCngn,
    availableUsdc: null,
    isBuy: true,
    price: bestAsk,
  });
  const atTheSignedPrice = getMaxOrderSize({
    availableCngn,
    availableUsdc: null,
    isBuy: true,
    price: signedPrice,
  });

  // Sized at the touch, a full-size order costs more than the account holds.
  expect(getOrderCost("buy", signedPrice, atTheTouch).amount).toBeGreaterThan(availableCngn);
  // Sized at the signed price, it costs exactly what is there.
  expect(getOrderCost("buy", signedPrice, atTheSignedPrice).amount).toBeCloseTo(availableCngn, 9);
});

/*
 * The other half of that clamp: the ticket rounds the slider's size to four decimals, and rounding
 * to *nearest* can land a hair above the ceiling — which is a shortfall like any other.
 */
test("flooring the slider's size keeps 100% affordable", () => {
  const availableUsdc = 22.100_09;
  const max = getMaxOrderSize({ availableCngn: null, availableUsdc, isBuy: false, price: null });

  expect(Number(max.toFixed(4))).toBeGreaterThan(availableUsdc);
  expect(Math.floor(max * 10_000) / 10_000).toBeLessThanOrEqual(availableUsdc);
});

// --- a just-cancelled order is dropped before the snapshot catches up ---

const OWNED_ORDER = (nonce) => ({
  expiresAtMs: null,
  filled: 0,
  nonce,
  orderId: `spot-${nonce}`,
  ownerAddress: "0xAAA",
  price: 1374.61,
  side: "buy",
  size: 0.5,
});

test("an empty cancelled set returns the snapshot untouched", () => {
  const orders = [OWNED_ORDER("1"), OWNED_ORDER("2")];
  expect(withoutCancelledOrders(orders, new Set())).toBe(orders);
});

test("a cancelled nonce is dropped while others stay", () => {
  const orders = [OWNED_ORDER("1"), OWNED_ORDER("2"), OWNED_ORDER("3")];
  const kept = withoutCancelledOrders(orders, new Set(["2"]));
  expect(kept.map((order) => order.nonce)).toEqual(["1", "3"]);
});

test("a cancelled nonce not in the snapshot changes nothing", () => {
  const orders = [OWNED_ORDER("1")];
  expect(withoutCancelledOrders(orders, new Set(["999"])).map((o) => o.nonce)).toEqual(["1"]);
});

/*
 * The symptom the overlay fixes: after a cancel is accepted, `Available` must recover immediately.
 * The snapshot still lists the order (the refresh has not landed, or raced the venue), so without
 * the overlay its cost stays committed until the order ages out at expiry.
 */
test("cancelling an order releases its committed balance at once", () => {
  const snapshot = [OWNED_ORDER("1"), OWNED_ORDER("2")];
  const beforeCancel = getCommittedBalances(snapshot, "0xAAA").cngn;
  const afterCancel = getCommittedBalances(
    withoutCancelledOrders(snapshot, new Set(["1"])),
    "0xAAA"
  ).cngn;

  // Two orders committed; one cancelled → committed halves, and neither figure is zero.
  expect(beforeCancel).toBeCloseTo(2 * afterCancel, 6);
  expect(afterCancel).toBeGreaterThan(0);
});
