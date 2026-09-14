import { expect, test } from "bun:test";
import { base, baseSepolia } from "viem/chains";
import {
  buildAssetsActivityView,
  buildOpenOrdersActivityView,
  buildOrderHistoryActivityView,
  buildTradeHistoryActivityView,
  getFillTransactionUrl,
  getOwnedOpenOrders,
  ORDER_HISTORY_COLUMNS,
  TRADE_HISTORY_COLUMNS,
} from "./account-activity-views.ts";
import { ACTIVITY_VIEWS, SPOT_BOTTOM_TABS } from "./spot-terminal-config.ts";

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

/** Trade #343: the sell side of the wallet's USDC sale, taking the market maker's bid. */
const TAKER_SELL_FILL = {
  created_at: "2026-09-13T18:24:36.615867Z",
  display_name: "USDC/cNGN Spot",
  fee: "0.002475414442967443",
  liquidity: "taker",
  market: "USDCcNGN-SPOT",
  order_id: "spot-7e72d86e-1f03-45fe-9f9b-dbf2c2a23b72",
  price: "0.000747294926178851",
  side: "buy",
  size: "1325",
  spot_contract: { ui_intent: { price: "1338.160051", side: "sell", size: "0.990166" } },
  trade_id: 343,
};

test("trade history is one row per fill, in the trader's terms", () => {
  const view = buildTradeHistoryActivityView([TAKER_SELL_FILL], "UTC");

  expect(view.columns).toEqual([...TRADE_HISTORY_COLUMNS]);
  expect(view.rows[0].cells).toEqual([
    "Sep 13, 18:24",
    "USDC/cNGN Spot",
    "Sell",
    "₦1,338.16",
    "0.9902 USDC",
    "1,325 cNGN",
    "0.002475 USDC",
    "Taker",
  ]);
  expect(view.rows[0].positiveCellIndexes).toBeUndefined();
});

test("a buy is marked, and a resting order that was hit reads as the maker", () => {
  const makerBuy = {
    ...TAKER_SELL_FILL,
    fee: "0",
    liquidity: "maker",
    side: "sell",
    spot_contract: { ui_intent: { ...TAKER_SELL_FILL.spot_contract.ui_intent, side: "buy" } },
  };
  const [row] = buildTradeHistoryActivityView([makerBuy], "UTC").rows;

  expect(row.cells[2]).toBe("Buy");
  expect(row.cells[6]).toBe("0 USDC");
  expect(row.cells[7]).toBe("Maker");
  expect(row.positiveCellIndexes).toEqual([TRADE_HISTORY_COLUMNS.indexOf("Direction")]);
});

/** Never the engine price or side in the trader's columns: both are inverted on this pair. */
test("a fill without a UI intent shows dashes, and still its cNGN total", () => {
  const { spot_contract: _omitted, ...engineOnly } = TAKER_SELL_FILL;
  const [row] = buildTradeHistoryActivityView([engineOnly], "UTC").rows;

  expect(row.cells.slice(2, 5)).toEqual(["—", "—", "—"]);
  expect(row.cells[5]).toBe("1,325 cNGN");
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
  const { fee: _omitted, ...unrecorded } = TAKER_SELL_FILL;
  const [row] = buildTradeHistoryActivityView([unrecorded], "UTC").rows;

  expect(row.cells[TRADE_HISTORY_COLUMNS.indexOf("Fee")]).toBe("\u2014");
});

/** Trade #340's fee, 0.0000019 USDC: rounding to 4 places would show a charged fee as zero. */
test("a fee on a small fill keeps its digits", () => {
  const [row] = buildTradeHistoryActivityView([{ ...TAKER_SELL_FILL, fee: "0.000001890907912666" }], "UTC").rows;

  expect(row.cells[TRADE_HISTORY_COLUMNS.indexOf("Fee")]).toBe("0.000002 USDC");
});

/** Trade #346's settling transaction: the first fill the venue recorded with its hash. */
const TRADE_346_TX = "0xd32f8816d84bb9ef07955f7be7c32d9828407b4948083ad10a59b66f1a199729";

test("a fill's settling transaction links to Basescan on the app's chain", () => {
  const settled = { ...TAKER_SELL_FILL, tx_hash: TRADE_346_TX };

  expect(getFillTransactionUrl(settled, base.blockExplorers.default.url)).toBe(
    `https://basescan.org/tx/${TRADE_346_TX}`
  );
  expect(getFillTransactionUrl(settled, baseSepolia.blockExplorers.default.url)).toBe(
    `https://sepolia.basescan.org/tx/${TRADE_346_TX}`
  );
});

test("a fill recorded before transaction hashes were stored has no link", () => {
  expect(getFillTransactionUrl(TAKER_SELL_FILL, base.blockExplorers.default.url)).toBeNull();
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
      getFillTransactionUrl({ ...TAKER_SELL_FILL, tx_hash: txHash }, base.blockExplorers.default.url)
    ).toBeNull();
  }
});

test("trade history rows leave the trailing column to the link, so rows and headers line up", () => {
  const [row] = buildTradeHistoryActivityView([TAKER_SELL_FILL], "UTC").rows;

  expect(TRADE_HISTORY_COLUMNS.at(-1)).toBe("");
  expect(row.cells).toHaveLength(TRADE_HISTORY_COLUMNS.length - 1);
});
