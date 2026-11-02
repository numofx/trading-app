import { expect, test } from "bun:test";
import {
  buildOptionBalancesView,
  buildOptionOpenOrdersView,
  buildOptionOrderHistoryView,
  buildOptionPositionsView,
  buildOptionTradeHistoryView,
  isOfOptionSeries,
  optionUnitsBySymbol,
} from "./option-activity.ts";

const SYMBOL = "cNGN-30NOV26-0.00072-P";
const ROW = {
  amountScale: "1000000000000000000000",
  baseSymbol: "cNGN",
  mark: 0.000_03,
  symbol: SYMBOL,
};
const UNITS = optionUnitsBySymbol([ROW]);
const WHEN = "2026-11-02T12:00:00Z";

test("positions show the base size and its value at the mark", () => {
  const [row] = buildOptionPositionsView([{ row: ROW, size: 10_000 }]).rows;
  expect(row.cells).toEqual([SYMBOL, "10,000 cNGN", "0.00003000", "0.3000 USDC", ""]);
  const [unmarked] = buildOptionPositionsView([{ row: { ...ROW, mark: null }, size: 1000 }]).rows;
  expect(unmarked.cells[3]).toBe("—");
});

test("open orders size in the base, from the venue's units", () => {
  const order = { filled: 1, price: 0.000_03, row: ROW, side: "sell", size: 10 };
  const [row] = buildOptionOpenOrdersView([order]).rows;
  expect(row.cells).toEqual([SYMBOL, "Sell", "0.00003000", "10,000 cNGN", "1,000 cNGN", ""]);
  expect(row.tones[1]).toBe("negative");
});

test("a row's trailing cell matches the header, for the row action", () => {
  for (const view of [
    buildOptionPositionsView([{ row: ROW, size: 1000 }]),
    buildOptionOpenOrdersView([{ filled: 0, price: 1, row: ROW, side: "buy", size: 1 }]),
    buildOptionBalancesView(5),
  ]) {
    expect(view.columns.at(-1)).toBe("");
    expect(view.rows[0].cells.length).toBe(view.columns.length);
  }
});

test("order history sizes in the base", () => {
  const order = {
    created_at: WHEN,
    desired_amount: "10",
    filled_amount: "10",
    limit_price: "0.00003",
    market: SYMBOL,
    side: "buy",
    status: "filled",
  };
  const view = buildOptionOrderHistoryView([order], UNITS, "UTC");
  expect(view.rows[0].cells.slice(1)).toEqual([
    SYMBOL,
    "Buy",
    "Filled",
    "10,000 cNGN",
    "0.00003000",
    "10,000 cNGN",
  ]);
  expect(view.rows[0].cells.length).toBe(view.columns.length);
});

test("trade history sizes in the base, and a strike of unknown unit shows no size", () => {
  const fill = {
    created_at: WHEN,
    fee: "0.0005",
    market: SYMBOL,
    price: "0.00003",
    side: "sell",
    size: "1",
  };
  const [row] = buildOptionTradeHistoryView([fill], UNITS, "UTC").rows;
  expect(row.cells.slice(1)).toEqual([
    SYMBOL,
    "Sell",
    "1,000 cNGN",
    "0.00003000",
    "0.000500 USDC",
    "",
  ]);
  const [unknown] = buildOptionTradeHistoryView(
    [{ ...fill, market: "cNGN-31DEC26-0.00072-P" }],
    UNITS
  ).rows;
  expect(unknown.cells[3]).toBe("—");
});

test("history keeps this series' strikes, and not its future", () => {
  expect(isOfOptionSeries(SYMBOL, "cNGN-30NOV26")).toBe(true);
  expect(isOfOptionSeries("cNGN-31DEC26-0.00072-P", "cNGN-30NOV26")).toBe(false);
  expect(isOfOptionSeries("cNGN-30NOV26", "cNGN-30NOV26")).toBe(false);
  expect(isOfOptionSeries("cNGN-USDC", "cNGN-30NOV26")).toBe(false);
});
