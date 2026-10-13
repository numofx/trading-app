import {
  FUTURE_ORDER_HISTORY_COLUMNS,
  FUTURE_TRADE_HISTORY_COLUMNS,
} from "@/lib/account-activity-views";
import { FUTURE_BALANCES_COLUMNS, FUTURE_POSITIONS_COLUMNS } from "@/lib/future-market";
import type { ActivityTab, ActivityView } from "@/lib/trading.types";

export const FUTURE_BOTTOM_TABS = [
  { id: "positions", label: "Positions" },
  { id: "open-orders", label: "Open Orders" },
  { id: "balances", label: "Balances" },
  { id: "trade-history", label: "Trade History" },
  { id: "order-history", label: "Order History" },
] satisfies ActivityTab[];

/** Column headers for each tab before data arrives. */
export const FUTURE_ACTIVITY_VIEWS = {
  balances: { columns: [...FUTURE_BALANCES_COLUMNS], rows: [] },
  "open-orders": { columns: ["Side", "Price", "Contracts", "Filled"], rows: [] },
  "order-history": { columns: [...FUTURE_ORDER_HISTORY_COLUMNS], rows: [] },
  positions: { columns: [...FUTURE_POSITIONS_COLUMNS], rows: [] },
  "trade-history": { columns: [...FUTURE_TRADE_HISTORY_COLUMNS], rows: [] },
} satisfies Record<(typeof FUTURE_BOTTOM_TABS)[number]["id"], ActivityView>;
