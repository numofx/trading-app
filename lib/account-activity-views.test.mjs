import { expect, test } from "bun:test";
import {
  buildAssetsActivityView,
  buildOpenOrdersActivityView,
  buildOrderHistoryActivityView,
  getOwnedOpenOrders,
  ORDER_HISTORY_COLUMNS,
} from "./account-activity-views.ts";

test("renders the account and wallet legs of each asset", () => {
  const view = buildAssetsActivityView({
    accountCngnLabel: "5,440.00 cNGN",
    accountUsdcLabel: "12.50 USDC",
    walletCngnLabel: "1,200.00 cNGN",
    walletUsdcLabel: "980.00 USDC",
  });

  expect(view.columns).toEqual(["Asset", "Trading Account", "Wallet"]);
  expect(view.rows[0].cells).toEqual(["USDC", "12.50 USDC", "980.00 USDC"]);
  expect(view.rows[1].cells).toEqual(["cNGN", "5,440.00 cNGN", "1,200.00 cNGN"]);
});

test("leaves the wallet cNGN leg unknown when the token address is unconfigured", () => {
  const view = buildAssetsActivityView({
    accountCngnLabel: "5,440.00 cNGN",
    accountUsdcLabel: "12.50 USDC",
    walletCngnLabel: null,
    walletUsdcLabel: "980.00 USDC",
  });

  expect(view.rows[1].cells).toEqual(["cNGN", "5,440.00 cNGN", "—"]);
});

test("shows an em dash instead of inventing a figure for unknown balances", () => {
  const view = buildAssetsActivityView({
    accountCngnLabel: null,
    accountUsdcLabel: null,
    walletCngnLabel: null,
    walletUsdcLabel: null,
  });

  for (const row of view.rows) {
    expect(row.cells.slice(1)).toEqual(["—", "—"]);
  }
});

const RESTING = [
  {
    filled: 0,
    nonce: "1",
    orderId: "spot-1",
    ownerAddress: "0xAAA",
    price: 1374.6,
    side: "buy",
    size: 1,
  },
  {
    filled: 0.5,
    nonce: "2",
    orderId: "spot-2",
    ownerAddress: "0xBBB",
    price: 1380.1,
    side: "sell",
    size: 2,
  },
];

// The book is public, so it holds every trader's orders. This tab is the viewer's own working
// orders — listing someone else's would offer a cancel button for an order they do not own.
test("open orders show only the connected wallet's own", () => {
  const view = buildOpenOrdersActivityView(RESTING, "0xaaa");

  expect(view.rows).toHaveLength(1);
  expect(view.rows[0].cells[0]).toBe("Buy");
  expect(view.rows[0].cells[1]).toBe("₦1,374.60");
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
 * Trade #341's order, as GET /v1/orders returns it: an engine sell of cNGN, a USDC buy to the
 * trader. It filled 1346 cNGN for 1.004864256981701146 USDC at the maker's price, while its UI intent
 * still carries the signed limit of 1346.17679.
 */
const FILLED_MARKET_BUY = {
  created_at: "2026-09-13T16:51:01.464153Z",
  desired_amount: "1346",
  display_name: "USDC/cNGN Spot",
  filled_amount: "1346",
  filled_quote: "1.004864",
  limit_price: "0.000742843228000000",
  market: "USDCcNGN-SPOT",
  order_id: "spot-f2028e9a-658e-4a2e-b63a-2dbd74a5644d",
  side: "sell",
  spot_contract: { ui_intent: { price: "1346.17679", side: "buy", size: "0.999868" } },
  status: "filled",
};

test("order history has neither a guessed Type nor a limit-valued Size", () => {
  const view = buildOrderHistoryActivityView([], "UTC");

  expect(view.columns).toEqual([...ORDER_HISTORY_COLUMNS]);
  expect(view.columns).not.toContain("Type");
  expect(view.columns).not.toContain("Size");
  expect(view.rows).toEqual([]);
});

/** The fill, not the order's amount at its signed limit: 1.0049 USDC at 1339.48, below the 1346.18 limit. */
test("a filled market buy shows what traded and at what average price", () => {
  const [row] = buildOrderHistoryActivityView([FILLED_MARKET_BUY], "UTC").rows;

  expect(row.cells).toEqual([
    "Sep 13, 16:51",
    "USDC/cNGN Spot",
    "Buy",
    "1.0049 USDC",
    "\u20a61,339.48",
    "\u20a61,346.18",
    "Filled",
  ]);
  expect(row.positiveCellIndexes).toEqual([ORDER_HISTORY_COLUMNS.indexOf("Status")]);
});

test("an order that traded nothing is a known zero, with no average price", () => {
  const cancelled = { ...FILLED_MARKET_BUY, filled_amount: "0", filled_quote: undefined, status: "cancelled" };
  const [row] = buildOrderHistoryActivityView([cancelled], "UTC").rows;

  expect(row.cells[3]).toBe("0 USDC");
  expect(row.cells[4]).toBe("\u2014");
  expect(row.cells[6]).toBe("Cancelled");
  expect(row.positiveCellIndexes).toBeUndefined();
});

/** A service that predates filled_quote: the order filled, but by how much in USDC is unknown. */
test("a fill the service did not value reads as a dash, not a figure", () => {
  const { filled_quote: _omitted, ...unvalued } = FILLED_MARKET_BUY;
  const [row] = buildOrderHistoryActivityView([unvalued], "UTC").rows;

  expect(row.cells[3]).toBe("\u2014");
  expect(row.cells[4]).toBe("\u2014");
});

test("an order without a UI intent shows dashes for direction and limit", () => {
  const { spot_contract: _omitted, ...engineOnly } = FILLED_MARKET_BUY;
  const [row] = buildOrderHistoryActivityView([engineOnly], "UTC").rows;

  expect(row.cells[2]).toBe("\u2014");
  expect(row.cells[5]).toBe("\u2014");
  // The fill does not depend on the intent.
  expect(row.cells[3]).toBe("1.0049 USDC");
});
