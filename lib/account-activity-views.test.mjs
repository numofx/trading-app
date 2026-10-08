import { expect, test } from "bun:test";
import { base, baseSepolia } from "viem/chains";
import {
  buildOpenOrdersActivityView,
  buildOrderHistoryActivityView,
  buildPerpOrderHistoryActivityView,
  buildPerpTradeHistoryActivityView,
  buildTradeHistoryActivityView,
  getFillTransactionUrl,
  getOwnedOpenOrders,
  ORDER_HISTORY_COLUMNS,
  PERP_ORDER_HISTORY_COLUMNS,
  PERP_TRADE_HISTORY_COLUMNS,
  TRADE_HISTORY_COLUMNS,
} from "./account-activity-views.ts";
import { ACTIVITY_VIEWS, SPOT_BOTTOM_TABS } from "./spot-terminal-config.ts";

const RESTING = [
  {
    filled: 0,
    nonce: "1",
    orderId: "spot-1",
    ownerAddress: "0xAAA",
    price: 0.000_727_5,
    side: "buy",
    size: 1370,
  },
  {
    filled: 685.5,
    nonce: "2",
    orderId: "spot-2",
    ownerAddress: "0xBBB",
    price: 0.000_724_6,
    side: "sell",
    size: 2740,
  },
];

// The book is public, so it holds every trader's orders. This tab is the viewer's own working
// orders — listing someone else's would offer a cancel button for an order they do not own.
test("open orders show only the connected wallet's own", () => {
  const view = buildOpenOrdersActivityView(RESTING, "0xaaa");

  expect(view.rows).toHaveLength(1);
  expect(view.rows[0].cells).toEqual(["Buy", "0.0007275", "1,370 cNGN", "0 cNGN"]);
  expect(view.rows[0].tones).toEqual({ 0: "positive" });
});

test("a sell is marked, and a partial fill keeps its decimals", () => {
  const [row] = buildOpenOrdersActivityView(RESTING, "0xBBB").rows;

  expect(row.cells).toEqual(["Sell", "0.0007246", "2,740 cNGN", "685.5 cNGN"]);
  expect(row.tones).toEqual({ 0: "negative" });
});

test("no wallet means no rows", () => {
  expect(buildOpenOrdersActivityView(RESTING, null).rows).toEqual([]);
});

// The cancel control is keyed by row index, so this list must stay aligned with the view's rows.
test("the cancellable orders line up with the rendered rows", () => {
  const view = buildOpenOrdersActivityView(RESTING, "0xBBB");
  const owned = getOwnedOpenOrders(RESTING, "0xBBB");

  expect(owned).toHaveLength(view.rows.length);
  expect(owned[0].nonce).toBe("2");
});

// --- Order History ---

/**
 * Trade #341's order, as GET /v1/orders returns it: a sell of 1346 cNGN, which filled for
 * 1.004864256981701146 USDC at the maker's price, above the signed limit of 0.000742843228 its UI
 * intent still carries.
 */
const FILLED_MARKET_SELL = {
  created_at: "2026-09-13T16:51:01.464153Z",
  desired_amount: "1346",
  display_name: "cNGN/USDC Spot",
  filled_amount: "1346",
  filled_quote: "1.004864",
  limit_price: "0.000742843228000000",
  market: "cNGN-USDC",
  order_id: "spot-f2028e9a-658e-4a2e-b63a-2dbd74a5644d",
  side: "sell",
  spot_contract: { ui_intent: { price: "0.000742843228", side: "sell", size: "1346" } },
  status: "filled",
};

test("order history has neither a guessed Type nor a limit-valued Size", () => {
  const view = buildOrderHistoryActivityView([], "UTC");

  expect(view.columns).toEqual([...ORDER_HISTORY_COLUMNS]);
  expect(view.columns).not.toContain("Type");
  expect(view.columns).not.toContain("Size");
  expect(view.rows).toEqual([]);
});

/** The fill, not the order's amount at its signed limit: 1,346 cNGN at 0.0007466, above the 0.0007428 limit. */
test("a filled market sell shows what traded and at what average price", () => {
  const [row] = buildOrderHistoryActivityView([FILLED_MARKET_SELL], "UTC").rows;

  expect(row.cells).toEqual([
    "Sep 13, 16:51",
    "cNGN-USDC",
    "Sell",
    "1,346 cNGN",
    "0.0007466",
    "0.0007428",
    "Filled",
  ]);
  // The venue's side is the displayed side, so there is nothing further to show on hover.
  expect(row.titles).toBeUndefined();
  expect(row.tones).toEqual({
    [ORDER_HISTORY_COLUMNS.indexOf("Direction")]: "negative",
    [ORDER_HISTORY_COLUMNS.indexOf("Status")]: "positive",
  });
});

test("the instrument is named by the terminal's one label for the market", () => {
  const [row] = buildOrderHistoryActivityView(
    [{ ...FILLED_MARKET_SELL, display_name: "whatever the venue calls it" }],
    "UTC"
  ).rows;

  expect(row.cells[1]).toBe("cNGN-USDC");
});

test("an order that traded nothing is a known zero, with no average price", () => {
  const cancelled = {
    ...FILLED_MARKET_SELL,
    filled_amount: "0",
    filled_quote: undefined,
    status: "cancelled",
  };
  const [row] = buildOrderHistoryActivityView([cancelled], "UTC").rows;

  expect(row.cells[3]).toBe("0 cNGN");
  expect(row.cells[4]).toBe("—");
  expect(row.cells[6]).toBe("Cancelled");
  expect(row.tones).toEqual({ [ORDER_HISTORY_COLUMNS.indexOf("Direction")]: "negative" });
});

/** A service that predates filled_quote: the cNGN that traded is known, the price it did so at is not. */
test("a fill the service did not value shows what traded but no average price", () => {
  const { filled_quote: _omitted, ...unvalued } = FILLED_MARKET_SELL;
  const [row] = buildOrderHistoryActivityView([unvalued], "UTC").rows;

  expect(row.cells[3]).toBe("1,346 cNGN");
  expect(row.cells[4]).toBe("—");
});

test("an order without a UI intent shows dashes for direction and limit", () => {
  const { spot_contract: _omitted, ...engineOnly } = FILLED_MARKET_SELL;
  const [row] = buildOrderHistoryActivityView([engineOnly], "UTC").rows;

  expect(row.cells[2]).toBe("—");
  expect(row.cells[5]).toBe("—");
  // The fill does not depend on the intent.
  expect(row.cells[3]).toBe("1,346 cNGN");
  expect(row.tones).toEqual({ [ORDER_HISTORY_COLUMNS.indexOf("Status")]: "positive" });
});

/** Trade #343: the wallet's buy of 1,325 cNGN, lifting the market maker's ask. */
const TAKER_BUY_FILL = {
  created_at: "2026-09-13T18:24:36.615867Z",
  display_name: "cNGN/USDC Spot",
  fee: "0.002475414442967443",
  liquidity: "taker",
  market: "cNGN-USDC",
  order_id: "spot-7e72d86e-1f03-45fe-9f9b-dbf2c2a23b72",
  price: "0.000747294926178851",
  side: "buy",
  size: "1325",
  spot_contract: { ui_intent: { price: "0.000747294926178851", side: "buy", size: "1325" } },
  trade_id: 343,
};

test("trade history is one row per fill, in the engine's own terms", () => {
  const view = buildTradeHistoryActivityView([TAKER_BUY_FILL], "UTC");

  expect(view.columns).toEqual([...TRADE_HISTORY_COLUMNS]);
  expect(view.rows[0].cells).toEqual([
    "Sep 13, 18:24",
    "cNGN-USDC",
    "Buy",
    "0.0007473",
    "1,325 cNGN",
    "0.9902 USDC",
    "0.002475 USDC",
    "Taker",
  ]);
  // A buy takes the buy colour, under the same rule as the ticket's button and the positions tab.
  expect(view.rows[0].tones).toEqual({ [TRADE_HISTORY_COLUMNS.indexOf("Direction")]: "positive" });
  expect(view.rows[0].titles).toBeUndefined();
});

test("a sell is marked, and a resting order that was hit reads as the maker", () => {
  const makerSell = {
    ...TAKER_BUY_FILL,
    fee: "0",
    liquidity: "maker",
    side: "sell",
    spot_contract: { ui_intent: { ...TAKER_BUY_FILL.spot_contract.ui_intent, side: "sell" } },
  };
  const [row] = buildTradeHistoryActivityView([makerSell], "UTC").rows;

  expect(row.cells[2]).toBe("Sell");
  expect(row.cells[6]).toBe("0 USDC");
  expect(row.cells[7]).toBe("Maker");
  expect(row.tones).toEqual({ [TRADE_HISTORY_COLUMNS.indexOf("Direction")]: "negative" });
});

/** Without an intent there is no price to value the fill at, but the engine's size is still cNGN. */
test("a fill without a UI intent shows dashes, and still its cNGN size", () => {
  const { spot_contract: _omitted, ...engineOnly } = TAKER_BUY_FILL;
  const [row] = buildTradeHistoryActivityView([engineOnly], "UTC").rows;

  expect(row.cells.slice(2, 4)).toEqual(["—", "—"]);
  expect(row.cells[4]).toBe("1,325 cNGN");
  expect(row.cells[5]).toBe("—");
});

test("the pre-load headers match the rows each history tab builds", () => {
  expect(ACTIVITY_VIEWS["order-history"].columns).toEqual([...ORDER_HISTORY_COLUMNS]);
  expect(ACTIVITY_VIEWS["trade-history"].columns).toEqual([...TRADE_HISTORY_COLUMNS]);
});

test("spot has no Positions tab", () => {
  expect(SPOT_BOTTOM_TABS.map((tab) => tab.id)).not.toContain("positions");
  expect(Object.keys(ACTIVITY_VIEWS)).not.toContain("positions");
});

/** A fill from before fees were recorded, on a market the backfill could not price. */
test("a fee the venue did not record reads as a dash, not a zero", () => {
  const { fee: _omitted, ...unrecorded } = TAKER_BUY_FILL;
  const [row] = buildTradeHistoryActivityView([unrecorded], "UTC").rows;

  expect(row.cells[TRADE_HISTORY_COLUMNS.indexOf("Fee")]).toBe("—");
});

/** Trade #340's fee, 0.0000019 USDC: rounding to 4 places would show a charged fee as zero. */
test("a fee on a small fill keeps its digits", () => {
  const [row] = buildTradeHistoryActivityView(
    [{ ...TAKER_BUY_FILL, fee: "0.000001890907912666" }],
    "UTC"
  ).rows;

  expect(row.cells[TRADE_HISTORY_COLUMNS.indexOf("Fee")]).toBe("0.000002 USDC");
});

/** Trade #346's settling transaction: the first fill the venue recorded with its hash. */
const TRADE_346_TX = "0xd32f8816d84bb9ef07955f7be7c32d9828407b4948083ad10a59b66f1a199729";

test("a fill's settling transaction links to Basescan on the app's chain", () => {
  const settled = { ...TAKER_BUY_FILL, tx_hash: TRADE_346_TX };

  expect(getFillTransactionUrl(settled, base.blockExplorers.default.url)).toBe(
    `https://basescan.org/tx/${TRADE_346_TX}`
  );
  expect(getFillTransactionUrl(settled, baseSepolia.blockExplorers.default.url)).toBe(
    `https://sepolia.basescan.org/tx/${TRADE_346_TX}`
  );
});

test("a fill recorded before transaction hashes were stored has no link", () => {
  expect(getFillTransactionUrl(TAKER_BUY_FILL, base.blockExplorers.default.url)).toBeNull();
});

test("a value that is not a transaction hash is never turned into a link", () => {
  for (const txHash of [
    "",
    "0x1234",
    "javascript:alert(1)",
    `0x${"g".repeat(64)}`,
    `https://example.com/${"a".repeat(64)}`,
    `${TRADE_346_TX}00`,
  ]) {
    expect(
      getFillTransactionUrl({ ...TAKER_BUY_FILL, tx_hash: txHash }, base.blockExplorers.default.url)
    ).toBeNull();
  }
});

test("trade history rows leave the trailing column to the link, so rows and headers line up", () => {
  const [row] = buildTradeHistoryActivityView([TAKER_BUY_FILL], "UTC").rows;

  expect(TRADE_HISTORY_COLUMNS.at(-1)).toBe("");
  expect(row.cells).toHaveLength(TRADE_HISTORY_COLUMNS.length - 1);
});

test("a fill the venue served without an intent has no direction and no tone", () => {
  const [row] = buildTradeHistoryActivityView(
    [{ ...TAKER_BUY_FILL, spot_contract: undefined }],
    "UTC"
  ).rows;

  expect(row.cells[2]).toBe("—");
  expect(row.titles).toBeUndefined();
  expect(row.tones).toBeUndefined();
});

// --- Perp Order History ---

/** A reduce-only, post-only sell that rested and was cancelled: a Close Long that never traded. */
const PERP_CLOSE_LONG = {
  created_at: "2026-10-07T00:32:10Z",
  desired_amount: "327",
  display_name: "cNGN Perp",
  filled_amount: "0",
  limit_price: "0.000728000000000000",
  market: "cNGN-PERP",
  order_id: "perp-1",
  post_only: true,
  reduce_only: true,
  side: "sell",
  spot_contract: { ui_intent: { price: "0.000728", side: "sell", size: "327" } },
  status: "cancelled",
};

test("the perp's order history reads action, type flags, status, size, price and fill", () => {
  const view = buildPerpOrderHistoryActivityView(
    [FILLED_MARKET_SELL, PERP_CLOSE_LONG],
    "cNGN-PERP",
    "UTC"
  );
  expect(view.columns).toEqual([...PERP_ORDER_HISTORY_COLUMNS]);
  expect(view.columns).toEqual([
    "Time",
    "Market",
    "Action",
    "Type",
    "Status",
    "Size",
    "Price",
    "Filled",
  ]);

  // A plain sell of cNGN is a Short; it filled in full, with the average fill price as a note.
  const [filled, closed] = view.rows;
  expect(filled.cells).toEqual([
    "Sep 13, 16:51",
    "cNGN-PERP",
    "Short",
    "Limit",
    "Filled",
    "1,346 cNGN",
    "$0.0007428",
    "1,346 cNGN",
  ]);
  expect(filled.badges).toBeUndefined();
  expect(filled.details).toEqual({ 7: "@ $0.0007466" });
  expect(filled.tones).toEqual({ 2: "negative", 4: "positive" });
  // The Type cell explains that every order is a limit at the venue.
  expect(filled.titles?.[3]).toContain("signed as a limit");

  // A reduce-only sell can only have shrunk a long, so it reads as Close Long; its flags ride the
  // Type cell as pills, and an order that never traded has no average price to note.
  expect(closed.cells).toEqual([
    "Oct 7, 00:32",
    "cNGN-PERP",
    "Close Long",
    "Limit",
    "Cancelled",
    "327 cNGN",
    "$0.0007280",
    "0 cNGN",
  ]);
  expect(closed.badges).toEqual({ 3: [{ label: "RO" }, { label: "PO" }] });
  expect(closed.details).toBeUndefined();
  expect(closed.tones).toEqual({ 2: "negative" });
});

test("a reduce-only buy reads as Close Short", () => {
  const [row] = buildPerpOrderHistoryActivityView(
    [
      {
        ...PERP_CLOSE_LONG,
        side: "buy",
        spot_contract: { ui_intent: { price: "0.000728", side: "buy", size: "327" } },
      },
    ],
    "cNGN-PERP",
    "UTC"
  ).rows;
  expect(row.cells[2]).toBe("Close Short");
  expect(row.tones).toEqual({ 2: "positive" });
});

// --- Perp Trade History ---

test("the perp's trade history reads action, maker or taker, size, price, value and fee in dollars", () => {
  const makerSell = {
    ...TAKER_BUY_FILL,
    fee: "0",
    liquidity: "maker",
    side: "sell",
    spot_contract: { ui_intent: { price: "0.000747294926178851", side: "sell", size: "1325" } },
    trade_id: 344,
  };
  const view = buildPerpTradeHistoryActivityView([TAKER_BUY_FILL, makerSell], "cNGN-PERP", "UTC");
  expect(view.columns).toEqual([...PERP_TRADE_HISTORY_COLUMNS]);
  expect(view.columns).toEqual([
    "Time",
    "Market",
    "Action",
    "Type",
    "Size",
    "Price",
    "Trade Value",
    "Fee",
    "",
  ]);
  // No realized PnL: the SRM keeps no entry price, so the venue reports none per fill.
  expect(view.columns).not.toContain("Closed PnL");

  const [taker, maker] = view.rows;
  expect(taker.cells).toEqual([
    "Sep 13, 18:24",
    "cNGN-PERP",
    "Long",
    "Limit",
    "1,325 cNGN",
    "$0.0007473",
    "$0.9902",
    "$0.002475",
  ]);
  expect(taker.badges).toEqual({ 3: [{ label: "T" }] });
  expect(taker.titles?.[3]).toContain("crossed the book");
  expect(taker.tones).toEqual({ 2: "positive" });

  expect(maker.cells.slice(2)).toEqual([
    "Short",
    "Limit",
    "1,325 cNGN",
    "$0.0007473",
    "$0.9902",
    "$0.00",
  ]);
  expect(maker.badges).toEqual({ 3: [{ label: "M" }] });
  expect(maker.tones).toEqual({ 2: "negative" });
});

test("a perp fill with no recorded fee shows a dash, never a zero", () => {
  const { fee: _fee, ...unrecorded } = TAKER_BUY_FILL;
  const [row] = buildPerpTradeHistoryActivityView([unrecorded], "cNGN-PERP", "UTC").rows;
  expect(row.cells[7]).toBe("—");
});
