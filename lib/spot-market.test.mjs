import { expect, test } from "bun:test";
import {
  buildSpotMarket,
  collectOpenOrders,
  findOwnCrossingOrder,
  getAnchorPrice,
  getBestPrices,
  getCommittedBalances,
  getCrossingPrice,
  getMarketableLimitPrice,
  getMarketFill,
  getMarketSizingPrice,
  getMaxOrderSize,
  getNextExpiryMs,
  getOrderCost,
  getWorkingOrders,
  presentStats24h,
  SPOT_MARKET_SLIPPAGE,
  toOrderSizeCngn,
  withoutCancelledOrders,
} from "./spot-market.ts";

/**
 * The engine rests cNGN at USDC per cNGN, which is the orientation the terminal shows, and
 * `spot_contract.ui_intent` repeats the same values: an engine bid is a bid on screen.
 */
const SPOT_BOOK = {
  market_presentation: { order_entry_spec: "cngn_usdc_spot_v1" },
  asks: [
    {
      desired_amount: "1648",
      limit_price: "0.0007281",
      order_id: "a1",
      spot_contract: { ui_intent: { price: "0.0007281", side: "sell", size: "1648" } },
    },
  ],
  bids: [
    {
      desired_amount: "1651",
      limit_price: "0.0007266",
      order_id: "b1",
      spot_contract: { ui_intent: { price: "0.0007266", side: "buy", size: "0.4" } },
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

test("the book is shown as the engine rests it", () => {
  const market = buildSpotMarket({ book: SPOT_BOOK, trades: [] });

  expect(market.orderBookAsks[0].price).toBe(0.000_728_1);
  expect(market.orderBookBids[0].price).toBe(0.000_726_6);
  expect(market.orderEntrySpec).toBe("cngn_usdc_spot_v1");
});

// A 0.4 cNGN remainder is real resting depth; whole-unit rounding displayed it as "0".
test("sub-unit spot depth survives the ladder", () => {
  const market = buildSpotMarket({ book: SPOT_BOOK, trades: [] });

  expect(market.orderBookBids[0].size).toBe(0.4);
  expect(market.orderBookBids[0].total).toBe(0.4);
});

// A level's total is what an order sweeping to that price would take, so it runs from the touch
// outward. Asks used to accumulate from the far end, putting the whole side's depth on the best ask.
test("ask totals accumulate from the touch outward", () => {
  const market = buildSpotMarket({
    book: {
      market_presentation: { order_entry_spec: "cngn_usdc_spot_v1" },
      // 0.0007281 is the touch, 0.0007292 rests behind it.
      asks: [
        {
          desired_amount: "1648",
          limit_price: "0.0007281",
          order_id: "a1",
          spot_contract: { ui_intent: { price: "0.0007281", side: "sell", size: "1648" } },
        },
        {
          desired_amount: "1974",
          limit_price: "0.0007292",
          order_id: "a2",
          spot_contract: { ui_intent: { price: "0.0007292", side: "sell", size: "1974" } },
        },
      ],
      bids: [],
    },
    trades: [],
  });

  expect(market.orderBookAsks.map((level) => level.price)).toEqual([0.000_728_1, 0.000_729_2]);
  expect(market.orderBookAsks.map((level) => level.total)).toEqual([1648, 3622]);
});

test("mark is the mid of the two sides", () => {
  const market = buildSpotMarket({ book: SPOT_BOOK, trades: [] });

  expect(market.mark).toBeCloseTo((0.000_726_6 + 0.000_728_1) / 2, 12);
});

test("with only trades, the last trade is the mark", () => {
  const market = buildSpotMarket({
    book: { asks: [], bids: [] },
    trades: [
      {
        aggressor_side: "buy",
        created_at: "2026-08-12T10:12:00Z",
        price: "0.000728",
        size: "100.0734",
        spot_contract: { ui_intent: { price: "0.000728", side: "buy", size: "100.0734" } },
      },
    ],
  });

  expect(market.mark).toBe(0.000_728);
  // Sizes keep three decimals, as the ladder does.
  expect(market.trades[0].size).toBe(100.073);
});

// --- price sources shared by the ladder, the ticket and order submission ---

test("the anchor is the mid, so a prefill cannot cross either side", () => {
  const anchor = getAnchorPrice(0.000_730_6, 0.000_729_1, 0.000_727_6);

  expect(anchor).toBeCloseTo(0.000_729_85, 12);
  // Strictly inside the spread: a buy at this price rests below the ask, a sell above the bid.
  expect(anchor).toBeLessThan(0.000_730_6);
  expect(anchor).toBeGreaterThan(0.000_729_1);
});

// The production defect: a fill from four days earlier sat 0.2% below the best bid, and the
// ticket seeded its limit price with it — a "Limit" sell that crossed the moment it was submitted.
test("a stale last trade never outranks a live book", () => {
  expect(getAnchorPrice(0.000_730_6, 0.000_729_1, 0.000_727_6)).not.toBe(0.000_727_6);
  // One-sided book: the resting side still beats the stale trade.
  expect(getAnchorPrice(0.000_730_6, null, 0.000_727_6)).toBe(0.000_730_6);
  expect(getAnchorPrice(null, 0.000_729_1, 0.000_727_6)).toBe(0.000_729_1);
  // Only with no book at all does the last trade stand in.
  expect(getAnchorPrice(null, null, 0.000_727_6)).toBe(0.000_727_6);
  expect(getAnchorPrice(null, null, null)).toBeNull();
});

test("a market order crosses the opposing touch", () => {
  expect(getCrossingPrice("buy", 0.000_730_6, 0.000_729_1)).toBe(0.000_730_6);
  expect(getCrossingPrice("sell", 0.000_730_6, 0.000_729_1)).toBe(0.000_729_1);
});

// Null is what makes the ticket say "No opposing spot liquidity to cross" instead of submitting
// a market order with an empty price.
test("an empty opposing side yields no crossing price", () => {
  expect(getCrossingPrice("buy", null, 0.000_729_1)).toBeNull();
  expect(getCrossingPrice("sell", 0.000_730_6, null)).toBeNull();
});

test("best prices are read off the top of each ladder", () => {
  const { bestAsk, bestBid } = getBestPrices(
    [
      { price: 0.000_730_6, size: 1648, total: 1648 },
      { price: 0.000_731_7, size: 1974, total: 3622 },
    ],
    [
      { price: 0.000_729_1, size: 1651, total: 1651 },
      { price: 0.000_728, size: 1984, total: 3635 },
    ]
  );

  expect(bestAsk).toBe(0.000_730_6);
  expect(bestBid).toBe(0.000_729_1);
  expect(getBestPrices([], [])).toEqual({ bestAsk: null, bestBid: null });
});

// The ticket's size slider is a share of what the trading account can fund, so this is the ceiling
// it slides against. A wrong answer here oversizes an order the account cannot pay for.
test("a sell is capped by the cNGN balance it delivers, and pays its fee out of the USDC it receives", () => {
  expect(
    getMaxOrderSize({ availableCngn: 12_500, availableUsdc: 31, isBuy: false, price: 0.000_73 })
  ).toBe(12_500);
  // The fee comes out of the USDC side, so the cNGN ceiling is unaffected.
  expect(
    getMaxOrderSize({
      availableCngn: 12_500,
      availableUsdc: 31,
      feeRate: 0.003,
      isBuy: false,
      price: 0.000_73,
    })
  ).toBe(12_500);
});

test("a buy is capped by the USDC balance converted at the order price, less the fee ceiling it is signed with", () => {
  expect(
    getMaxOrderSize({ availableCngn: 0, availableUsdc: 73, isBuy: true, price: 0.000_73 })
  ).toBeCloseTo(100_000, 6);
  // The fee is paid in the same USDC, so the ceiling leaves room for it.
  expect(
    getMaxOrderSize({ availableCngn: 0, availableUsdc: 73, feeRate: 0.003, isBuy: true, price: 0.000_73 })
  ).toBeCloseTo(100_000 / 1.003, 6);
});

/** The ticket writes a preset into the field floored to its four decimals. */
const toAffordableSize = (size) => Math.floor(size * 10_000) / 10_000;

// The 25/50/75/100% presets size the order as a share of this ceiling. The 100% notch must
// clear the ticket's own shortfall check on both sides, or the slider's top would offer an order
// the account cannot pay for.
test("the 100% preset on a buy leaves the USDC its fee ceiling can take", () => {
  const availableUsdc = 31.028_472_772_594_67;
  const feeRate = 0.003;
  const signedPrice = 0.000_714_3;
  const max = getMaxOrderSize({
    availableCngn: 29_246.69,
    availableUsdc,
    feeRate,
    isBuy: true,
    price: signedPrice,
  });
  const size = toAffordableSize(max);
  // Counted at the signed limit, and at the lower price a market order expects to fill at.
  for (const sizingPrice of [signedPrice, 0.000_713_5]) {
    const cost = getOrderCost("buy", sizingPrice, size);
    expect(cost?.currency).toBe("USDC");
    expect(cost?.amount * (1 + feeRate)).toBeLessThanOrEqual(availableUsdc);
  }
  // And every smaller notch is cheaper still.
  for (const percent of [25, 50, 75]) {
    const cost = getOrderCost("buy", signedPrice, toAffordableSize(max * (percent / 100)));
    expect(cost?.amount * (1 + feeRate)).toBeLessThanOrEqual(availableUsdc);
  }
});

test("the 100% preset on a sell delivers no more cNGN than the account holds", () => {
  const availableCngn = 29_246.69;
  const max = getMaxOrderSize({
    availableCngn,
    availableUsdc: 31.03,
    feeRate: 0.003,
    isBuy: false,
    price: 0.000_714_3,
  });
  const size = toAffordableSize(max);
  const cost = getOrderCost("sell", 0.000_714_3, size);
  expect(cost?.currency).toBe("cNGN");
  expect(cost?.amount).toBeLessThanOrEqual(availableCngn);
  for (const percent of [25, 50, 75]) {
    const notch = toAffordableSize(max * (percent / 100));
    expect(getOrderCost("sell", 0.000_714_3, notch)?.amount).toBeLessThanOrEqual(availableCngn);
  }
});

test("no ceiling without a balance or a usable price", () => {
  expect(
    getMaxOrderSize({ availableCngn: null, availableUsdc: null, isBuy: true, price: 0.000_73 })
  ).toBeNull();
  expect(
    getMaxOrderSize({ availableCngn: null, availableUsdc: 73, isBuy: true, price: null })
  ).toBeNull();
  // A zero or negative price would divide into an infinite ceiling.
  expect(
    getMaxOrderSize({ availableCngn: null, availableUsdc: 73, isBuy: true, price: 0 })
  ).toBeNull();
  expect(
    getMaxOrderSize({ availableCngn: null, availableUsdc: null, isBuy: false, price: 0.000_73 })
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
        limit_price: "0.0007275",
        nonce: "1755080858277",
        order_id: "spot-1",
        owner_address: OWNER,
        side: "sell",
        spot_contract: { ui_intent: { price: "0.0007275", side: "sell", size: "1374" } },
      },
    ],
  });

  expect(orders).toHaveLength(1);
  // markets-service cancels by (owner_address, nonce), so both must survive the mapping.
  expect(orders[0].ownerAddress).toBe(OWNER);
  expect(orders[0].nonce).toBe("1755080858277");
  expect(orders[0].side).toBe("sell");
  expect(orders[0].price).toBe(0.000_727_5);
  expect(orders[0].size).toBe(1374);
});

// A row with no owner or nonce cannot be cancelled, and the only reason to list it is to act on it.
test("orders that cannot be cancelled are not listed", () => {
  const orders = collectOpenOrders({
    asks: [
      {
        desired_amount: "1374",
        filled_amount: "0",
        limit_price: "0.0007275",
        order_id: "x",
        spot_contract: { ui_intent: { price: "0.0007275", side: "sell", size: "1374" } },
      },
    ],
    bids: [
      {
        desired_amount: "1370",
        filled_amount: "0",
        limit_price: "0.0007275",
        order_id: "y",
        owner_address: OWNER,
        spot_contract: { ui_intent: { price: "0.0007275", side: "buy", size: "1370" } },
      },
    ],
  });

  expect(orders).toEqual([]);
});

test("a market with no book has no open orders", () => {
  expect(buildSpotMarket(null).openOrders).toEqual([]);
});

// --- what an order costs, and what resting orders already claim ---

test("a buy costs USDC at its price, a sell costs the cNGN it delivers", () => {
  const buy = getOrderCost("buy", 0.000_73, 1370);
  expect(buy?.currency).toBe("USDC");
  expect(buy?.amount).toBeCloseTo(1.0001, 9);
  expect(getOrderCost("sell", 0.000_73, 2740)).toEqual({ amount: 2740, currency: "cNGN" });
});

// An unknown cost must never read as a free order — that is what lets an unaffordable order through.
test("an unusable price or size has no cost", () => {
  expect(getOrderCost("buy", null, 1370)).toBeNull();
  expect(getOrderCost("buy", 0, 1370)).toBeNull();
  expect(getOrderCost("buy", 0.000_73, 0)).toBeNull();
  expect(getOrderCost("sell", 0.000_73, Number.NaN)).toBeNull();
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
      price: 0.000_73,
      side: "buy",
      size: 1370,
    },
    {
      filled: 0,
      nonce: "2",
      orderId: "b",
      ownerAddress: "0xAAA",
      price: 0.000_725,
      side: "sell",
      size: 2740,
    },
    {
      filled: 0,
      nonce: "3",
      orderId: "c",
      ownerAddress: "0xBBB",
      price: 0.000_725,
      side: "buy",
      size: 5000,
    },
  ];

  const committed = getCommittedBalances(resting, "0xaaa");
  expect(committed.usdc).toBeCloseTo(1.0001, 9);
  expect(committed.cngn).toBe(2740);
  // Someone else's resting order commits nothing of this account's.
  expect(getCommittedBalances(resting, null)).toEqual({ cngn: 0, usdc: 0 });
});

test("a partly filled order only commits what is still working", () => {
  const resting = [
    {
      filled: 500,
      nonce: "1",
      orderId: "a",
      ownerAddress: "0xAAA",
      price: 0.000_73,
      side: "buy",
      size: 2000,
    },
  ];

  // 1,500 cNGN still working at 0.00073.
  expect(getCommittedBalances(resting, "0xAAA").usdc).toBeCloseTo(1.095, 9);
});

/*
 * The exact reported sequence: 1,300 cNGN in the account, a sell of 1,382 cNGN. The venue accepts
 * it, rests it unfillable, and expires it five minutes later. The shortfall is 82 cNGN, and this is
 * the arithmetic the ticket blocks on.
 */
test("the reported unaffordable order is 82 cNGN short", () => {
  const cost = getOrderCost("sell", 0.000_73, 1382);

  expect(cost).toEqual({ amount: 1382, currency: "cNGN" });
  expect(cost.amount - 1300).toBe(82);
});

// --- market orders are signed through the touch, not at it ---

/*
 * The reported failure: a market sell was signed at a bid of 0.0007278 that the maker had already
 * left. Priced at the touch, the order was no longer marketable when the engine saw it, so it
 * rested as an ask above the new best bid and expired unfilled.
 */
test("a market order is priced through the opposing touch", () => {
  // Sell: below the bid, so it still crosses if the bid drops.
  expect(getMarketableLimitPrice("sell", 0.000_726_4, 0.000_727_8)).toBe(0.000_724_2);
  // Buy: above the ask, so it still crosses if the ask rises.
  expect(getMarketableLimitPrice("buy", 0.000_726_4, 0.000_727_8)).toBe(0.000_73);
});

test("the signed price stays marketable after the quote moves against it", () => {
  const bid = 0.000_727_8;
  const sell = getMarketableLimitPrice("sell", 0.000_726_4, bid);
  // The maker re-quoted 0.15% lower — the move that broke the reported order.
  const movedBid = 0.000_726_7;

  expect(sell).toBeLessThan(movedBid);
});

test("tolerance is configurable and applied to the right side", () => {
  expect(getMarketableLimitPrice("buy", 0.000_73, 0.000_72, 0.01)).toBe(0.000_737_3);
  expect(getMarketableLimitPrice("sell", 0.000_73, 0.000_72, 0.01)).toBe(0.000_712_8);
  expect(SPOT_MARKET_SLIPPAGE).toBe(0.005);
});

// The ladder shows seven decimals, so the signed price is rounded to what the trader can see.
test("the marketable price is rounded to the displayed decimals", () => {
  expect(getMarketableLimitPrice("buy", 0.000_728_057_184_244_482, null)).toBe(0.000_731_7);
});

// Nothing to cross means no price, which is what surfaces "no opposing liquidity" instead of
// signing an order against an empty side.
test("an empty opposing side has no marketable price", () => {
  expect(getMarketableLimitPrice("buy", null, 0.000_727_8)).toBeNull();
  expect(getMarketableLimitPrice("sell", 0.000_726_4, null)).toBeNull();
  expect(getMarketableLimitPrice("buy", 0, 0.000_727_8)).toBeNull();
});

// --- orders age out of a snapshot on their own ---

const RESTING_AT = (expiresAtMs) => ({
  expiresAtMs,
  filled: 0,
  nonce: "1",
  orderId: "spot-1",
  ownerAddress: "0xAAA",
  price: 0.000_727_5,
  side: "buy",
  size: 1370,
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
  expect(getCommittedBalances(getWorkingOrders([dead], now), "0xAAA").usdc).toBe(0);
  // Still counted while it is genuinely working: 1,370 cNGN at 0.0007275.
  expect(getCommittedBalances(getWorkingOrders([live], now), "0xAAA").usdc).toBeCloseTo(0.996_675, 9);
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
 * A market buy is signed through the touch, so the USDC the engine holds is 0.5% more than the
 * touch would suggest. Sizing the slider off the touch put its own top notch 0.5% out of reach:
 * dragging to 100% produced an order the ticket then refused to submit, with no way back down other
 * than typing. The ceiling has to be priced the same way the order is.
 */
test("the affordable ceiling is priced at the signed price, not the touch", () => {
  const bestAsk = 0.000_72;
  const availableUsdc = 10;
  const signedPrice = getMarketableLimitPrice("buy", bestAsk, null);

  const atTheTouch = getMaxOrderSize({
    availableCngn: null,
    availableUsdc,
    isBuy: true,
    price: bestAsk,
  });
  const atTheSignedPrice = getMaxOrderSize({
    availableCngn: null,
    availableUsdc,
    isBuy: true,
    price: signedPrice,
  });

  // Sized at the touch, a full-size order costs more than the account holds.
  expect(getOrderCost("buy", signedPrice, atTheTouch).amount).toBeGreaterThan(availableUsdc);
  // Sized at the signed price, it costs exactly what is there.
  expect(getOrderCost("buy", signedPrice, atTheSignedPrice).amount).toBeCloseTo(availableUsdc, 9);
});

/*
 * The other half of that clamp: the ticket rounds the slider's size to four decimals, and rounding
 * to *nearest* can land a hair above the ceiling — which is a shortfall like any other.
 */
test("flooring the slider's size keeps 100% affordable", () => {
  const availableCngn = 22_100.000_09;
  const max = getMaxOrderSize({ availableCngn, availableUsdc: null, isBuy: false, price: null });

  expect(Number(max.toFixed(4))).toBeGreaterThan(availableCngn);
  expect(Math.floor(max * 10_000) / 10_000).toBeLessThanOrEqual(availableCngn);
});

// --- a just-cancelled order is dropped before the snapshot catches up ---

const OWNED_ORDER = (nonce) => ({
  expiresAtMs: null,
  filled: 0,
  nonce,
  orderId: `spot-${nonce}`,
  ownerAddress: "0xAAA",
  price: 0.000_727_5,
  side: "buy",
  size: 1370,
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
  const beforeCancel = getCommittedBalances(snapshot, "0xAAA").usdc;
  const afterCancel = getCommittedBalances(
    withoutCancelledOrders(snapshot, new Set(["1"])),
    "0xAAA"
  ).usdc;

  // Two orders committed; one cancelled → committed halves, and neither figure is zero.
  expect(beforeCancel).toBeCloseTo(2 * afterCancel, 9);
  expect(afterCancel).toBeGreaterThan(0);
});

/*
 * A market order's price is the depth it eats, not the touch. These pin the walk, because the
 * ticket quotes `Average price` off it and a trader compares that figure against the ladder.
 */
const ASKS = [
  { price: 0.000_73, size: 10_000, total: 10_000 },
  { price: 0.000_735, size: 10_000, total: 20_000 },
  { price: 0.000_75, size: 30_000, total: 50_000 },
];
const BIDS = [
  { price: 0.000_725, size: 5000, total: 5000 },
  { price: 0.000_72, size: 15_000, total: 20_000 },
];

test("a buy inside the touch fills at the touch", () => {
  const fill = getMarketFill("buy", ASKS, BIDS, 5000);
  expect(fill.averagePrice).toBeCloseTo(0.000_73, 12);
  expect(fill.filledSize).toBeCloseTo(5000, 6);
  expect(fill.isFullyFilled).toBe(true);
});

test("a buy through two levels averages them by size", () => {
  // 10,000 @ 0.00073 + 5,000 @ 0.000735 = 10.975 USDC over 15,000 cNGN.
  const fill = getMarketFill("buy", ASKS, BIDS, 15_000);
  expect(fill.averagePrice).toBeCloseTo(10.975 / 15_000, 12);
  // The touch alone would have understated the cost, which is the whole point of walking.
  expect(fill.averagePrice).toBeGreaterThan(ASKS[0].price);
  expect(fill.isFullyFilled).toBe(true);
});

test("a sell walks the bids down, not the asks up", () => {
  // 5,000 @ 0.000725 + 5,000 @ 0.00072 = 7.225 USDC over 10,000 cNGN.
  const fill = getMarketFill("sell", ASKS, BIDS, 10_000);
  expect(fill.averagePrice).toBeCloseTo(7.225 / 10_000, 12);
  expect(fill.averagePrice).toBeLessThan(BIDS[0].price);
});

test("an order past the book reports what the depth covers", () => {
  const fill = getMarketFill("sell", ASKS, BIDS, 100_000);
  expect(fill.filledSize).toBeCloseTo(20_000, 6);
  expect(fill.isFullyFilled).toBe(false);
  // Still a real average over what rests — the remainder rests rather than filling.
  // 5,000 @ 0.000725 + 15,000 @ 0.00072 = 14.425 USDC over 20,000 cNGN.
  expect(fill.averagePrice).toBeCloseTo(14.425 / 20_000, 12);
});

test("an empty side prices nothing rather than guessing", () => {
  const fill = getMarketFill("buy", [], BIDS, 5000);
  expect(fill.averagePrice).toBeNull();
  expect(fill.filledSize).toBe(0);
  expect(fill.isFullyFilled).toBe(false);
});

test("a size of zero or nonsense prices nothing", () => {
  expect(getMarketFill("buy", ASKS, BIDS, 0).averagePrice).toBeNull();
  expect(getMarketFill("buy", ASKS, BIDS, Number.NaN).averagePrice).toBeNull();
});

/*
 * The Size field can be counted in either leg, but only the cNGN figure is submittable: the
 * signed envelope carries no other unit. A USDC entry converted at the wrong end of the division
 * would size the order by a factor of the price — ~1,400x on this pair.
 */
test("a cNGN entry is already the order size", () => {
  expect(toOrderSizeCngn(140_000, "cNGN", 0.000_73)).toBe(140_000);
});

test("a USDC entry is divided by the price, not multiplied", () => {
  expect(toOrderSizeCngn(73, "USDC", 0.000_73)).toBeCloseTo(100_000, 6);
});

test("a USDC entry with no price to convert at is not a size", () => {
  expect(Number.isNaN(toOrderSizeCngn(73, "USDC", null))).toBe(true);
  expect(Number.isNaN(toOrderSizeCngn(73, "USDC", 0))).toBe(true);
  // A cNGN entry needs no price, so it survives an unpriced book.
  expect(toOrderSizeCngn(140_000, "cNGN", null)).toBe(140_000);
});

/*
 * The fee schedule has one source: the markets service serves it on the book's market
 * presentation, and every consumer reads it from there. Nothing in this repo may hold its own
 * copy of the rate — a second copy is wrong the first time the venue changes the first.
 */
test("the venue's taker fee is carried through from the book, not assumed", () => {
  const market = buildSpotMarket({
    book: { asks: [], bids: [], market_presentation: { taker_fee_bps: 25 } },
    trades: [],
  });

  expect(market.takerFeeBps).toBe(25);
});

test("a venue that reports no schedule leaves the fee unknown, not free", () => {
  // Null renders as no fee row at all. Zero would be a claim the venue never made, and on a
  // market that does charge it would understate every ticket by the whole fee.
  expect(buildSpotMarket({ book: { asks: [], bids: [] }, trades: [] }).takerFeeBps).toBeNull();
  expect(buildSpotMarket(null).takerFeeBps).toBeNull();
});

test("a zero fee the venue did report is shown as zero", () => {
  const market = buildSpotMarket({
    book: { asks: [], bids: [], market_presentation: { taker_fee_bps: 0 } },
    trades: [],
  });

  expect(market.takerFeeBps).toBe(0);
});

// --- a market order's USDC entry is converted at its expected fill ---

/**
 * Trades #341 and #342: a market buy entered as 1 USDC was converted at the signed limit, 0.5%
 * through the ask, so it bought 0.5% less cNGN than the USDC paid for. The conversion belongs at
 * the expected fill, held inside the limit.
 */
test("a market order's USDC entry is converted at its expected fill, not its signed limit", () => {
  const buyLimit = getMarketableLimitPrice("buy", 0.000_746_6, null);
  const sellLimit = getMarketableLimitPrice("sell", null, 0.000_748);

  expect(getMarketSizingPrice("buy", 0.000_746_6, buyLimit)).toBe(0.000_746_6);
  expect(getMarketSizingPrice("sell", 0.000_748, sellLimit)).toBe(0.000_748);
});

/** A size converted past the limit is the inflated amount itself, so the limit is the most it gets. */
test("an expected fill past the signed limit is held at the limit", () => {
  expect(getMarketSizingPrice("buy", 0.000_76, 0.000_75)).toBe(0.000_75);
  expect(getMarketSizingPrice("sell", 0.000_74, 0.000_745)).toBe(0.000_745);
});

test("no limit or no expected fill sizes nothing, rather than falling back to the limit", () => {
  expect(getMarketSizingPrice("buy", 0.000_746_6, null)).toBeNull();
  expect(getMarketSizingPrice("buy", null, 0.000_75)).toBeNull();
  expect(getMarketSizingPrice("sell", Number.NaN, 0.000_745)).toBeNull();
});

// --- an order that would trade against the trader's own resting order ---

/** The 2026-09-13 pair on account 19: a resting sell at 0.0007428, then a buy signed at the same price. */
const OWN_RESTING_SELL = {
  expiresAtMs: null,
  filled: 0,
  nonce: "7329085609621191",
  orderId: "spot-795437f5-c69b-489e-8bbf-5c805090a015",
  ownerAddress: "0xeabca823b4d35d8f2eac09edb55c42d8077fbfca",
  price: 0.000_742_8,
  side: "sell",
  size: 1346,
};

test("a buy at the price of the trader's own resting sell would cross it", () => {
  expect(
    findOwnCrossingOrder({ ownOrders: [OWN_RESTING_SELL], side: "buy", signedPrice: 0.000_742_8 })
  ).toBe(OWN_RESTING_SELL);
});

test("a buy below the trader's own resting sell does not cross it", () => {
  expect(
    findOwnCrossingOrder({ ownOrders: [OWN_RESTING_SELL], side: "buy", signedPrice: 0.000_742_7 })
  ).toBeNull();
});

test("a sell crosses the trader's own resting buy at or above its price, never an own sell", () => {
  const ownBuy = { ...OWN_RESTING_SELL, nonce: "1", orderId: "spot-own-buy", side: "buy" };

  expect(findOwnCrossingOrder({ ownOrders: [ownBuy], side: "sell", signedPrice: 0.000_742_8 })).toBe(ownBuy);
  expect(findOwnCrossingOrder({ ownOrders: [ownBuy], side: "sell", signedPrice: 0.000_742_9 })).toBeNull();
  expect(
    findOwnCrossingOrder({ ownOrders: [OWN_RESTING_SELL], side: "sell", signedPrice: 0.000_72 })
  ).toBeNull();
});

/** A market buy signed through several of the trader's own sells would hit the lowest first. */
test("the nearest crossed order is the one reported", () => {
  const higher = { ...OWN_RESTING_SELL, nonce: "2", orderId: "spot-higher", price: 0.000_745 };

  expect(
    findOwnCrossingOrder({ ownOrders: [higher, OWN_RESTING_SELL], side: "buy", signedPrice: 0.000_746 })
  ).toBe(OWN_RESTING_SELL);
});

test("without a signed price there is nothing to judge", () => {
  expect(
    findOwnCrossingOrder({ ownOrders: [OWN_RESTING_SELL], side: "buy", signedPrice: null })
  ).toBeNull();
});

/** GET /v1/trades `stats_24h` at 2026-09-14 00:14Z, in the engine's USDC-per-cNGN prices. */
const VENUE_STATS = {
  change: "0.000006955101479527",
  high: "0.000753511013055828",
  last: "0.000753511013055828",
  low: "0.000743586296866452",
  quote_volume: "6.000056567690660151",
  volume: "8034",
};

test("venue stats are presented as served: USDC per cNGN, high still the high", () => {
  const stats = presentStats24h(VENUE_STATS);

  expect(stats.high).toBe(0.000_753_511_013_055_828);
  expect(stats.low).toBe(0.000_743_586_296_866_452);
  // First price = last - change = trade #341's 0.000746555911576301.
  expect(stats.firstPrice).toBeCloseTo(0.000_746_555_911_576_301, 12);
  // USDC, not the 8,034 cNGN the venue reports as `volume`.
  expect(stats.quoteVolume).toBeCloseTo(6.000_06, 5);
});

test("a quiet window reports nothing rather than zeros", () => {
  const quiet = { change: "", high: "", last: "", low: "", quote_volume: "", volume: "" };
  expect(presentStats24h(quiet)).toEqual({
    firstPrice: null,
    high: null,
    low: null,
    quoteVolume: null,
  });
});

test("a service that predates quote_volume leaves the volume unknown, never the cNGN figure", () => {
  const { quote_volume: _omitted, ...older } = VENUE_STATS;
  const stats = presentStats24h(older);

  expect(stats.quoteVolume).toBeNull();
  expect(stats.high).toBe(0.000_753_511_013_055_828);
});

test("non-positive or unparseable stats are unknown", () => {
  const broken = { change: "abc", high: "0", last: "-1", low: "not-a-number", quote_volume: "0" };
  expect(presentStats24h(broken)).toEqual({
    firstPrice: null,
    high: null,
    low: null,
    quoteVolume: null,
  });
});

test("no stats from the venue means none on the market", () => {
  expect(presentStats24h(null)).toBeNull();
  expect(buildSpotMarket(null).stats24h).toBeNull();
  expect(buildSpotMarket({ book: SPOT_BOOK, trades: [] }).stats24h).toBeNull();
  expect(
    buildSpotMarket({ book: SPOT_BOOK, stats24h: VENUE_STATS, trades: [] }).stats24h.high
  ).toBe(0.000_753_511_013_055_828);
});

/*
 * Trade #348's order on the Open Orders tab: a 1,327 cNGN order that has filled 1,307. `filled` is
 * documented as the cNGN already filled, and both its readers depend on that unit: `size - filled`
 * for the reservation, and the Filled cell, which prints it with a cNGN label. The engine's
 * `filled_amount` is already that figure; nothing about it needs the price.
 */
test("filled is the cNGN that traded, in the same unit as size", () => {
  const orders = collectOpenOrders({
    bids: [],
    asks: [
      {
        desired_amount: "1327",
        filled_amount: "1307",
        limit_price: "0.000753388839409405",
        nonce: "1",
        order_id: "spot-1",
        owner_address: "0xAAA",
        side: "sell",
        spot_contract: {
          ui_intent: { price: "0.000753388839409405", side: "sell", size: "1327" },
        },
      },
    ],
  });

  expect(orders).toHaveLength(1);
  expect(orders[0].size).toBe(1327);
  expect(orders[0].filled).toBe(1307);
});

// The reservation reads `size - filled`, so both have to be cNGN or a mostly filled order keeps
// reserving almost its whole cost against the account's balance.
test("a mostly filled order only reserves what is still working", () => {
  const orders = collectOpenOrders({
    asks: [],
    bids: [
      {
        desired_amount: "1327",
        filled_amount: "1194",
        limit_price: "0.0007534",
        nonce: "2",
        order_id: "spot-2",
        owner_address: "0xAAA",
        side: "buy",
        spot_contract: {
          ui_intent: { price: "0.0007534", side: "buy", size: "1327" },
        },
      },
    ],
  });

  const remaining = orders[0].size - orders[0].filled;
  expect(remaining).toBe(133);
  // 133 cNGN still working at 0.0007534, so about a tenth of a USDC still committed.
  expect(getCommittedBalances(orders, "0xAAA").usdc).toBeCloseTo(0.100_202_2, 6);
});

// An order with no ui_intent used to be rendered from its engine fields. Dropped instead — but never
// silently, or a missing row looks like no order.
test("an order with no ui_intent presentation is dropped, loudly", () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args);
  try {
    const orders = collectOpenOrders({
      asks: [],
      bids: [
        {
          desired_amount: "1374",
          filled_amount: "0",
          limit_price: "0.0007275",
          nonce: "3",
          order_id: "spot-3",
          owner_address: "0xAAA",
          side: "buy",
        },
      ],
    });

    expect(orders).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0][0]).toContain("no ui_intent");
  } finally {
    console.warn = original;
  }
});

test("the served order stack rides along, and is null when the venue did not report it", () => {
  const orderStack = {
    assetAddress: "0x37c976bb5d4887a714ef19AF6B83e34fe2f37c98",
    tradeModuleAddress: "0xDea968180B0bd7a2b0e3AcB0a3bD5F8f7A6D1C2e",
  };
  expect(buildSpotMarket({ book: null, orderStack, trades: [] }).orderStack).toEqual(orderStack);
  expect(buildSpotMarket({ book: null, trades: [] }).orderStack).toBeNull();
  expect(buildSpotMarket(null).orderStack).toBeNull();
});
