import { formatOrderTime, ORDER_STATUS_LABELS } from "@/lib/account-activity-views";
import type { OptionOverviewRow } from "@/lib/option-chain";
import { formatPremium, optionSeries, optionUnitBase } from "@/lib/option-chain";
import type { AccountFill, OrderHistoryOrder } from "@/lib/order-history.types";
import { sideTone } from "@/lib/side-tone";
import type { ActivityRow, ActivityTab, ActivityView } from "@/lib/trading.types";

/**
 * The options page's activity tabs. The page spans a series, so unlike a future's panel every row names its strike,
 * and the positions and orders are the account's across all of them. Sizes are shown in the base: the venue's rows
 * count its units, 1,000 cNGN each.
 */
export const OPTION_BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "balances", label: "Balances" },
  { id: "trade-history", label: "Trade History" },
  { id: "order-history", label: "Order History" },
] satisfies ActivityTab[];

export type OptionBottomTab = (typeof OPTION_BOTTOM_TABS)[number]["id"];

export type OptionPosition = { row: OptionOverviewRow; size: number };

/** An order of the wallet's resting on one of the chain's strikes. */
export type OwnOptionOrder = OptionOverviewRow["openOrders"][number] & { row: OptionOverviewRow };

const POSITIONS_COLUMNS = ["Market", "Size", "Mark", "Value", ""];
const OPEN_ORDERS_COLUMNS = ["Market", "Side", "Price", "Size", "Filled", ""];
const BALANCES_COLUMNS = ["Asset", "Amount", "Price", "Value", ""];
const ORDER_HISTORY_COLUMNS = ["Time", "Market", "Action", "Status", "Size", "Price", "Filled"];
const TRADE_HISTORY_COLUMNS = ["Time", "Market", "Action", "Size", "Price", "Fee", ""];

const SIZE = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const UNKNOWN = "—";

function usdc(value: number | null, decimals = 4) {
  return value === null || !Number.isFinite(value) ? UNKNOWN : `${value.toFixed(decimals)} USDC`;
}

function actionLabel(side: "buy" | "sell") {
  return side === "buy" ? "Buy" : "Sell";
}

/** The strikes the rows can be sized from, by symbol: each states its own unit. */
export function optionUnitsBySymbol(rows: readonly OptionOverviewRow[]) {
  return new Map(
    rows.map((row) => [row.symbol, optionUnitBase(row.amountScale ?? undefined)] as const)
  );
}

/** Venue units in the base, or a dash where the strike's unit is not known: never a size off by a thousand. */
function sized(units: number, unit: number | null | undefined, base = "cNGN") {
  return unit === null || unit === undefined || !Number.isFinite(units)
    ? UNKNOWN
    : `${SIZE.format(units * unit)} ${base}`;
}

/** Whether a history row belongs to this page's series. */
export function isOfOptionSeries(market: string, series: string) {
  return optionSeries(market) === series && market !== series;
}

export function buildOptionPositionsView(positions: readonly OptionPosition[]): ActivityView {
  return {
    columns: POSITIONS_COLUMNS,
    rows: positions.map(({ row, size }) => ({
      cells: [
        row.symbol,
        `${SIZE.format(size)} ${row.baseSymbol}`,
        formatPremium(row.mark),
        usdc(row.mark === null ? null : size * row.mark),
        "",
      ],
    })),
  };
}

export function buildOptionOpenOrdersView(orders: readonly OwnOptionOrder[]): ActivityView {
  return {
    columns: OPEN_ORDERS_COLUMNS,
    rows: orders.map((order) => {
      const unit = optionUnitBase(order.row.amountScale ?? undefined);
      return {
        tones: { 1: sideTone(order.side) },
        cells: [
          order.row.symbol,
          actionLabel(order.side),
          formatPremium(order.price),
          sized(order.size, unit, order.row.baseSymbol),
          sized(order.filled, unit, order.row.baseSymbol),
          "",
        ],
      };
    }),
  };
}

export function buildOptionBalancesView(cash: number | null): ActivityView {
  return {
    columns: BALANCES_COLUMNS,
    rows: [{ cells: ["USDC", usdc(cash, 2), "$1.00", usdc(cash, 2), ""] }],
  };
}

export function buildOptionOrderHistoryView(
  orders: readonly OrderHistoryOrder[],
  units: ReadonlyMap<string, number | null>,
  timeZone?: string
): ActivityView {
  return {
    columns: ORDER_HISTORY_COLUMNS,
    rows: orders.map((order) => {
      const unit = units.get(order.market ?? "");
      const row: ActivityRow = {
        tones: { 2: sideTone(order.side) },
        cells: [
          formatOrderTime(order.created_at, timeZone),
          order.market ?? UNKNOWN,
          actionLabel(order.side),
          ORDER_STATUS_LABELS[order.status] ?? order.status,
          sized(Number(order.desired_amount), unit),
          formatPremium(Number(order.limit_price)),
          sized(Number(order.filled_amount), unit),
        ],
      };
      if (order.status === "filled" && row.tones !== undefined) {
        row.tones[3] = "positive";
      }
      return row;
    }),
  };
}

export function buildOptionTradeHistoryView(
  fills: readonly AccountFill[],
  units: ReadonlyMap<string, number | null>,
  timeZone?: string
): ActivityView {
  return {
    columns: TRADE_HISTORY_COLUMNS,
    rows: fills.map((fill) => {
      const fee = fill.fee === undefined ? null : Number(fill.fee);
      return {
        tones: { 2: sideTone(fill.side) },
        cells: [
          formatOrderTime(fill.created_at, timeZone),
          fill.market ?? UNKNOWN,
          actionLabel(fill.side),
          sized(Number(fill.size), units.get(fill.market ?? "")),
          formatPremium(Number(fill.price)),
          usdc(fee, 6),
          "",
        ],
      };
    }),
  };
}
