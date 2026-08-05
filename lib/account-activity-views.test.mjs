import { expect, test } from "bun:test";
import { buildAssetsActivityView } from "./account-activity-views.ts";

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
