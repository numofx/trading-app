import { expect, test } from "bun:test";
import {
  buildAssetsActivityView,
  buildOpenOrdersActivityView,
  getOwnedOpenOrders,
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
